// SERVER ONLY. The public product read: the ONE place that decides what a
// buyer may see of a product, used by the hosted product page and by the
// editor's preview action so the two can never disagree.
//
// SECURITY MODEL, same as /api/embed/[key]: a service-role read behind an
// application gate, never an anon RLS policy. The gate itself lives in
// lib/products/purchasable.ts, shared with the checkout and its quote, so a
// product the page would refuse is a product nobody can pay for either. Every
// failure is the same `null`, which the route turns into the same 404, so
// nothing here is enumerable.
//
// The payload is BUILT field by field, never spread. That is what keeps
// digital_file_key, owner_id, raw stock numbers and R2 keys out of a buyer's
// hands by default rather than by remembering to strip them.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignGetUrl } from "@/lib/r2";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { purchaseUrlSchema } from "@/lib/validation/product";
import { toPublicStockBadge } from "@/lib/stock/public";
import { publicQuantityLimit } from "@/lib/products/quantity";
import {
  parseDetails,
  parseDocuments,
  parseGallery,
  parseOptionGroups,
  reconcileGalleryOptions,
} from "@/lib/products/detail";
import { loadPurchasable, type PublicProductRow } from "@/lib/products/purchasable";
import { checkoutAvailableFor } from "@/lib/checkout/availability";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { toCurrency } from "@/lib/format/money";
import type {
  ProductPageDocument,
  ProductPageImage,
  ProductPageProduct,
} from "@/types/product";
import type { ProductPageData, ProductPageReportScopes } from "@/types/product-page";

// The select and the row type live with the gate (lib/products/purchasable.ts),
// which reads them for every buyer-facing surface; re-exported for the editor
// preview, which builds the same payload from the same row.
export { PUBLIC_PRODUCT_SELECT, type PublicProductRow } from "@/lib/products/purchasable";

/** "PDF", "ZIP"... from a key's extension. Never the name, never the key. */
function formatFromKey(key: string | null): string | null {
  if (!key) return null;
  const lastSegment = key.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) return null;
  const extension = lastSegment.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : null;
}

/**
 * The buyer-safe product from a raw row. `soldOutFlag` is the tile's manual
 * flag on the storefront that linked here; the derived badge can also say
 * sold out on its own.
 */
export async function buildProductPageProduct(
  row: PublicProductRow,
  options: {
    soldOutFlag?: boolean;
    /** The storefront's productPage.showStock. Only the quantity ceiling reads
     *  it, and only to avoid disclosing a count the page itself is hiding —
     *  see publicQuantityLimit. Absent means "not shown", which is the safe
     *  answer for a caller that has not thought about it. */
    showStock?: boolean;
  } = {},
): Promise<ProductPageProduct> {
  const optionGroups = parseOptionGroups(row.option_groups);
  const gallery = reconcileGalleryOptions(parseGallery(row.gallery), optionGroups);

  const images: ProductPageImage[] = [];
  if (row.image_key) {
    const url = await presignGetUrl(row.image_key);
    if (url) images.push({ url, alt: row.title });
  }
  for (const image of gallery) {
    const url = await presignGetUrl(image.key);
    if (!url) continue;
    images.push({
      url,
      alt: image.alt || row.title,
      ...(image.optionId ? { optionId: image.optionId } : {}),
    });
  }

  // Re-gated on the way out: the schema is the write boundary, but a stored
  // value is trusted exactly as far as it still passes the same rule.
  const purchaseUrl =
    row.purchase_url && purchaseUrlSchema.safeParse(row.purchase_url).success
      ? row.purchase_url
      : null;

  // Certificates, manuals, spec sheets. Public and unconditional — unlike the
  // digital download, these are not the paywall, so every one that signs
  // successfully ships; one that fails to sign is dropped rather than shown
  // as a dead link.
  const documents: ProductPageDocument[] = [];
  for (const document of parseDocuments(row.documents)) {
    const url = await presignGetUrl(document.key);
    if (!url) continue;
    documents.push({ url, label: document.label, format: formatFromKey(document.key) });
  }

  const stock = toPublicStockBadge(row);
  const soldOut = Boolean(options.soldOutFlag) || stock?.state === "sold_out";

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    priceCents: row.price_cents,
    currency: toCurrency(row.currency),
    purchaseUrl,
    // A REFERENCE, not terms. The words it resolves to are the storefront's
    // own, which this page already carries; what crosses here is only which
    // set of them applies (see lib/storefront/shipping.ts).
    shippingProfileId: row.shipping_profile_id,
    images,
    optionGroups,
    details: parseDetails(row.details),
    documents,
    isDigital: row.digital_file_key !== null,
    digitalFormat: formatFromKey(row.digital_file_key),
    stock,
    soldOut,
    // A CEILING, not an inventory count. publicQuantityLimit narrows to the
    // shelf only where the badge above already published the number, so this
    // field cannot say more about stock than `stock` itself does.
    //
    // The tile's manual sold-out flag is deliberately NOT folded in: this is a
    // fact about the PRODUCT, and `soldOut` beside it is the fact about this
    // placement. The page hides the picker on `soldOut`, which keeps the two
    // separable — the editor's sold-out switch is live, and a ceiling zeroed
    // here could not be recovered when a seller switches it back.
    maxQuantity: publicQuantityLimit(
      {
        maxPerOrder: row.max_per_order,
        trackStock: row.track_stock,
        stockQuantity: row.stock_quantity,
        lowStockThreshold: row.low_stock_threshold,
      },
      { stockShown: options.showStock === true },
    ),
  };
}

/** Everything the page renders. No owner id, no embed settings, no keys. */
export type PublicProductPage = ProductPageData;

/**
 * The store name a buyer should see in metadata and share cards.
 *
 * Precedence: legal business name > buyer-facing header name > internal row
 * name. Matches the order `SellerBlock` uses for its own heading, so the
 * metadata and the on-page identity can never disagree about whose name this
 * is. The function is a named export so it can be tested independently of the
 * full page load.
 */
export function resolveDisplayName(page: PublicProductPage): string {
  const { storefront } = page;
  if (storefront.seller.businessName) return storefront.seller.businessName;
  if (storefront.header?.show && storefront.header.name) return storefront.header.name;
  return storefront.name;
}

export type PublicProductPageResult = {
  page: PublicProductPage;
  /** For the view signal only. Never placed on `page`. */
  ownerId: string;
};

/**
 * Load a product page for a buyer, or `null` for every reason it cannot be
 * shown. The gate is lib/products/purchasable.ts, shared with the checkout so
 * the two can never disagree about what is for sale; what this adds is the
 * PAGE: the buyer-safe product, the report scopes, and the signed URLs.
 * Wrapped in React's `cache` so generateMetadata and the page body share one
 * read (and one rate-limit token) per request.
 */
export const getPublicProductPage = cache(
  async (
    storefrontId: string,
    productId: string,
  ): Promise<PublicProductPageResult | null> => {
    const gate = await loadPurchasable(
      storefrontId,
      productId,
      { action: "product_page", budget: RATE_LIMITS.productPage },
      reportScopesFor,
    );
    if (!gate) return null;
    const { config, productPage, block, row, seller, shippingPolicy } = gate;

    const product = await buildProductPageProduct(row, {
      soldOutFlag: block.soldOut,
      showStock: productPage.showStock,
    });

    const theme = config.theme;
    const backgroundImageUrl =
      theme.background.kind === "image" ? await presignGetUrl(theme.background.key) : null;
    const customFontUrl = theme.customFont ? await presignGetUrl(theme.customFont.key) : null;
    const pagePhotoUrl = productPage.backgroundImage
      ? await presignGetUrl(productPage.backgroundImage.key)
      : null;

    return {
      page: {
        storefront: {
          id: gate.storefront.id,
          name: gate.storefront.name,
          theme,
          ...(config.header ? { header: config.header } : {}),
          productPage,
          shippingPolicy,
          seller,
          backgroundImageUrl,
          customFontUrl,
          pagePhotoUrl,
          checkout: checkoutAvailableFor(gate),
        },
        product,
        productUrl: productPageUrl(gate.storefront.id, product.id),
        reportScopes: gate.extra,
      },
      ownerId: gate.ownerId,
    };
  },
);

/**
 * Which of the report dialog's wider options apply to this seller: the whole
 * storefront once they sell more than one live product, the seller themselves
 * once they run more than one storefront. Counted as a buyer could see them
 * (live and not taken down), head-only, alongside the page's other reads.
 *
 * A failed count offers the narrower dialog: the product can always be
 * reported, and a wider option the page cannot justify is noise.
 */
async function reportScopesFor(
  admin: ReturnType<typeof createAdminClient>,
  ownerId: string,
): Promise<ProductPageReportScopes> {
  const [products, storefronts] = await Promise.all([
    admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("status", "active")
      .eq("moderation_status", "ok"),
    admin
      .from("storefronts")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("moderation_status", "ok"),
  ]);
  if (products.error || storefronts.error) {
    console.error(
      "[product-page] report scope counts failed",
      products.error?.message ?? storefronts.error?.message,
    );
  }
  return {
    storefront: (products.count ?? 0) > 1,
    seller: (storefronts.count ?? 0) > 1,
  };
}
