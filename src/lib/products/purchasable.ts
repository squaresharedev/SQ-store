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
import { readStoreSales, salesCovering } from "@/lib/discounts/public";
import type { ActiveSale, StoreSale } from "@/types/discount";
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
  /** All of the store's running sales, for callers (add-ons, the quote) that
   *  need them too so they do not read them again. */
  storeSales: StoreSale[];
  /** The one "now" this request priced at, so the page, the quote and the
   *  code check never disagree about whether something has started or ended. */
  now: Date;
};

/** The storefront half of a passed gate: everything a sale from this
 *  storefront needs that is not about one product. */
export type PurchasableStore = Omit<Purchasable, "block" | "row" | "sales">;

/** One product that passed the gate, with what is particular to it. */
export type PurchasableItem = Pick<Purchasable, "block" | "row" | "sales">;

/** The gate passed for several products at once (a cart, an order of many
 *  lines). `items` holds only the products that are for sale here; an id
 *  missing from it is not, for any of the reasons the single gate refuses. */
export type PurchasableLines<Extra = undefined> = {
  store: PurchasableStore;
  items: Map<string, PurchasableItem>;
  extra: Extra;
};

/** Which rate-limit bucket a caller spends, and how much it holds. */
export type GateBudget = { action: string; budget: RateLimitBudget };

/** A caller that has ALREADY spent this request's token, from its own budget,
 *  before a read the gate depends on (the cart routes read the cart first, to
 *  learn which products to ask about). Never a way to skip the limit: the
 *  token is spent, just earlier. */
export type GateBudgetSpent = { spentBy: string };

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
  if (!idSchema.safeParse(productId).success) return null;
  const gate = await gatePurchasableLines(storefrontId, [productId], limit, alongside, { stopWhenNonePlaced: true });
  if (gate === null || gate === PAGE_BUSY) return gate;
  const item = gate.items.get(productId);
  if (!item) return null;
  return { ...gate.store, ...item, extra: gate.extra };
}

/**
 * THE GATE for several products bought from one storefront at once: the cart,
 * and every order (an order of one product is a list of one). Everything the
 * single gate asks, asked once for the storefront and once for all the
 * products together: ONE rate-limit token, one storefront read, one products
 * read, one seller read and one read of the store's sales, however many lines.
 *
 * `null` is the storefront's refusal (no such storefront, taken down, its
 * pages switched off, or a seller who has not said who they are): nothing
 * from it is for sale. Otherwise each product that is for sale here is in
 * `items`; one that is not (never placed, a draft, deleted, another store's,
 * taken down) is simply absent, the same absence for every reason, so a cart
 * line can say "no longer sold" without saying why.
 *
 * Ids that are not UUIDs are dropped before any I/O; the caller bounds how
 * many it asks about (CART_LINES_MAX).
 *
 * `stopWhenNonePlaced`: answer null as soon as it is clear that none of the
 * products is sold here, before the seller, sales and `alongside` reads. A
 * product page asks for one product, so a scanner walking ids pays for one
 * read; a cart still wants the storefront's half to show its lines as no
 * longer sold.
 */
export async function gatePurchasableLines<Extra = undefined>(
  storefrontId: string,
  productIds: readonly string[],
  limit: GateBudget | GateBudgetSpent,
  alongside?: (admin: ReturnType<typeof createAdminClient>, ownerId: string) => Promise<Extra>,
  options: { stopWhenNonePlaced?: boolean } = {},
): Promise<PurchasableLines<Extra> | PageBusy | null> {
  if (!idSchema.safeParse(storefrontId).success) return null;
  const wanted = [...new Set(productIds.filter((id) => idSchema.safeParse(id).success))];

  // The budget is spent before the first read, so a scan pays before it learns
  // anything. rateLimitKey fails closed.
  if (!("spentBy" in limit)) {
    const key = await clientKey(await headers());
    if (!(await rateLimitKey(key, limit.action, limit.budget))) return PAGE_BUSY;
  }

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

  // A product is sold here when it is a tile, or a product a tile offers in
  // "Add to your order" (its details dialog links here). Any other product the
  // seller has not placed on this storefront has no page here, whatever its
  // status. Hidden sold-out tiles still count: the page then simply says sold
  // out.
  const tiles = config.blocks.flatMap((candidate) => (candidate.type === "product" ? [candidate] : []));
  const blocks = new Map(tiles.map((tile) => [tile.productId, tile]));
  const notTiles = wanted.filter((id) => !blocks.has(id));
  let offered = new Set<string>();
  if (notTiles.length > 0) {
    const found = await offeredByTiles(admin, storefront.owner_id, notTiles, {
      tileProductIds: tiles.map((tile) => tile.productId),
      productPage,
    });
    if (found === null) return PAGE_BUSY;
    offered = found;
  }
  const placed = wanted.filter((id) => blocks.has(id) || offered.has(id));
  if (options.stopWhenNonePlaced && placed.length === 0) return null;

  // Products, seller identity and the store's running sales all depend only
  // on the owner id already in hand, so they run together rather than one
  // after the other.
  const now = new Date();
  const [productsResult, { data: sellerRow, error: sellerError }, storeSalesResult, extra] = await Promise.all([
    placed.length > 0
      ? admin
          .from("products")
          .select(PUBLIC_PRODUCT_SELECT)
          .in("id", placed)
          .eq("owner_id", storefront.owner_id)
          .eq("status", "active")
      : Promise.resolve({ data: [] as PublicProductRow[], error: null }),
    admin
      .from("profiles")
      // Trader identity AND shipping terms, in ONE select: both are
      // account-level facts read off the same row, and asking for that row
      // twice on a public hot path would be two round trips for one read.
      .select(`${TRADER_GATE_SELECT}, ${SHIPPING_POLICY_SELECT}`)
      .eq("id", storefront.owner_id)
      .maybeSingle(),
    readStoreSales(admin, storefront.owner_id, now),
    alongside ? alongside(admin, storefront.owner_id) : Promise.resolve(undefined as Extra),
  ]);
  if (productsResult.error) {
    console.error("[purchasable] product read failed", productsResult.error);
    return PAGE_BUSY;
  }

  // THE REMOVAL GATE. A taken-down product is absent like one that never
  // existed: a page that said "removed" would tell a scanner exactly which
  // listings were worth looking at on an archive. The seller is told directly
  // instead.
  const rows = visiblePlacedRows(productsResult.data, placed);

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

  // THE PRICE. Which sales are running decides what these products cost, so
  // sales that could not be read are a price that is not known: "not right
  // now", never the regular price. A buyer shown (or charged) the full price
  // while the seller is advertising a sale is the one mistake a blip here
  // could otherwise make. Asked last, and only when something here IS for
  // sale, so a product that is not for sale at all is still the plain refusal.
  if (storeSalesResult === null && rows.length > 0) return PAGE_BUSY;
  const storeSales = storeSalesResult ?? [];

  const items = itemsOf(rows, blocks, storeSales);
  return {
    store: {
      ownerId: storefront.owner_id,
      storefront: { id: storefront.id, name: storefront.name },
      config,
      productPage,
      seller: buildSellerIdentity(gateRow as SellerIdentityRow | null),
      shippingPolicy: buildShippingPolicy(sellerError ? null : (sellerRow as ShippingPolicyRow | null)),
      storeSales,
      now,
    },
    items,
    extra: extra as Extra,
  };
}

/** The rows a products read returned that are for sale here: asked for
 *  (placed on this storefront) and not taken down. A taken-down product is
 *  absent like one that never existed. */
function visiblePlacedRows(data: unknown, placed: readonly string[]): PublicProductRow[] {
  return ((data ?? []) as PublicProductRow[]).filter(
    (row) => placed.includes(row.id) && isContentVisible(row.moderation_status),
  );
}

/** Each row as a gate item: its tile (the sold-out mark), and the store's
 *  running sales that cover it. */
function itemsOf(
  rows: readonly PublicProductRow[],
  blocks: ReadonlyMap<string, ProductBlock>,
  storeSales: readonly StoreSale[],
): Map<string, PurchasableItem> {
  return new Map(
    rows.map((row) => [row.id, { block: blocks.get(row.id) ?? null, row, sales: salesCovering(storeSales, row.id) }]),
  );
}

/**
 * MORE PRODUCTS FOR A GATE ALREADY PASSED: the cart's "Goes well with", which
 * only knows which products to ask about once the cart's own are read (their
 * add-on lists). The product half of the gate, asked again for these ids
 * under the same storefront, seller and sales: placed here (a tile, or a
 * tile's add-on), live, this owner's and not taken down. At most two reads
 * (the add-on hosts, the products), however many ids. Null when the database
 * did not answer.
 */
export async function loadStoreItems(
  store: Pick<PurchasableStore, "ownerId" | "config" | "productPage" | "storeSales">,
  productIds: readonly string[],
): Promise<Map<string, PurchasableItem> | null> {
  const wanted = [...new Set(productIds.filter((id) => idSchema.safeParse(id).success))];
  if (wanted.length === 0) return new Map();
  const admin = createAdminClient();
  const tiles = store.config.blocks.flatMap((candidate) => (candidate.type === "product" ? [candidate] : []));
  const blocks = new Map(tiles.map((tile) => [tile.productId, tile]));
  const notTiles = wanted.filter((id) => !blocks.has(id));
  const offered = notTiles.length
    ? await offeredByTiles(admin, store.ownerId, notTiles, {
        tileProductIds: tiles.map((tile) => tile.productId),
        productPage: store.productPage,
      })
    : new Set<string>();
  if (offered === null) return null;
  const placed = wanted.filter((id) => blocks.has(id) || offered.has(id));
  if (placed.length === 0) return new Map();
  const { data, error } = await admin
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .in("id", placed)
    .eq("owner_id", store.ownerId)
    .eq("status", "active");
  if (error) {
    console.error("[purchasable] more products read failed", error);
    return null;
  }
  return itemsOf(visiblePlacedRows(data, placed), blocks, store.storeSales);
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
  const found = await offeredByTiles(admin, ownerId, [productId], here);
  return found === null ? null : found.has(productId);
}

/** offeredByATile for several products in ONE read: which of `productIds` a
 *  live tile on this storefront offers. Null when the database did not answer. */
export async function offeredByTiles(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  productIds: readonly string[],
  here: { tileProductIds: readonly string[]; productPage: ProductPageConfig },
): Promise<Set<string> | null> {
  if (
    productIds.length === 0 ||
    here.tileProductIds.length === 0 ||
    !isProductPageSectionShown(here.productPage, "addOns")
  ) {
    return new Set();
  }
  const { data, error } = await admin
    .from("products")
    .select(`id, add_on_ids, ${MODERATION_GATE_SELECT}`)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .in("id", [...here.tileProductIds])
    .overlaps("add_on_ids", [...productIds]);
  if (error) {
    console.error("[purchasable] add-on host read failed", error);
    return null;
  }
  const offered = new Set<string>();
  for (const host of (data ?? []) as { add_on_ids: string[] | null; moderation_status: string | null }[]) {
    if (!isContentVisible(host.moderation_status)) continue;
    for (const id of host.add_on_ids ?? []) if (productIds.includes(id)) offered.add(id);
  }
  return offered;
}
