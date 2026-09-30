// FEE ARITHMETIC: what a sale owes the platform, and what a plan costs a
// seller at a given volume. Pure integer maths, no I/O.
//
// IMPORT-FREE apart from the catalog (itself import-free), for the same
// reason as plans.ts: the seed script and the Playwright helpers compute
// seeded fees with it, so a fixture can never charge a rate the app does not.
// The explicit `.ts` extension below is what lets Node's type stripping run
// this file directly; the app's bundler resolves it either way.
//
// THE FEE BASE IS THE ITEM SUBTOTAL, shipping excluded. The Terms charge the
// fee on "the gross sale price of each Artifact"; delivery is the seller
// passing on a carrier's cost, not a sale we take a cut of.

import { PLANS, PLAN_IDS, type BillingInterval, type PlanId } from "./plans.ts";

/** Basis points in a whole: 10 000 bps = 100%. */
const BPS_WHOLE = 10_000;

/**
 * The platform fee on one sale, in cents: `subtotalCents` x `feeBps`, rounded
 * half up to the cent. Integer maths throughout, so the same inputs give the
 * same cent on every runtime.
 *
 * Never more than the subtotal (bps are capped at a whole), never negative.
 */
export function platformFeeCents(subtotalCents: number, feeBps: number): number {
  const base = Math.max(0, Math.trunc(subtotalCents));
  const bps = Math.min(BPS_WHOLE, Math.max(0, Math.trunc(feeBps)));
  return Math.floor((base * bps + BPS_WHOLE / 2) / BPS_WHOLE);
}

/** The platform's cut of one sale, as the order writer records it. */
export type SaleFee = {
  platformFeeCents: number;
  /** The rate that produced it, snapshotted on the order. */
  platformFeeBps: number;
  /** The seller's plan at the moment of sale, which set the rate. */
  sellerPlan: PlanId;
};

/** The fee a sale owes on `plan`, charged on the item subtotal. */
export function saleFee(plan: PlanId, subtotalCents: number): SaleFee {
  const platformFeeBps = PLANS[plan].feeBps;
  return { platformFeeCents: platformFeeCents(subtotalCents, platformFeeBps), platformFeeBps, sellerPlan: plan };
}

/** A plan's subscription price as a per-month figure, in cents. A yearly
 *  price is spread over twelve months (rounded to the cent). */
export function monthlyPriceCents(plan: PlanId, interval: BillingInterval): number {
  const price = PLANS[plan].priceCents[interval];
  return interval === "year" ? Math.round(price / 12) : price;
}

/**
 * What a seller would pay on `plan` in a month with `monthlySalesCents` of
 * item sales: the subscription (per month) plus the fee on those sales.
 */
export function monthlyCostCents(
  plan: PlanId,
  interval: BillingInterval,
  monthlySalesCents: number,
): number {
  return monthlyPriceCents(plan, interval) + platformFeeCents(monthlySalesCents, PLANS[plan].feeBps);
}

/**
 * The monthly sales, in cents, above which `upper` (dearer subscription, lower
 * fee) costs less in total than `lower`: `(P_upper - P_lower) / (r_lower -
 * r_upper)`. Rounded up to the cent, so at the returned figure `upper` is
 * never the dearer of the two.
 *
 * Null when `upper` never pays for itself (its fee is not lower), and 0 when
 * it is no dearer to begin with.
 */
export function breakEvenCents(
  lower: PlanId,
  upper: PlanId,
  interval: BillingInterval,
): number | null {
  const feeGap = PLANS[lower].feeBps - PLANS[upper].feeBps;
  if (feeGap <= 0) return null;
  const priceGap = monthlyPriceCents(upper, interval) - monthlyPriceCents(lower, interval);
  if (priceGap <= 0) return 0;
  return Math.ceil((priceGap * BPS_WHOLE) / feeGap);
}

/**
 * The plan that costs least in total at `monthlySalesCents`. On a tie the
 * cheaper-to-subscribe plan wins: nobody should be told to pay a subscription
 * that saves them nothing.
 */
export function cheapestPlanFor(monthlySalesCents: number, interval: BillingInterval): PlanId {
  let best: PlanId = PLAN_IDS[0];
  let bestCost = monthlyCostCents(best, interval, monthlySalesCents);
  for (const plan of PLAN_IDS.slice(1)) {
    const cost = monthlyCostCents(plan, interval, monthlySalesCents);
    if (cost < bestCost) {
      best = plan;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * What a year on the yearly price saves against twelve monthly payments, in
 * cents. Zero for Free, or when the yearly price is no discount.
 */
export function yearlySavingCents(plan: PlanId): number {
  const { month, year } = PLANS[plan].priceCents;
  return Math.max(0, month * 12 - year);
}
