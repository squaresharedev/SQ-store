// The checkout's own API routes. Plain module: the checkout form (client) and
// the route handlers' tests both name them, and a constant declared in a
// "use client" file reaches the server as a reference, not a value (see
// lib/storefront/product-page-url.ts for the time that bit).

/** POST: place an order for one product from one storefront. */
export function checkoutApiPath(storefrontId: string, productId: string): string {
  return `/api/checkout/${encodeURIComponent(storefrontId)}/${encodeURIComponent(productId)}`;
}

/** POST: the withdrawal function on an order page (CRD art. 11a). */
export const ORDER_WITHDRAW_API_PATH = "/api/orders/withdraw";

/** POST: "email me my order link", for a buyer without the email. */
export const ORDER_LOOKUP_API_PATH = "/api/orders/lookup";

/** GET: the order's download, handed out as a short-lived signed link. */
export function orderDownloadApiPath(orderRef: string): string {
  return `/api/orders/${encodeURIComponent(orderRef)}/download`;
}
