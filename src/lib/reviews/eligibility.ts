import { isContentVisible } from "@/lib/moderation/removal";

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

/**
 * Where an order stands for its review: reviewed already, open to one, or
 * not. Open also needs the product live and not taken down, as the review
 * route checks. The order page offers the form on "open", and the review
 * reminder (lib/reviews/reminders.ts) is sent only then.
 */
export function orderReviewState(
  order: Parameters<typeof isReviewableOrder>[0],
  product: { status: string; moderation_status: string | null } | null,
  reviewed: boolean,
): "open" | "done" | "closed" {
  if (reviewed) return "done";
  return isReviewableOrder(order) && product?.status === "active" && isContentVisible(product.moderation_status)
    ? "open"
    : "closed";
}
