import type { DiscountView } from "@/types/discount";

/**
 * The two fractions a discount's row draws as a bar. Pure and client-safe, so
 * the arithmetic is tested without a page. Instants are compared as numbers
 * (Date.parse), never as strings: PostgREST and a browser print the same
 * moment differently.
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * How far through its run a discount is, 0..1: 0 before it starts, 1 once it
 * is over. Null when it has no end date, since there is nothing to be a
 * fraction of.
 */
export function runProgress(discount: Pick<DiscountView, "startsAt" | "endsAt">, now: Date): number | null {
  if (discount.endsAt === null) return null;
  const start = Date.parse(discount.startsAt);
  const end = Date.parse(discount.endsAt);
  const at = now.getTime();
  // A run with no length (ended the moment it began) is simply over or not.
  if (end <= start) return at >= end ? 1 : 0;
  return clamp01((at - start) / (end - start));
}

/** How much of a code's order limit is used, 0..1. Null for a code with no limit. */
export function usageProgress(uses: number, usageLimit: number | null): number | null {
  if (usageLimit === null) return null;
  if (usageLimit <= 0) return 1;
  return clamp01(uses / usageLimit);
}
