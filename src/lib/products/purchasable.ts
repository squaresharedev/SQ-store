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
// PLACED on that storefront, `active`, owned by the storefront's owner and not
// taken down; and the seller must have disclosed who they are. Every failure
// is the same `null`, which each route turns into the same 404, so nothing
// here is enumerable.
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
  buildTraderIdentityInput,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import { emailProofRequired } from "@/lib/contact-verification/availability";
import { isTraderIdentityComplete } from "@/lib/settings/trader-identity";
import {
  SHIPPING_POLICY_SELECT,
  buildShippingPolicy,
  type ShippingPolicyRow,
} from "@/lib/settings/shipping-policy";
import { MODERATION_GATE_SELECT, isContentVisible } from "@/lib/moderation/removal";
import { clientKey, rateLimitKey, type RateLimitBudget } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { PUBLIC_STOCK_SELECT } from "@/lib/stock/public";
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
  `id, title, description, price_cents, currency, image_key, digital_file_key, gallery, option_groups, details, documents, purchase_url, shipping_profile_id, max_per_order, ${MODERATION_GATE_SELECT}, ${PUBLIC_STOCK_SELECT}` as const;

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
  /** The tile this product sits on, which carries the manual sold-out flag. */
  block: ProductBlock;
  row: PublicProductRow;
  /** The six buyer-facing identity columns, built field by field. */
  seller: StorefrontSeller;
  shippingPolicy: SellerShippingPolicy;
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
 */
export async function loadPurchasable<Extra = undefined>(
  storefrontId: string,
  productId: string,
  limit: GateBudget,
  alongside?: (admin: ReturnType<typeof createAdminClient>, ownerId: string) => Promise<Extra>,
): Promise<(Purchasable & { extra: Extra }) | null> {
  if (!idSchema.safeParse(storefrontId).success) return null;
  if (!idSchema.safeParse(productId).success) return null;

  // The budget is spent before the first read, so a scan pays before it learns
  // anything. rateLimitKey fails closed.
  const key = await clientKey(await headers());
  if (!(await rateLimitKey(key, limit.action, limit.budget))) return null;

  const admin = createAdminClient();
  const { data: storefront, error: storefrontError } = await admin
    .from("storefronts")
    .select(`id, name, owner_id, config, ${MODERATION_GATE_SELECT}`)
    .eq("id", storefrontId)
    .maybeSingle();
  if (storefrontError) {
    console.error("[purchasable] storefront read failed", storefrontError);
    return null;
  }
  if (!storefront) return null;

  // A removed STOREFRONT takes every page hanging off it, before the product is
  // even read: taking down a shop and leaving its product pages reachable by
  // direct link would be a takedown in name only.
  if (!isContentVisible(storefront.moderation_status)) return null;

  const config = parseStoredStorefrontConfig(storefront.config);
  if (!config) return null;
  const productPage = resolveProductPage(config);
  if (!productPage.enabled) return null;

  // The page belongs to a tile. A product the seller has not placed on this
  // storefront has no page here, whatever its status. Hidden sold-out tiles
  // still count: the page then simply says sold out.
  const block = config.blocks.find(
    (candidate) => candidate.type === "product" && candidate.productId === productId,
  );
  if (!block || block.type !== "product") return null;

  // Product and seller identity both depend only on the owner id already in
  // hand, so they run together rather than one after the other.
  const [{ data: row, error: productError }, { data: sellerRow, error: sellerError }, extra] =
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
      alongside ? alongside(admin, storefront.owner_id) : Promise.resolve(undefined as Extra),
    ]);
  if (productError) {
    console.error("[purchasable] product read failed", productError);
    return null;
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
  if (
    !isTraderIdentityComplete(buildTraderIdentityInput(gateRow), {
      requireVerifiedEmail: emailProofRequired(),
    })
  ) {
    return null;
  }

  return {
    ownerId: storefront.owner_id,
    storefront: { id: storefront.id, name: storefront.name },
    config,
    productPage,
    block,
    row: row as PublicProductRow,
    seller: buildSellerIdentity(gateRow as SellerIdentityRow | null),
    shippingPolicy: buildShippingPolicy(sellerError ? null : (sellerRow as ShippingPolicyRow | null)),
    extra: extra as Extra,
  };
}
