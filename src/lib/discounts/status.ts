import type { DiscountStatus, DiscountView } from "@/types/discount";

/**
 * Where a discount stands right now. Client-safe and pure: the list, the
 * form and the checkout all ask here, so "is this code live?" has one answer.
 *
 * Order matters: an ended discount is ended even if it was also paused or used
 * up, and a scheduled one has not had the chance to be anything else yet.
 */
export function discountStatus(
  discount: Pick<DiscountView, "kind" | "enabled" | "startsAt" | "endsAt" | "usageLimit">,
  uses: number,
  now: Date = new Date(),
): DiscountStatus {
  const at = now.getTime();
  if (discount.endsAt !== null && Date.parse(discount.endsAt) <= at) return "ended";
  if (Date.parse(discount.startsAt) > at) return "scheduled";
  if (discount.kind === "code" && discount.usageLimit !== null && uses >= discount.usageLimit) return "used_up";
  if (!discount.enabled) return "paused";
  return "active";
}

/** Whether a sale has started, after which its terms can no longer change
 *  (the 30-day price rule reads them; see 20261004_discounts.sql). */
export function saleHasStarted(discount: Pick<DiscountView, "kind" | "startsAt">, now: Date = new Date()): boolean {
  return discount.kind === "automatic" && Date.parse(discount.startsAt) <= now.getTime();
}
