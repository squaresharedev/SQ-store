import { MODERATED_FILTER } from "@/types/product";

/** Where the product routes live, in one place so a route that moves is a
 *  one-line change. Pure strings: safe on server and client. The admin panel's
 *  lib/moderation/store-links.ts mirrors the edit path for its notices. */
export const PRODUCTS_PATH = "/products";

/** The list narrowed to what moderation is holding back from buyers. */
export const MODERATED_PRODUCTS_PATH = `${PRODUCTS_PATH}?status=${MODERATED_FILTER}`;

/** The form that adds a product. */
export const NEW_PRODUCT_PATH = `${PRODUCTS_PATH}/new`;

/** The CSV importer. */
export const PRODUCTS_IMPORT_PATH = `${PRODUCTS_PATH}/import`;

/** The blank CSV the importer offers to start a file from (public/). */
export const PRODUCTS_IMPORT_TEMPLATE_PATH = "/import-template.csv";

/** The edit form for one product. */
export function productEditPath(id: string): string {
  return `${PRODUCTS_PATH}/${id}/edit`;
}

/** Where product share-card images live (app/api/og/p/[productId]). Crawlers
 *  are let in under it (app/robots.ts), or no card or search result could
 *  show the picture. */
export const PRODUCT_OG_IMAGE_PREFIX = "/api/og/p/";

/** One product's share-card image: a STABLE address that redirects to a
 *  freshly signed photo URL, so a card scraped days later still has it. */
export function productOgImagePath(id: string): string {
  return `${PRODUCT_OG_IMAGE_PREFIX}${encodeURIComponent(id)}`;
}

/** A product's main photo, from our own origin, for the store's own members
 *  (app/api/products/[id]/photo): pixels a page can read, which a presigned
 *  R2 URL on another origin are not. */
export function productPhotoPath(id: string): string {
  return `/api${PRODUCTS_PATH}/${encodeURIComponent(id)}/photo`;
}
