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
import { listAllProducts } from "@/lib/products/queries";
import { getActiveAccount } from "@/lib/team/account-context";
import { loadProductSales, readStoreSales, salesCovering, type ProductPricing } from "@/lib/discounts/public";
import { presignGetUrl } from "@/lib/r2";
import { readRatingSummaries } from "@/lib/reviews/ratings";
import { secondPhotoKey } from "@/lib/storefront/tile-extras";
import type { Product, ProductTileSale } from "@/types/product";

/** One product to price for a preview. */
type PreviewProduct = Pick<Product, "id" | "price" | "currency"> & {
  /** When it was listed (products.created_at). Absent = looked up here. */
  listedAt?: string | null;
};

/** The most listing dates one preview looks up: every product a store can
 *  hold on the largest plan, with room to spare. */
const LISTING_DATES_MAX = 1000;

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
    const listedAt = new Map<string, string>();
    if (products.some((product) => product.listedAt === undefined)) {
      const { data } = await admin
        .from("products")
        .select("id, created_at")
        .eq("owner_id", ownerId)
        .limit(LISTING_DATES_MAX);
      for (const row of data ?? []) listedAt.set(row.id, row.created_at);
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
 */
export async function listStorefrontProducts(): Promise<Product[]> {
  const [account, products] = await Promise.all([getActiveAccount(), listAllProducts()]);
  if (!account) return products;
  const [priced, extras] = await Promise.all([
    withRunningSales(account.accountId, products),
    loadSellerCardExtras(account.accountId, products),
  ]);
  return priced.map((product) => {
    const extra = extras.get(product.id);
    return extra ? { ...product, ...extra } : product;
  });
}

/**
 * What the seller's cards can show beyond the price: each product's second
 * photo and its buyers' rating, so a card switched to show either does so the
 * moment the switch is pressed. The stock line needs nothing from here: the
 * seller's own counts are already on the product.
 *
 * A failed read leaves them out, as above: a preview without stars beats no
 * designer.
 */
async function loadSellerCardExtras(
  ownerId: string,
  products: readonly Product[],
): Promise<Map<string, Pick<Product, "hoverImageUrl" | "rating">>> {
  if (products.length === 0) return new Map();
  try {
    const admin = createAdminClient();
    const [{ data, error }, ratings] = await Promise.all([
      admin.from("products").select("id, image_key, gallery").eq("owner_id", ownerId).limit(LISTING_DATES_MAX),
      readRatingSummaries(admin, products.map((product) => product.id), "storefront designer"),
    ]);
    if (error) console.error("[storefront designer] gallery read failed", error.message);
    const photos = new Map(
      await Promise.all(
        ((data ?? []) as { id: string; image_key: string | null; gallery: unknown }[]).map(async (row) => {
          const key = row.image_key ? secondPhotoKey(row.gallery) : null;
          return [row.id, key ? await presignGetUrl(key) : null] as const;
        }),
      ),
    );
    const extras = new Map<string, Pick<Product, "hoverImageUrl" | "rating">>();
    for (const product of products) {
      const hoverImageUrl = photos.get(product.id);
      const rating = ratings.get(product.id);
      if (hoverImageUrl || rating) {
        extras.set(product.id, { ...(hoverImageUrl ? { hoverImageUrl } : {}), ...(rating ? { rating } : {}) });
      }
    }
    return extras;
  } catch (error) {
    console.error("[storefront designer] card extras failed", error instanceof Error ? error.message : String(error));
    return new Map();
  }
}
