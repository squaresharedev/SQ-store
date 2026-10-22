/** Where the product routes live, in one place so a route that moves is a
 *  one-line change. Pure strings: safe on server and client. The admin panel's
 *  lib/moderation/store-links.ts mirrors the edit path for its notices. */
export const PRODUCTS_PATH = "/products";

/** The edit form for one product. */
export function productEditPath(id: string): string {
  return `${PRODUCTS_PATH}/${id}/edit`;
}

/** A product's main photo, from our own origin, for the store's own members
 *  (app/api/products/[id]/photo): pixels a page can read, which a presigned
 *  R2 URL on another origin are not. */
export function productPhotoPath(id: string): string {
  return `/api${PRODUCTS_PATH}/${encodeURIComponent(id)}/photo`;
}
