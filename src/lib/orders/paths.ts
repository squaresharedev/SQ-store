import { ORDERS_PATH } from "@/lib/dashboard/paths";
import type { OrdersView } from "@/types/order-view";

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

/** The orders CSV export (lib/orders/csv.ts), a paid-plan perk. */
export const ORDERS_EXPORT_PATH = "/api/orders/export";

/** One order, opened: the notification, the seller's email and the overview's
 *  Recent orders rows all land here. */
export function orderDetailPath(id: string): string {
  return `${ORDERS_PATH}?${ORDER_DETAIL_PARAM}=${encodeURIComponent(id)}`;
}

/** The Orders page on one list. */
export function ordersViewPath(view: OrdersView): string {
  return `${ORDERS_PATH}?${ORDERS_VIEW_PARAM}=${view}`;
}
