/**
 * Pure builders for schema.org JSON-LD structured data. No I/O, no React:
 * this module is safe to call from server components, generateMetadata, and
 * unit tests alike. The one invariant: only claim what the page itself shows
 * the buyer.
 */

import { appUrl } from "@/lib/app-url";
import { clipText } from "@/lib/format/text";
import { REVIEW_RATING_MAX, REVIEW_RATING_MIN } from "@/lib/reviews/limits";
import { productOgImagePath } from "@/lib/products/paths";
import { productPageUrl, storefrontPageUrl } from "@/lib/storefront/product-page-url";
import type { ProductPageData } from "@/types/product-page";
import { readingOrder } from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";
import type { ProductReviews } from "@/types/review";

/**
 * Serializes a JSON-LD object for use as a script element's text child.
 *
 * WHY THE `<` IS PRE-ESCAPED. A script's text child is emitted raw, so a
 * seller who puts a closing script tag in a product title would otherwise
 * break out of the block. React does defend against that on the server (it
 * rewrites the sequence to unicode escapes), but it does NOT produce the same
 * text on the client, so the two disagree and React discards and re-renders
 * the whole tree on every product page load. Escaping `<` ourselves is the
 * fix for both at once: `<` is valid JSON, it cannot close the element,
 * and server and client now emit identical text.
 */
export function jsonLdText(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * The @id shared by the seller node on a product page and the shop node on
 * the storefront page. Appending "#store" to the storefront URL gives a
 * stable fragment IRI that lets a reader deduplicate both into one shop
 * without a separate entity registry.
 */
export function storefrontNodeId(storefrontUrl: string): string {
  return `${storefrontUrl}#store`;
}

/** How much of a product's description its structured data carries. */
const DESCRIPTION_MAX = 500;

/**
 * BUY-07: the Product + Offer JSON-LD for a hosted product page, built from
 * the same data that fills its meta tags so the two can never disagree. Pass
 * the page payload, the buyer-facing store name (resolveDisplayName), and the
 * product's review summary (null leaves the aggregateRating out).
 *
 * WHAT IS DELIBERATELY NOT HERE, because the page does not show it or the data
 * does not carry it: shippingDetails (the dispatch line and delivery times are
 * the seller's prose, and a seller's own shipping text can replace the
 * generated one), hasMerchantReturnPolicy (the seller's own returns text can
 * replace their window, and the 14-day withdrawal right is the platform's
 * statement for EU buyers, not the seller's policy), sku, gtin, mpn, brand and
 * itemCondition (products have no such fields).
 */
export function productStructuredData(
  page: ProductPageData,
  displayName: string,
  reviews: ProductReviews | null,
): object {
  const { product, storefront } = page;
  const sfUrl = storefrontPageUrl(storefront.id);

  // One line, clipped without splitting an emoji, as the meta description is.
  const description = product.description
    ? clipText(product.description.replace(/\s+/g, " ").trim(), DESCRIPTION_MAX)
    : "";

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    // The page's own canonical address, on the product as well as on its
    // offer, where readers that predate the product-level url look for it.
    url: page.productUrl,
    ...(description ? { description } : {}),
    // The same stable redirect route as og:image: the presigned photo URL a
    // product row carries expires in hours (BUY-01, the product page's
    // generateMetadata).
    ...(product.images.length > 0 ? { image: appUrl(productOgImagePath(product.id)) } : {}),
    // The same approved reviews the page shows, from the same summary row.
    ...(reviews && reviews.summary.count > 0 && reviews.summary.average !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviews.summary.average.toFixed(2),
            reviewCount: reviews.summary.count,
            bestRating: REVIEW_RATING_MAX,
            worstRating: REVIEW_RATING_MIN,
          },
        }
      : {}),
    offers: {
      "@type": "Offer",
      // What it costs today: the sale price while a sale runs, valid until
      // the sale ends.
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: product.currency,
      ...(product.sale?.endsAt ? { priceValidUntil: product.sale.endsAt.slice(0, 10) } : {}),
      availability: product.soldOut
        ? "https://schema.org/OutOfStock"
        : product.stock?.state === "low_stock"
          ? "https://schema.org/LimitedAvailability"
          : "https://schema.org/InStock",
      url: page.productUrl,
      // OnlineStore (a subtype of Organization) with the same @id as the
      // storefront page's shop node, so a reader joins them into one entity.
      // The storefront page IS linked from every product page (the PageShell's
      // shopHref breadcrumb), so its URL is something the buyer has access to.
      // No description: the storefront page's node carries the shop's own, and
      // a second one here (the seller's bio) would contradict it on one @id.
      seller: {
        "@type": "OnlineStore",
        "@id": storefrontNodeId(sfUrl),
        name: displayName,
        url: sfUrl,
      },
    },
  };
}

/**
 * The JSON-LD graph emitted on the hosted storefront page. An OnlineStore
 * node shares its @id with the seller node on every product page, letting a
 * reader merge both into one shop. The ItemList names the products in the
 * order a buyer reads the board (top to bottom, then left to right, as
 * StorefrontBoard draws it), with ids whose product is missing or already
 * listed skipped.
 *
 * Address, email and phone are NOT included: the storefront page renders only
 * the business name in its footer disclosure; SellerBlock (which shows the
 * full identity) appears only on individual product pages.
 */
export function storefrontStructuredData(
  page: StorefrontPageData,
  displayName: string,
): object {
  // Walk the board in reading order, not the order its blocks were stored in
  // (which is the order they were added). Skip ids with no matching product
  // and second appearances of one product (the same product on two tiles).
  const products = new Map(page.products.map((product) => [product.id, product]));
  const seen = new Set<string>();
  const items: Array<{ "@type": "ListItem"; position: number; url: string; name: string }> = [];

  for (const block of readingOrder(page.blocks)) {
    if (block.type !== "product" || seen.has(block.productId)) continue;
    seen.add(block.productId);
    const product = products.get(block.productId);
    if (!product) continue;
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      url: productPageUrl(page.id, product.id),
      name: product.title,
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OnlineStore",
        "@id": storefrontNodeId(page.url),
        name: displayName,
        url: page.url,
        // The header's strapline, only while the page shows it.
        ...(page.header?.show && page.header.bio ? { description: page.header.bio } : {}),
      },
      {
        "@type": "ItemList",
        name: displayName,
        url: page.url,
        numberOfItems: items.length,
        itemListElement: items,
      },
    ],
  };
}
