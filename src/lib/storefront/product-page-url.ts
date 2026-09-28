import { appUrl } from "@/lib/app-url";

// Where a product page lives. One function, so the embed payload, the editor
// and any future "copy link" all agree on the shape and the origin.
//
// UUIDs on purpose: they are stable (unlike a slug the seller may rename), not
// secret (unlike the embed key, which is rotatable and gates the widget), and
// not enumerable. `/s/<storefront>` is left free for the hosted store page.
//
// THE QUERY PARAMETERS LIVE HERE, not beside the picker that writes them.
// The route (a server component) reads them and the picker (a client one)
// writes them, and every export of a "use client" module reaches the server as
// a client reference rather than its value — so a shared constant declared
// there silently becomes `undefined` as a lookup key, and the page quietly
// ignores the selection in a shared link. A plain module is readable from
// both sides, which is the only place a name like this can live.

/**
 * `?o=` carries the chosen option ids, comma separated, so a shared link opens
 * on the same version the sender was looking at. Ids and not indexes, so
 * reordering a product's option groups never repoints an old link at a
 * different colour.
 */
export const OPTION_QUERY_PARAM = "o";

/** The single-colour parameter the product page shipped with. Still read,
 *  never written: links shared before option groups existed keep working, and
 *  the value was already an option id, so it needs no translation. */
export const LEGACY_VARIANT_QUERY_PARAM = "v";

/** Every buyer-facing page lives under this prefix: robots.txt opens it to
 *  crawlers, and the dashboard's service worker is never registered from it. */
export const PUBLIC_PAGES_PREFIX = "/s/";

/** Path only, for same-origin links and tests. */
export function productPagePath(storefrontId: string, productId: string): string {
  return `${PUBLIC_PAGES_PREFIX}${encodeURIComponent(storefrontId)}/p/${encodeURIComponent(productId)}`;
}

/** Absolute URL on the app's own origin, for the embed payload and metadata. */
export function productPageUrl(storefrontId: string, productId: string): string {
  return appUrl(productPagePath(storefrontId, productId));
}
