import { appUrl } from "@/lib/app-url";
import { QUANTITY_QUERY_PARAM } from "@/lib/products/quantity";
import { uuidField } from "@/lib/validation/inputs";
import { OPTIONS_TOTAL_MAX } from "@/types/product";

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

/**
 * `?placed=1` on an order page: this visit is the one straight after paying,
 * so the thank-you plays its moment. Carries nothing else and proves nothing:
 * a reload with it just celebrates again, which is harmless, and a visit
 * without it (from the email, days later) opens quietly on the status.
 */
export const PLACED_QUERY_PARAM = "placed";

/** Every buyer-facing page lives under this prefix: robots.txt opens it to
 *  crawlers, and the dashboard's service worker is never registered from it. */
export const PUBLIC_PAGES_PREFIX = "/s/";

/** A route's query string, as Next hands it to a page. */
export type SearchParams = { [key: string]: string | string[] | undefined };

const optionIdSchema = uuidField("option");

/** A repeated parameter arrives as an array; take the first, as one address
 *  bar can only mean one selection. */
export function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The option ids the URL asks for, filtered to ones this product actually has.
 * Read the same way by the product page and the checkout it leads to. The
 * split is capped before anything is examined: a product can never have more
 * than OPTIONS_TOTAL_MAX options, so a longer parameter is a scan, not a
 * selection, and there is no reason to walk it.
 */
export function requestedOptions(searchParams: SearchParams, optionIds: ReadonlySet<string>): string[] {
  const raw = [
    ...(firstValue(searchParams[OPTION_QUERY_PARAM])?.split(",").slice(0, OPTIONS_TOTAL_MAX) ?? []),
    firstValue(searchParams[LEGACY_VARIANT_QUERY_PARAM]) ?? "",
  ];
  const wanted = new Set<string>();
  for (const value of raw) {
    const id = value.trim();
    if (!id || wanted.has(id) || !optionIds.has(id)) continue;
    if (!optionIdSchema.safeParse(id).success) continue;
    wanted.add(id);
  }
  return [...wanted];
}

/** Path only, for same-origin links and tests. */
export function productPagePath(storefrontId: string, productId: string): string {
  return `${PUBLIC_PAGES_PREFIX}${encodeURIComponent(storefrontId)}/p/${encodeURIComponent(productId)}`;
}

/** Absolute URL on the app's own origin, for the embed payload and metadata. */
export function productPageUrl(storefrontId: string, productId: string): string {
  return appUrl(productPagePath(storefrontId, productId));
}

/**
 * The checkout a product page's button leads to. The version and the quantity
 * ride along in the same `?o=` and `?q=` the product page itself reads, so a
 * buyer lands on the checkout holding exactly what they chose. Requests, not
 * decisions: the checkout re-checks both against the product before it shows
 * a price, and the quote re-checks them again before anything is charged.
 */
export function checkoutPath(
  storefrontId: string,
  productId: string,
  choice: { optionIds?: readonly string[]; quantity?: number } = {},
): string {
  const params = new URLSearchParams();
  if (choice.optionIds && choice.optionIds.length > 0) {
    params.set(OPTION_QUERY_PARAM, choice.optionIds.join(","));
  }
  if (choice.quantity && choice.quantity > 1) params.set(QUANTITY_QUERY_PARAM, String(choice.quantity));
  const query = params.toString();
  return `${productPagePath(storefrontId, productId)}/checkout${query ? `?${query}` : ""}`;
}

/**
 * An order's own page: the thank-you a buyer lands on, and the order status
 * page it stays afterwards. `orderRef` is the order's credential (see
 * lib/orders/order-link.ts), never a payment provider's id.
 */
export function orderPagePath(storefrontId: string, orderRef: string): string {
  return `${PUBLIC_PAGES_PREFIX}${encodeURIComponent(storefrontId)}/order/${encodeURIComponent(orderRef)}`;
}

/** Absolute, for the confirmation email. */
export function orderPageUrl(storefrontId: string, orderRef: string): string {
  return appUrl(orderPagePath(storefrontId, orderRef));
}

/** Where a buyer asks for their order link again (the withdrawal function's
 *  way in for someone who no longer has the email). */
export function orderLookupPath(storefrontId: string): string {
  return `${PUBLIC_PAGES_PREFIX}${encodeURIComponent(storefrontId)}/orders`;
}
