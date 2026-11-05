// The checkout's own API routes. Plain module: the checkout form (client) and
// the route handlers' tests both name them, and a constant declared in a
// "use client" file reaches the server as a reference, not a value (see
// lib/storefront/product-page-url.ts for the time that bit).

/** POST: place an order for one product from one storefront. */
export function checkoutApiPath(storefrontId: string, productId: string): string {
  return `/api/checkout/${encodeURIComponent(storefrontId)}/${encodeURIComponent(productId)}`;
}

/** POST: check a discount code for this product before paying. */
export function checkoutDiscountApiPath(storefrontId: string, productId: string): string {
  return `${checkoutApiPath(storefrontId, productId)}/discount`;
}

/** POST: the withdrawal function on an order page (CRD art. 11a). */
export const ORDER_WITHDRAW_API_PATH = "/api/orders/withdraw";

/** Where a buyer who backs out of the payment page is sent, and the query
 *  parameter naming their checkout (app/api/checkout/cancel). */
export const CHECKOUT_CANCEL_API_PATH = "/api/checkout/cancel";
export const CHECKOUT_CANCEL_PARAM = "c";

/** POST: "email me my order link", for a buyer without the email. */
export const ORDER_LOOKUP_API_PATH = "/api/orders/lookup";

/** POST: ask for, or stop, the one review reminder email an order page offers
 *  (lib/reviews/reminders.ts). */
export const ORDER_REVIEW_REMINDER_API_PATH = "/api/orders/review-reminder";

/** `?ref=` on the reminder's unsubscribe route: the order's credential. */
export const ORDER_REVIEW_REMINDER_REF_PARAM = "ref";

/** The reminder email's List-Unsubscribe address: a mail client's one-click
 *  POST stops it (RFC 8058); a plain visit opens the order page's stop dialog. */
export function orderReviewReminderUnsubscribePath(orderRef: string): string {
  return `${ORDER_REVIEW_REMINDER_API_PATH}/unsubscribe?${ORDER_REVIEW_REMINDER_REF_PARAM}=${encodeURIComponent(orderRef)}`;
}

/** GET: the order's download, handed out as a short-lived signed link. */
/** `?item=` on the download route: one of the order's add-on lines. */
export const ORDER_DOWNLOAD_ITEM_PARAM = "item";

/** The order's own download, or (with `itemId`) an add-on line's. */
export function orderDownloadApiPath(orderRef: string, itemId?: string): string {
  const path = `/api/orders/${encodeURIComponent(orderRef)}/download`;
  return itemId ? `${path}?${ORDER_DOWNLOAD_ITEM_PARAM}=${encodeURIComponent(itemId)}` : path;
}
