// HOW FAR A PAYOUT HAS GOT, as the share of the track the payout dialog draws
// from the balance to the bank (components/payments/PayoutTrack). Pure, so the
// picture's one claim can be asserted without rendering it.

import type { Payout } from "@/lib/payments/types";

/** How much of the track an in-transit payout may light: it has left, and it has not arrived. */
export const TRANSIT_RANGE = { min: 0.15, max: 0.85 } as const;

type Trip = Pick<Payout, "createdAt" | "arrivalDate">;

/** How far an in-transit payout has got, by the calendar: sent to arrival. */
export function transitProgress(payout: Trip, now: Date | null): number {
  const sent = new Date(payout.createdAt).getTime();
  const due = new Date(payout.arrivalDate).getTime();
  const fraction = now && due > sent ? (now.getTime() - sent) / (due - sent) : 0.5;
  return Math.min(TRANSIT_RANGE.max, Math.max(TRANSIT_RANGE.min, fraction));
}

/**
 * The share of the track to light, 0 to 1. Lit pixels say WHERE THE MONEY IS:
 * all of them once it reached the bank (paid), a share by the calendar while
 * it is on its way (in transit), and none while it sits in the balance. That
 * last case covers a payout that has not left (pending), one that never will
 * (canceled), one the bank turned away (failed: the amount is back in the
 * available balance), and a status this build does not know.
 */
export function payoutProgress(payout: Trip & Pick<Payout, "status">, now: Date | null): number {
  switch (payout.status) {
    case "paid":
      return 1;
    case "in_transit":
      return transitProgress(payout, now);
    default:
      return 0;
  }
}
