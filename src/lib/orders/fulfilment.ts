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
}): OrderFulfilment {
  const status = FULFILMENT_STATUSES.find((value) => value === row.fulfilment_status) ?? "not_required";
  return {
    status,
    shippedAt: status === "shipped" && typeof row.shipped_at === "string" ? row.shipped_at : null,
    trackingNumber:
      status === "shipped" && typeof row.tracking_number === "string" && row.tracking_number
        ? row.tracking_number
        : null,
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
