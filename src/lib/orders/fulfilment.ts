import { parseCarrier } from "@/lib/orders/carriers";
import type {
  FulfilmentStatus,
  OrderFulfilment,
  OrderStatus,
} from "@/types/order-view";

/**
 * The fulfilment half of an order, and the one rule about it every surface
 * shares. Client-safe.
 */

const FULFILMENT_STATUSES: readonly FulfilmentStatus[] = ["unfulfilled", "shipped", "not_required"];

/**
 * The stored columns -> the view. An unknown status reads as "not_required"
 * rather than "unfulfilled": a value this app does not recognise must never put
 * an order in front of a seller as a parcel they still owe.
 */
export function parseFulfilment(row: {
  fulfilment_status?: unknown;
  shipped_at?: unknown;
  tracking_number?: unknown;
  tracking_carrier?: unknown;
}): OrderFulfilment {
  const status = FULFILMENT_STATUSES.find((value) => value === row.fulfilment_status) ?? "not_required";
  const trackingNumber =
    status === "shipped" && typeof row.tracking_number === "string" && row.tracking_number
      ? row.tracking_number
      : null;
  return {
    status,
    shippedAt: status === "shipped" && typeof row.shipped_at === "string" ? row.shipped_at : null,
    trackingNumber,
    // A carrier says where a NUMBER is followed, so it never stands alone.
    carrier: trackingNumber ? parseCarrier(row.tracking_carrier) : null,
  };
}

/**
 * THE TO SHIP RULE: paid, and not sent yet. A pending payment is not a parcel
 * anyone owes yet, and a refunded or disputed one is a conversation, not a
 * shipment. The query (lib/orders/queries.ts), the count on the sidebar and the
 * overview row, the order panel's "Mark as shipped" and public.order_mark_shipped
 * all apply this same rule; the SQL spelling of it lives beside the query.
 */
export function isToShip(order: {
  status: OrderStatus;
  fulfilment: Pick<OrderFulfilment, "status">;
}): boolean {
  return order.status === "paid" && order.fulfilment.status === "unfulfilled";
}

/**
 * How many days a parcel can wait before the queue starts calling it out. A
 * house rule rather than the seller's own promise: their dispatch time is free
 * text ("packed and posted within 2 days"), which nothing can compare against a
 * date. Three days is long enough that a busy weekend does not light the whole
 * queue, and short enough that a forgotten order does not go unnoticed for a week.
 */
export const OVERDUE_AFTER_DAYS = 3;

/** Whether an order placed at `createdAt` has waited past OVERDUE_AFTER_DAYS. */
export function isOverdue(createdAt: string, now: Date = new Date()): boolean {
  const placed = new Date(createdAt).getTime();
  if (Number.isNaN(placed)) return false;
  return now.getTime() - placed > OVERDUE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
