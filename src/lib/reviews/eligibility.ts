/**
 * Whether an order can be reviewed. Pure: shared by the review route (which
 * decides) and the order page (which offers the button), so the two agree.
 *
 * Paid and not refunded: a pending payment has not bought anything yet, and
 * a refunded order is not a purchase a "Verified buyer" badge can stand on.
 * The product must still exist; the order's own snapshot outlives it, a
 * review cannot.
 */
export function isReviewableOrder(order: {
  status: string;
  refunded_at: string | null;
  product_id: string | null;
}): boolean {
  return order.status === "paid" && order.refunded_at === null && order.product_id !== null;
}
