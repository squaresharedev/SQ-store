/** Where the product routes live, in one place so a route that moves is a
 *  one-line change. Pure strings: safe on server and client. The admin panel's
 *  lib/moderation/store-links.ts mirrors the edit path for its notices. */
export const PRODUCTS_PATH = "/products";

/** The edit form for one product. */
export function productEditPath(id: string): string {
  return `${PRODUCTS_PATH}/${id}/edit`;
}
