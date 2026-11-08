// SERVER ONLY. THE GATE in front of every buyer-facing surface of one product:
// the hosted product page, the checkout it leads to, and the quote that prices
// an order. One function so the three can never disagree about what is for
// sale. A product the page would 404 is a product the checkout 404s and the
// quote refuses, for the same reason, decided in the same place.
//
// SECURITY MODEL, same as /api/embed/[key]: a service-role read behind an
// application gate, never an anon RLS policy. The gate, in order: both ids
// must be UUIDs before any I/O; the client IP spends a rate-limit token (the
// caller names the bucket, and cannot skip it); the storefront must exist, not
// be taken down, and have its product page switched on; the product must be
// PLACED on that storefront (or offered beside one that is, see
// offeredByATile), `active`, owned by the storefront's owner and not taken
// down; and the seller must have disclosed who they are. Every refusal
// is the same `null`, which each route turns into the same 404, so nothing
// here is enumerable. (A spent rate limit or a failed read is not a refusal:
// see gatePurchasable and lib/public/busy.ts. That includes the read of the
// store's running sales, without which nothing here has a price.)
//
// What this returns is RAW (the row, the parsed config). Deciding what a buyer
// may SEE of it stays with each surface's own builder (buildProductPageProduct
// for the product page), which is what keeps keys and owner data out of a
// payload by construction.

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TRADER_GATE_SELECT,
  buildSellerIdentity,
  sellerMaySell,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import {
  SHIPPING_POLICY_SELECT,
  buildShippingPolicy,
  type ShippingPolicyRow,
} from "@/lib/settings/shipping-policy";
import { MODERATION_GATE_SELECT, isContentVisible } from "@/lib/moderation/removal";
import { PAGE_BUSY, type PageBusy } from "@/lib/public/busy";
import { clientKey, rateLimitKey, type RateLimitBudget } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { isProductPageSectionShown } from "@/lib/storefront/product-page";
import { openStorefront } from "@/lib/storefront/public-gate";
import { PUBLIC_STOCK_SELECT } from "@/lib/stock/public";
import { readActiveSales } from "@/lib/discounts/public";
import type { ActiveSale } from "@/types/discount";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type {
  ProductBlock,
  ProductPageConfig,
  StorefrontConfig,
  StorefrontSeller,
} from "@/types/storefront";

/**
 * Exactly the columns a buyer-facing builder reads. `digital_file_key` is here
 * ONLY so `isDigital` and the format can be derived; it never leaves the
 * server. The stock fragment comes from the stock seam so this select cannot
 * drift onto a column that seam has not admitted.
 */
export const PUBLIC_PRODUCT_SELECT =
  `id, title, description, price_cents, currency, image_key, digital_file_key, gallery, option_groups, details, documents, purchase_url, shipping_profile_id, max_per_order, created_at, add_on_ids, ${MODERATION_GATE_SELECT}, ${PUBLIC_STOCK_SELECT}` as const;

export type PublicProductRow = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_key: string | null;
  digital_file_key: string | null;
  gallery: unknown;
  option_groups: unknown;
  details: unknown;
  documents: unknown;
  purchase_url: string | null;
  shipping_profile_id: string | null;
  max_per_order: number | null;
  /** When it was listed. Read by the sale's pricing only (a product younger
   *  than the 30 days a sale is measured against), never by a payload builder. */
  created_at: string | null;
  /** The seller's "Add to your order" choices (lib/products/add-ons.ts). Ids
   *  only, re-checked on every read; never placed on a payload as they are. */
  add_on_ids?: string[] | null;
  /** Takedown state. Read by the gate, never by a payload builder: nothing
   *  about a removal is buyer-facing. */
  moderation_status: string | null;
  track_stock: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number;
};

/** Everything behind the gate, for the surface to build its own payload from. */
export type Purchasable = {
  /** The storefront owner, who is the seller. Never placed on a payload. */
  ownerId: string;
  storefront: { id: string; name: string };
  config: StorefrontConfig;
  productPage: ProductPageConfig;
  /** The tile this product sits on, which carries the manual sold-out flag.
   *  Null for a product that is here only as another tile's add-on. */
  block: ProductBlock | null;
  row: PublicProductRow;
  /** The six buyer-facing identity columns, built field by field. */
  seller: StorefrontSeller;
  shippingPolicy: SellerShippingPolicy;
  /** The store's sales running now that cover this product. Server-side: each
   *  carries the id an order is credited to. */
  sales: ActiveSale[];
  /** The one "now" this request priced at, so the page, the quote and the
   *  code check never disagree about whether something has started or ended. */
  now: Date;
};

/** Which rate-limit bucket a caller spends, and how much it holds. */
export type GateBudget = { action: string; budget: RateLimitBudget };

const idSchema = uuidField();

/**
 * Pass the gate, or `null` for every reason a buyer may not have this product
 * from this storefront.
 *
 * `alongside` runs in parallel with the product and profile reads, for a
 * caller that needs one more owner-scoped read on the same hot path (the
 * product page's report scopes). It receives the owner id, which is only
 * known once the storefront has been read.
 *
 * Not cached here: each surface wraps its own loader in React's `cache`, so
 * metadata and body share one read and one rate-limit token per request.
 *
 * A caller that renders a PAGE asks gatePurchasable instead, which also says
 * when the answer is "not right now" rather than "no" (lib/public/busy.ts).
 * Everything that acts on the answer (the quote, the code check) treats the
 * two alike, so they keep this one.
 */
export async function loadPurchasable<Extra = undefined>(
  storefrontId: string,
  productId: string,
  limit: GateBudget,
  alongside?: (admin: ReturnType<typeof createAdminClient>, ownerId: string) => Promise<Extra>,
): Promise<(Purchasable & { extra: Extra }) | null> {
  const gate = await gatePurchasable(storefrontId, productId, limit, alongside);
  return gate === PAGE_BUSY ? null : gate;
}

/**
 * The gate itself. As loadPurchasable, except that the two outcomes that are
 * nobody's refusal (the visitor's rate limit is spent, or a read failed) come
 * back as PAGE_BUSY, so a page can offer "try again" instead of a 404.
 */
export async function gatePurchasable<Extra = undefined>(
  storefrontId: string,
  productId: string,
  limit: GateBudget,
  alongside?: (admin: ReturnType<typeof createAdminClient>, ownerId: string) => Promise<Extra>,
): Promise<(Purchasable & { extra: Extra }) | PageBusy | null> {
  if (!idSchema.safeParse(storefrontId).success) return null;
  if (!idSchema.safeParse(productId).success) return null;

  // The budget is spent before the first read, so a scan pays before it learns
  // anything. rateLimitKey fails closed.
  const key = await clientKey(await headers());
  if (!(await rateLimitKey(key, limit.action, limit.budget))) return PAGE_BUSY;

  const admin = createAdminClient();
  const { data: storefront, error: storefrontError } = await admin
    .from("storefronts")
    .select(`id, name, owner_id, config, ${MODERATION_GATE_SELECT}`)
    .eq("id", storefrontId)
    .maybeSingle();
  if (storefrontError) {
    console.error("[purchasable] storefront read failed", storefrontError);
    return PAGE_BUSY;
  }
  if (!storefront) return null;

  // The storefront half of the gate (lib/storefront/public-gate.ts). A removed
  // STOREFRONT takes every page hanging off it, before the product is even
  // read: taking down a shop and leaving its product pages reachable by direct
  // link would be a takedown in name only.
  const open = openStorefront(storefront);
  if (!open) return null;
  const { config, productPage } = open;

  // The page belongs to a tile, or to a product a tile offers in "Add to your
  // order" (its details dialog links here). Any other product the seller has
  // not placed on this storefront has no page here, whatever its status.
  // Hidden sold-out tiles still count: the page then simply says sold out.
  const tiles = config.blocks.flatMap((candidate) => (candidate.type === "product" ? [candidate] : []));
  const block = tiles.find((candidate) => candidate.productId === productId) ?? null;
  if (!block) {
    const offered = await offeredByATile(admin, storefront.owner_id, productId, {
      tileProductIds: tiles.map((tile) => tile.productId),
      productPage,
    });
    if (offered === null) return PAGE_BUSY;
    if (!offered) return null;
  }

  // Product, seller identity and the store's running sales all depend only on
  // the owner id already in hand, so they run together rather than one after
  // the other.
  const now = new Date();
  const [{ data: row, error: productError }, { data: sellerRow, error: sellerError }, sales, extra] =
    await Promise.all([
      admin
        .from("products")
        .select(PUBLIC_PRODUCT_SELECT)
        .eq("id", productId)
        .eq("owner_id", storefront.owner_id)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("profiles")
        // Trader identity AND shipping terms, in ONE select: both are
        // account-level facts read off the same row, and asking for that row
        // twice on a public hot path would be two round trips for one read.
        .select(`${TRADER_GATE_SELECT}, ${SHIPPING_POLICY_SELECT}`)
        .eq("id", storefront.owner_id)
        .maybeSingle(),
      readActiveSales(admin, storefront.owner_id, productId, now),
      alongside ? alongside(admin, storefront.owner_id) : Promise.resolve(undefined as Extra),
    ]);
  if (productError) {
    console.error("[purchasable] product read failed", productError);
    return PAGE_BUSY;
  }
  if (!row) return null;

  // THE REMOVAL GATE. Same null as every other refusal, so a takedown is
  // indistinguishable from a product that never existed: a page that said
  // "removed" would tell a scanner exactly which listings were worth looking at
  // on an archive. The seller is told directly instead.
  if (!isContentVisible((row as PublicProductRow).moderation_status)) return null;

  if (sellerError) {
    console.error("[purchasable] seller identity read failed", sellerError);
  }

  // THE READ SIDE OF THE PUBLISH GATE. The write side stops a product going
  // `active` without the seller's trader details; this stops one that went
  // active before those details were cleared (or before the gate existed) from
  // still being sold. A buyer may not be shown an offer, let alone pay for one,
  // without being told who is making it and how to reach them. Fail-closed on a
  // read error: an identity we could not read is one we cannot display.
  //
  // `seller` is what a page SHOWS (the identity columns, built field by field,
  // so the verification flag cannot ride along onto a buyer's page); the gate
  // asks a wider question of the same row.
  const gateRow = sellerError ? null : (sellerRow as TraderGateRow | null);
  if (!sellerMaySell(gateRow)) return null;

  // THE PRICE. Which sales are running decides what this product costs, so
  // sales that could not be read are a price that is not known: "not right
  // now", never the regular price. A buyer shown (or charged) the full price
  // while the seller is advertising a sale is the one mistake a blip here
  // could otherwise make. Asked last, so a product that is not for sale at all
  // is still the plain refusal above.
  if (sales === null) return PAGE_BUSY;

  return {
    ownerId: storefront.owner_id,
    storefront: { id: storefront.id, name: storefront.name },
    config,
    productPage,
    block,
    row: row as PublicProductRow,
    seller: buildSellerIdentity(gateRow as SellerIdentityRow | null),
    shippingPolicy: buildShippingPolicy(sellerError ? null : (sellerRow as ShippingPolicyRow | null)),
    sales,
    now,
    extra: extra as Extra,
  };
}

/**
 * Whether a product that is not a tile here is one a tile OFFERS: in the
 * add_on_ids of a live product placed on this storefront, while the storefront
 * shows "Add to your order". The seller choosing it there is what put it on
 * sale here, so its own page (and checkout) are here too; the rest of the gate
 * still asks everything it asks of a tile's product. Null when the database
 * did not answer. Exported for its test.
 */
export async function offeredByATile(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  productId: string,
  here: { tileProductIds: readonly string[]; productPage: ProductPageConfig },
): Promise<boolean | null> {
  if (here.tileProductIds.length === 0 || !isProductPageSectionShown(here.productPage, "addOns")) {
    return false;
  }
  const { data, error } = await admin
    .from("products")
    .select(`id, ${MODERATION_GATE_SELECT}`)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .in("id", [...here.tileProductIds])
    .contains("add_on_ids", [productId]);
  if (error) {
    console.error("[purchasable] add-on host read failed", error);
    return null;
  }
  return (data ?? []).some((row) => isContentVisible(row.moderation_status));
}
