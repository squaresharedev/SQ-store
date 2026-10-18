// SERVER ONLY. The public read behind a hosted storefront, /s/[storefrontId]:
// the whole board a seller designed, on a page of its own, for sellers who
// have no website to embed it in and for anyone they send the link to.
//
// SECURITY MODEL, the same as the hosted product page (lib/products/
// purchasable.ts) and /api/embed/[key]: a service-role read behind an
// application gate, never an anon RLS policy. Every refusal is the same
// `null`, which the route turns into the same 404, so nothing is enumerable.
//
// THE GATE IS THE PRODUCT PAGE'S OWN, storefront half:
//   - the visitor's rate limit, spent before the first read;
//   - the storefront exists, parses, and has not been taken down;
//   - PRODUCT PAGES ARE ON for it. That switch is the seller's "this storefront
//     has pages buyers can open", and a shop front whose tiles lead nowhere is
//     not a shop. So a storefront has a page exactly when its products do, and
//     no storefront becomes public that its seller has not already published;
//   - the seller's trader identity is complete (the read side of the publish
//     gate): a buyer is not shown offers without being told who makes them.
//
// THE PAYLOAD IS BUILT, never spread, tile by tile:
//   - a product tile is drawn only for a product that is live (active, this
//     seller's, not taken down). Anything else is dropped whole, like the
//     embed drops a removed product: a hole labelled "something was here" is
//     neither the buyer's business nor something they can act on;
//   - of each product, only what a tile prints: title, price, photo. No stock
//     count, no per-order limit, no description, no object key.
//
// THE PRICE IS THE PRODUCT PAGE'S. A tile prints what one costs right now, a
// running sale included, worked out by the same two functions the product page
// and the checkout use (lib/discounts/public.ts), so the number on a tile is
// the number on the page it leads to and the number that is charged. The
// store's sales are read once for the whole board; if they cannot be read the
// board is "not right now" rather than a board of prices nobody can vouch for.

import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignGetUrl } from "@/lib/r2";
import { emailProofRequired } from "@/lib/contact-verification/availability";
import {
  loadProductSales,
  msUntilSaleEnds,
  readStoreSales,
  salesCovering,
  type ProductPricing,
} from "@/lib/discounts/public";
import { toCurrency } from "@/lib/format/money";
import { MODERATION_GATE_SELECT, isContentVisible } from "@/lib/moderation/removal";
import { PAGE_BUSY, type PageBusy } from "@/lib/public/busy";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import {
  TRADER_GATE_SELECT,
  buildSellerIdentity,
  buildTraderIdentityInput,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import { isTraderIdentityComplete } from "@/lib/settings/trader-identity";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { productPagePath, storefrontPageUrl } from "@/lib/storefront/product-page-url";
import { uuidField } from "@/lib/validation/inputs";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { blockKey, buyerVisibleBlocks, type StorefrontBlock, type StorefrontConfig } from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";

export type PublicStorefrontPageResult = {
  page: StorefrontPageData;
  /** For the view signal only. Never placed on `page`. */
  ownerId: string;
  /** How long until the first sale price on the board stops being true, or
   *  null when none of them ends. The page reads its prices again then
   *  (components/product-page/PriceRefresh). */
  saleEndsInMs: number | null;
};

/** The storefront columns buildStorefrontPage reads. Select exactly these.
 *  `as const`: the client types a row from the literal text of its select. */
export const STOREFRONT_PAGE_SELECT = `id, name, owner_id, config, ${MODERATION_GATE_SELECT}` as const;

export type StorefrontPageRow = {
  id: string;
  name: string;
  owner_id: string;
  config: unknown;
  moderation_status: string | null;
};

/** The columns a tile needs, plus the two the gate reads. */
const TILE_PRODUCT_SELECT = `id, title, price_cents, currency, image_key, created_at, ${MODERATION_GATE_SELECT}`;

type TileProductRow = {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  image_key: string | null;
  /** When it was listed, for a sale's pricing. Never placed on a tile. */
  created_at: string | null;
  moderation_status: string | null;
};

const idSchema = uuidField();

/** Products asked for in one read, so the request's address stays well inside
 *  what a proxy will carry however many tiles a board holds. */
const TILE_PRODUCTS_PER_READ = 100;

/** The board's live products, read in runs: every row, or the first error. */
async function readTileProducts(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
  productIds: readonly string[],
): Promise<{ data: TileProductRow[]; error: { message: string } | null }> {
  const runs: string[][] = [];
  for (let start = 0; start < productIds.length; start += TILE_PRODUCTS_PER_READ) {
    runs.push(productIds.slice(start, start + TILE_PRODUCTS_PER_READ));
  }
  const answers = await Promise.all(
    runs.map((ids) =>
      admin.from("products").select(TILE_PRODUCT_SELECT).in("id", ids).eq("owner_id", ownerId).eq("status", "active"),
    ),
  );
  const failed = answers.find((answer) => answer.error);
  return failed?.error
    ? { data: [], error: failed.error }
    : { data: answers.flatMap((answer) => (answer.data ?? []) as unknown as TileProductRow[]), error: null };
}

/**
 * Load a storefront's page for a buyer: `null` for every reason it cannot be
 * shown, PAGE_BUSY when the reason is only "not right now" (the visitor's rate
 * limit is spent, or a read failed: see lib/public/busy.ts).
 *
 * Wrapped in React's `cache` so generateMetadata and the page body share one
 * read, and one rate-limit token, per request.
 */
export const getPublicStorefrontPage = cache(
  async (storefrontId: string): Promise<PublicStorefrontPageResult | PageBusy | null> => {
    if (!idSchema.safeParse(storefrontId).success) return null;

    // Spent before the first read, so a scan pays before it learns anything.
    // rateLimitKey fails closed.
    const visitor = await clientKey(await headers());
    if (!(await rateLimitKey(visitor, "storefront_page", RATE_LIMITS.storefrontPage))) return PAGE_BUSY;

    const admin = createAdminClient();
    const { data: storefront, error: storefrontError } = await admin
      .from("storefronts")
      .select(STOREFRONT_PAGE_SELECT)
      .eq("id", storefrontId)
      .maybeSingle();
    if (storefrontError) {
      console.error("[storefront page] storefront read failed", storefrontError.message);
      return PAGE_BUSY;
    }
    if (!storefront) return null;
    return buildStorefrontPage(storefront, {
      tileHref: (productId) => productPagePath(storefront.id, productId),
    });
  },
);

/**
 * Everything past "which storefront": the rest of the gate, and the payload.
 *
 * Shared by the two ways a buyer is shown a seller's board, so they cannot
 * drift apart on what is public: the hosted page above, which finds the
 * storefront by its id, and the embed frame (lib/storefront/
 * embed-frame-loader.ts), which finds it by its embed key and has one more
 * question to ask of its config first (`allow`).
 *
 * The caller has already spent the visitor's rate limit and read the row.
 */
export async function buildStorefrontPage(
  storefront: StorefrontPageRow,
  options: {
    /** Where a product's tile leads. */
    tileHref: (productId: string) => string;
    /** One more refusal, asked of the parsed config before anything is read
     *  about the seller or the products. */
    allow?: (config: StorefrontConfig) => boolean;
  },
): Promise<PublicStorefrontPageResult | PageBusy | null> {
  if (!isContentVisible(storefront.moderation_status)) return null;

  const config = parseStoredStorefrontConfig(storefront.config);
  if (!config) return null;
  if (options.allow && !options.allow(config)) return null;
  const productPage = resolveProductPage(config);
  if (!productPage.enabled) return null;

  const admin = createAdminClient();
  const visible = buyerVisibleBlocks(config);
  const productIds = [
    ...new Set(visible.flatMap((block) => (block.type === "product" ? [block.productId] : []))),
  ];

  // The seller's identity, the tiles' products and the store's running sales
  // depend only on the owner already in hand, so they are read together. One
  // `now` prices the whole board.
  const now = new Date();
  const [{ data: sellerRow, error: sellerError }, products, storeSales] = await Promise.all([
    admin.from("profiles").select(TRADER_GATE_SELECT).eq("id", storefront.owner_id).maybeSingle(),
    readTileProducts(admin, storefront.owner_id, productIds),
    // A board with no products has no prices to get wrong.
    productIds.length === 0 ? Promise.resolve([]) : readStoreSales(admin, storefront.owner_id, now),
  ]);
  if (products.error) {
    console.error("[storefront page] product read failed", products.error.message);
    return PAGE_BUSY;
  }
  if (sellerError) {
    console.error("[storefront page] seller identity read failed", sellerError.message);
  }

  // THE READ SIDE OF THE PUBLISH GATE. Fail-closed on a read error: an
  // identity we could not read is one we cannot display.
  const gateRow = sellerError ? null : (sellerRow as TraderGateRow | null);
  if (
    !isTraderIdentityComplete(buildTraderIdentityInput(gateRow), {
      requireVerifiedEmail: emailProofRequired(),
    })
  ) {
    return null;
  }

  // Sales that could not be read are prices that are not known: see the
  // header. Asked after the gate, so a storefront that is not public at all is
  // still the plain refusal.
  if (storeSales === null) return PAGE_BUSY;

  // THE REMOVAL GATE, product half: a product staff have taken down has no
  // tile, the same as one that is a draft or was deleted.
  const live = products.data.filter((row) => isContentVisible(row.moderation_status));
  const liveIds = new Set(live.map((row) => row.id));
  const blocks: StorefrontBlock[] = visible.filter(
    (block) => block.type !== "product" || liveIds.has(block.productId),
  );

  const pricing = await loadProductSales(admin, {
    ownerId: storefront.owner_id,
    products: live.map((row) => ({
      productId: row.id,
      regularPriceCents: row.price_cents,
      currency: toCurrency(row.currency),
      sales: salesCovering(storeSales, row.id),
      listedAt: row.created_at ?? null,
    })),
  });

  const { theme } = config;
  const [tiles, imageUrls, backgroundImageUrl, customFontUrl] = await Promise.all([
    Promise.all(live.map((row) => tileProduct(row, options.tileHref(row.id), pricing.get(row.id)))),
    signImageBlocks(blocks),
    theme.background.kind === "image" ? presignGetUrl(theme.background.key) : null,
    theme.customFont ? presignGetUrl(theme.customFont.key) : null,
  ]);

  return {
    page: {
      id: storefront.id,
      name: storefront.name,
      theme,
      ...(config.header ? { header: config.header } : {}),
      blocks,
      products: tiles,
      imageUrls,
      backgroundImageUrl,
      customFontUrl,
      seller: buildSellerIdentity(gateRow as SellerIdentityRow | null),
      allowIndexing: productPage.allowIndexing,
      url: storefrontPageUrl(storefront.id),
    },
    ownerId: storefront.owner_id,
    saleEndsInMs: msUntilSaleEnds(pricing.values(), now),
  };
}

/**
 * One product, as its tile shows it. Built field by field: see the header.
 *
 * `pricing` is what it costs right now. While a sale lowers it the tile also
 * carries the regular price (struck through beside it) and, when the records
 * prove one, the percentage for its sale chip. Nothing else about the sale.
 */
async function tileProduct(
  row: TileProductRow,
  href: string,
  pricing: ProductPricing | undefined,
): Promise<StorefrontTileProduct> {
  const sale = pricing?.sale ?? null;
  return {
    id: row.id,
    title: row.title,
    price: (pricing?.priceCents ?? row.price_cents) / 100,
    ...(sale ? { regularPrice: sale.regularPriceCents / 100 } : {}),
    ...(sale && sale.offerPercent !== null ? { offerPercent: sale.offerPercent } : {}),
    currency: toCurrency(row.currency),
    imageUrl: row.image_key ? await presignGetUrl(row.image_key) : null,
    href,
  };
}

/**
 * Signed, expiring URLs for the board's image blocks, by block key. The stored
 * config holds only object keys and the bucket is private, so the page is
 * handed URLs minted for this response. A block R2 cannot sign for is left out
 * and draws nothing.
 */
async function signImageBlocks(blocks: readonly StorefrontBlock[]): Promise<Record<string, string>> {
  const signed = await Promise.all(
    blocks.flatMap((block) =>
      block.type === "image"
        ? [presignGetUrl(block.key).then((url) => [blockKey(block), url] as const)]
        : [],
    ),
  );
  return Object.fromEntries(signed.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}
