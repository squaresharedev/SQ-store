/**
 * Dev-only "what would a brand-new seller see" switch for the list pages.
 *
 * Add `?preview=empty` to /products or /storefront and the page draws its list
 * as if the store had nothing in it, while everything else (your session, your
 * role, the sidebar) stays real. Nothing is read or written differently and no
 * data is touched: the page only skips the list query. Always off in production
 * builds, whatever the URL says.
 */
export const DEV_PREVIEW_PARAM = "preview";
export const DEV_PREVIEW_EMPTY = "empty";

/** True when this request asks for the empty-list preview (never in production). */
export function previewsEmptyList(param: string | string[] | undefined): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const value = Array.isArray(param) ? param[0] : param;
  return value === DEV_PREVIEW_EMPTY;
}
