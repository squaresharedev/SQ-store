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

/** Where one product's review stands on an order. */
export type ReviewState = ReturnType<typeof orderReviewState>;

/**
 * Each PRODUCT of an order once, in line order, with where its review stands.
 * A cart's order holds several products and each is reviewed on its own
 * (one review per order and product). Open while the order itself can be
 * reviewed (paid, not refunded), the product is live and not taken down, and
 * at least one of its lines was not refunded on its own: two versions of one
 * product are two lines, and refunding one leaves the other bought. The order
 * page, the review route and the reminder job all read this, so they agree.
 */
export function orderReviewItems(
  order: Pick<Parameters<typeof isReviewableOrder>[0], "status" | "refunded_at">,
  lines: readonly { productId: string | null; refunded: boolean }[],
  products: ReadonlyMap<string, { status: string; moderation_status: string | null }>,
  reviewed: ReadonlySet<string>,
): { productId: string; state: ReviewState }[] {
  const items: { productId: string; state: ReviewState }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.productId || seen.has(line.productId)) continue;
    const productId = line.productId;
    seen.add(productId);
    const bought = lines.some((other) => other.productId === productId && !other.refunded);
    const state = orderReviewState(
      { status: order.status, refunded_at: order.refunded_at, product_id: bought ? productId : null },
      products.get(productId) ?? null,
      reviewed.has(productId),
    );
    items.push({ productId, state });
  }
  return items;
}

/** The order's review as one answer: open while any product is, else done
 *  once any is reviewed, else closed. What the reminder email and the page's
 *  ask decide by. */
export function orderReviewSummary(items: readonly { state: ReviewState }[]): ReviewState {
  if (items.some((item) => item.state === "open")) return "open";
  return items.some((item) => item.state === "done") ? "done" : "closed";
}
