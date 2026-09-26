/** Where the storefront routes live, in one place so a route that moves is a
 *  one-line change instead of a search. Pure strings: safe on server and client. */
export const STOREFRONT_LIST_PATH = "/storefront";

/** The full-screen designer for one storefront. */
export function storefrontEditorPath(id: string): string {
  return `${STOREFRONT_LIST_PATH}/${id}`;
}

/** The embed settings page for one storefront. */
export function storefrontEmbedPath(id: string): string {
  return `${STOREFRONT_LIST_PATH}/${id}/embed`;
}
