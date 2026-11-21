// SERVER ONLY. AN ORDER'S LINES, AS THE BUYER'S RIGHTS SEE THEM: which
// product each line sold and whether that line was refunded on its own
// (order_line_refunds, a cart's "one arrived broken"). The order page, the
// review route, the download route and the review reminder job all ask here,
// so a refunded line is refunded everywhere at once: no download, no review,
// no reminder about it.
//
// The FIRST line is the orders row itself (lineId null); every line after it
// is a row of order_add_ons, in its position order.

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type OrderLineState = {
  /** order_add_ons.id; null for the order's own first line. */
  lineId: string | null;
  /** Null once the product has been deleted (the line's snapshot stays). */
  productId: string | null;
  /** Refunded on its own (a whole-order refund is the order's status). */
  refunded: boolean;
};

/** order_line_refunds keeps the first line as a null line_id. */
const FIRST_LINE = "first";

/** Every line of each order, first line first. A refund is filed under its
 *  order and line; `lines` and `refunds` are what the two tables hold for
 *  these orders. Pure, for the batched reader below and for tests. */
export function lineStatesOf(
  orders: readonly { id: string; product_id: string | null }[],
  lines: readonly { id: string; order_id: string; product_id: string | null; position: number }[],
  refunds: readonly { order_id: string; line_id: string | null }[],
): Map<string, OrderLineState[]> {
  const refunded = new Set(refunds.map((row) => `${row.order_id}:${row.line_id ?? FIRST_LINE}`));
  const result = new Map<string, OrderLineState[]>(
    orders.map((order) => [
      order.id,
      [{ lineId: null, productId: order.product_id, refunded: refunded.has(`${order.id}:${FIRST_LINE}`) }],
    ]),
  );
  for (const line of [...lines].sort((a, b) => a.position - b.position)) {
    result.get(line.order_id)?.push({
      lineId: line.id,
      productId: line.product_id,
      refunded: refunded.has(`${line.order_id}:${line.id}`),
    });
  }
  return result;
}

/**
 * The lines of several orders in two reads, whatever their number. Null when
 * either read failed: a caller deciding a buyer's right (a download, a review)
 * refuses then, rather than guess that nothing was refunded.
 */
export async function readOrderLineStates(
  admin: Admin,
  orders: readonly { id: string; product_id: string | null }[],
): Promise<Map<string, OrderLineState[]> | null> {
  if (orders.length === 0) return new Map();
  const ids = orders.map((order) => order.id);
  const [lines, refunds] = await Promise.all([
    admin.from("order_add_ons").select("id, order_id, product_id, position").in("order_id", ids),
    admin.from("order_line_refunds").select("order_id, line_id").in("order_id", ids),
  ]);
  if (lines.error || refunds.error) {
    console.error("[orders] line states read failed", (lines.error ?? refunds.error)?.message);
    return null;
  }
  return lineStatesOf(orders, lines.data ?? [], refunds.data ?? []);
}

/** The lines of one order (see readOrderLineStates). */
export async function readLineStates(
  admin: Admin,
  order: { id: string; product_id: string | null },
): Promise<OrderLineState[] | null> {
  const states = await readOrderLineStates(admin, [order]);
  return states ? (states.get(order.id) ?? []) : null;
}
