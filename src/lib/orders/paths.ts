import { ORDERS_PATH } from "@/lib/dashboard/paths";
import type { OrderStatusFilter, OrdersView } from "@/types/order-view";

/**
 * Where an order lives, and the query parameters the Orders page reads. Pure
 * strings: safe on server and client. The route (app/(dashboard)/orders) reads
 * these names and every link to an order is built here, so a renamed parameter
 * is a one-line change rather than a broken link in a sent email.
 */

/** `?view=` picks the list (types/order-view.ts OrdersView). */
export const ORDERS_VIEW_PARAM = "view";

/** `?order=<id>` opens that order's detail panel over the list. */
export const ORDER_DETAIL_PARAM = "order";

/** `?status=` filters the full list (types/order-view.ts OrderStatusFilter). */
export const ORDERS_STATUS_PARAM = "status";

/** `?product=<id>` narrows BOTH lists to one product's orders: a product card
 *  sends its seller to that product's parcels, not to everyone's. */
export const ORDERS_PRODUCT_PARAM = "product";

/** The orders CSV export (lib/orders/csv.ts), a paid-plan perk. */
export const ORDERS_EXPORT_PATH = "/api/orders/export";

/** One order, opened: the notification, the seller's email and the overview's
 *  Recent orders rows all land here. */
export function orderDetailPath(id: string): string {
  return `${ORDERS_PATH}?${ORDER_DETAIL_PARAM}=${encodeURIComponent(id)}`;
}

/** The Orders page on one list, optionally narrowed to one product. */
export function ordersViewPath(view: OrdersView, productId?: string | null): string {
  const scope = productId ? `&${ORDERS_PRODUCT_PARAM}=${encodeURIComponent(productId)}` : "";
  return `${ORDERS_PATH}?${ORDERS_VIEW_PARAM}=${view}${scope}`;
}

/** The full Orders list, filtered to one status. */
export function ordersStatusPath(status: OrderStatusFilter): string {
  return `${ORDERS_PATH}?${ORDERS_STATUS_PARAM}=${status}`;
}
