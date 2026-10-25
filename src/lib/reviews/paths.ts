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
