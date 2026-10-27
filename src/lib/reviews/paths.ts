import { PRODUCTS_PATH } from "@/lib/products/paths";

/**
 * Where the review routes live. Pure strings: safe on server and client.
 */

/** GET a page of a product's reviews; POST a buyer's review. */
export function productReviewsApiPath(productId: string): string {
  return `/api/products/${encodeURIComponent(productId)}/reviews`;
}

/** POST a seller's review import. */
export const REVIEW_IMPORT_API_PATH = "/api/sellers/import-reviews";

/** The dashboard page that imports reviews. */
export const REVIEWS_IMPORT_PATH = `${PRODUCTS_PATH}/import-reviews`;

/** The dashboard page where a seller reads and moderates their reviews. */
export const REVIEWS_PATH = `${PRODUCTS_PATH}/reviews`;

/** `?filter=` on the reviews page (REVIEW_MODERATION_FILTERS). */
export const REVIEWS_FILTER_PARAM = "filter";

/** The reviews page's other narrowing params (lib/reviews/seller-filters.ts). */
export const REVIEWS_SEARCH_PARAM = "q";
export const REVIEWS_RATING_PARAM = "rating";
export const REVIEWS_PRODUCT_PARAM = "product";
export const REVIEWS_SOURCE_PARAM = "source";
export const REVIEWS_SORT_PARAM = "sort";
export const REVIEWS_PAGE_PARAM = "page";

/** The reviews page on one filter: "held" is where a held review waits. */
export function reviewsFilterPath(filter: "held" | "hidden"): string {
  return `${REVIEWS_PATH}?${REVIEWS_FILTER_PARAM}=${filter}`;
}
