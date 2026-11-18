// SERVER ONLY. What a seller's own view of a storefront (the designer, its
// previews, the storefront list) shows for a product's price: the price a
// buyer is shown right now, a running sale included.
//
// Worked out by the functions the hosted storefront itself uses
// (lib/discounts/public.ts), so the canvas cannot show a seller one price while
// the page they publish shows buyers another.
//
// A service-role read, like getSellerIdentity: what a sale's percentage is
// measured against comes from product_price_history, which no signed-in role
// can read. The caller has already settled which store the reader may see (the
// active account), and every read here names that owner.

import { createAdminClient } from "@/lib/supabase/admin";
import { productsFromRows, listAllProductRows } from "@/lib/products/queries";
import { getActiveAccount } from "@/lib/team/account-context";
import { loadProductSales, readStoreSales, salesCovering, type ProductPricing } from "@/lib/discounts/public";
import { presignGetUrl } from "@/lib/r2";
import { toCurrency } from "@/lib/format/money";
import { readRatingSummaries } from "@/lib/reviews/ratings";
import { secondPhotoKey } from "@/lib/storefront/tile-extras";
import type { Product, ProductTileSale } from "@/types/product";

/** One product to price for a preview. */
type PreviewProduct = Pick<Product, "id" | "price" | "currency"> & {
  /** When it was listed (products.created_at). Absent = looked up here. */
  listedAt?: string | null;
};

/** A product's pricing as a tile draws it, or undefined without a sale. */
export function tileSaleOf(pricing: ProductPricing | undefined): ProductTileSale | undefined {
  return pricing?.sale ? { price: pricing.priceCents / 100, offerPercent: pricing.sale.offerPercent } : undefined;
}

/**
 * The store's running sales, priced for these products, by product id. An
 * empty answer when they could not be read: this is a seller's preview, and a
 * preview at the listed price is better than no designer. (The buyer's pages
 * make the opposite choice, see lib/discounts/public.ts.)
 */
export async function loadPreviewPricing(
  ownerId: string,
  products: readonly PreviewProduct[],
): Promise<Map<string, ProductPricing>> {
  if (products.length === 0) return new Map();
  try {
    const admin = createAdminClient();
    const sales = await readStoreSales(admin, ownerId, new Date());
    if (!sales || sales.length === 0) return new Map();

    // When each product was listed, for the ones the caller did not say: a
    // product younger than 30 days is measured from its own start. A failed
    // read leaves them unknown, which only costs such a product its percentage.
    // Uses the React-cached listAllProductRows so a page that already loaded
    // the catalogue (the storefront designer, the list previews) pays nothing.
    const listedAt = new Map<string, string>();
    if (products.some((product) => product.listedAt === undefined)) {
      const rows = await listAllProductRows();
      for (const row of rows) listedAt.set(row.id, row.created_at);
    }

    return await loadProductSales(admin, {
      ownerId,
      products: products.map((product) => ({
        productId: product.id,
        regularPriceCents: Math.round(product.price * 100),
        currency: product.currency,
        sales: salesCovering(sales, product.id),
        listedAt: product.listedAt ?? listedAt.get(product.id) ?? null,
      })),
    });
  } catch (error) {
    console.error("[discounts] preview pricing failed", error instanceof Error ? error.message : String(error));
    return new Map();
  }
}

/**
 * These products as a storefront draws them right now: each one a running sale
 * lowers carries it (Product.sale), the rest are returned as they came.
 */
export async function withRunningSales(ownerId: string, products: Product[]): Promise<Product[]> {
  const pricing = await loadPreviewPricing(ownerId, products);
  if (pricing.size === 0) return products;
  return products.map((product) => {
    const sale = tileSaleOf(pricing.get(product.id));
    return sale ? { ...product, sale } : product;
  });
}

/**
 * The ACTIVE store's whole catalogue as its storefronts draw it right now:
 * listAllProducts, with each running sale on the product it lowers. For the
 * pages that draw a board to its seller (the designer, the storefront list's
 * previews, the embed settings).
 *
 * When `only` is given, gallery signing and ratings are restricted to those
 * product ids. Pass `placedProductIds(storefronts)` from the list page so
 * unplaced products (up to 500 of them) do not get their hover images signed.
 */
export async function listStorefrontProducts(opts?: {
  only?: ReadonlySet<string>;
}): Promise<Product[]> {
  const [account, allRows] = await Promise.all([
    getActiveAccount(),
    listAllProductRows(),
  ]);
  if (!account) return [];

  // Sign only the placed/visible subset. All other rows are lean objects used
  // for pricing (so readPriorPrices can batch the whole catalogue at once).
  const targetRows = opts?.only ? allRows.filter((r) => opts.only!.has(r.id)) : allRows;
  const products = await productsFromRows(targetRows);
  if (products.length === 0) return products;

  // Pass ALL rows as lean pricing inputs so the price-history batch covers the
  // full catalogue, not just the placed subset.
  const allForPricing = allRows.map((r) => ({
    id: r.id,
    price: r.price_cents / 100,
    currency: toCurrency(r.currency),
    listedAt: r.created_at,
  }));

  const [pricing, extras] = await Promise.all([
    loadPreviewPricing(account.accountId, allForPricing),
    loadSellerCardExtras(opts?.only),
  ]);
  return products.map((product) => {
    const p = pricing.get(product.id);
    const sale = p ? tileSaleOf(p) : undefined;
    const extra = extras.get(product.id);
    return { ...product, ...(sale ? { sale } : {}), ...(extra ?? {}) };
  });
}

/**
 * What the seller's cards can show beyond the price: each product's second
 * photo and its buyers' rating, so a card switched to show either does so the
 * moment the switch is pressed. The stock line needs nothing from here: the
 * seller's own counts are already on the product.
 *
 * Uses the React-cached listAllProductRows for the gallery data, avoiding a
 * second products read on pages that already loaded the catalogue. When `only`
 * is given, signing and rating are restricted to those product ids (the list
 * page passes the placed ids so non-placed products are not signed).
 *
 * A failed read leaves the extras out: a preview without stars beats no designer.
 */
async function loadSellerCardExtras(
  only?: ReadonlySet<string>,
): Promise<Map<string, Pick<Product, "hoverImageUrl" | "rating">>> {
  try {
    const admin = createAdminClient();
    const allRows = await listAllProductRows();
    const target = only ? allRows.filter((row) => only.has(row.id)) : allRows;
    if (target.length === 0) return new Map();
    const [photos, ratings] = await Promise.all([
      Promise.all(
        target.map(async (row) => {
          const key = row.image_key ? secondPhotoKey(row.gallery) : null;
          return [row.id, key ? await presignGetUrl(key) : null] as const;
        }),
      ),
      readRatingSummaries(admin, target.map((row) => row.id), "storefront designer"),
    ]);
    const photoMap = new Map(photos);
    const extras = new Map<string, Pick<Product, "hoverImageUrl" | "rating">>();
    for (const row of target) {
      const hoverImageUrl = photoMap.get(row.id);
      const rating = ratings.get(row.id);
      if (hoverImageUrl || rating) {
        extras.set(row.id, { ...(hoverImageUrl ? { hoverImageUrl } : {}), ...(rating ? { rating } : {}) });
      }
    }
    return extras;
  } catch (error) {
    console.error("[storefront designer] card extras failed", error instanceof Error ? error.message : String(error));
    return new Map();
  }
}
