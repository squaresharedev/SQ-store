// A PLAN'S PRICE ROW: what a plan costs and what it charges per sale, for a
// stretch of time. The rows live in the database (plan_prices), so a price or
// a fee changes by adding a row, never by a deploy. This file only reads rows
// it is handed: it never fetches.
//
// ONE OPEN ROW PER PLAN AND INTERVAL. A change closes the old row
// (effective_to) and opens a new one; old rows are never edited, so what a
// past sale was charged can always be explained.

import { z } from "zod";
import {
  PLAN_IDS,
  billingIntervalSchema,
  planIdSchema,
  type BillingInterval,
  type PlanId,
} from "./enums.ts";
import { BPS_WHOLE, feeCents } from "./fees.ts";

const bpsSchema = z.number().int().min(0).max(BPS_WHOLE);

/** One plan_prices row, in camelCase. */
export const planPriceSchema = z.object({
  planId: planIdSchema,
  /** Counts up per plan and interval; the `_vN` of the Stripe lookup key. */
  version: z.number().int().min(1),
  interval: billingIntervalSchema,
  /** What the plan costs per interval, in cents, excluding VAT. 0 for Free. */
  priceCents: z.number().int().min(0),
  /** The REGULAR price when priceCents is a launch price below it, else null.
   *  It must be a price that will really be charged once the launch ends. */
  listPriceCents: z.number().int().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Our cut of a sale through the seller's own doors, in basis points. */
  directFeeBps: bpsSchema,
  /** Our cut of a sale the marketplace brought, in basis points. */
  marketplaceFeeBps: bpsSchema,
  /** The Stripe Price this row is billed through, by lookup key (the same key
   *  in test and live mode, where a price id would differ). Null for Free. */
  stripeLookupKey: z.string().min(1).max(200).nullable(),
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveTo: z.iso.datetime({ offset: true }).nullable(),
});
export type PlanPrice = z.infer<typeof planPriceSchema>;

/** Whether a row is in force at `at`: from its start, up to (not including) its end. */
function inForce(price: PlanPrice, at: Date): boolean {
  const time = at.getTime();
  return Date.parse(price.effectiveFrom) <= time && (price.effectiveTo === null || time < Date.parse(price.effectiveTo));
}

/** The rows in force at `at`: at most one per plan and interval when the
 *  table's rule holds; the newest wins if it ever does not. */
export function activePlanPrices(prices: readonly PlanPrice[], at: Date): PlanPrice[] {
  const newest = new Map<string, PlanPrice>();
  for (const price of prices) {
    if (!inForce(price, at)) continue;
    const key = `${price.planId}:${price.interval}`;
    const held = newest.get(key);
    if (!held || Date.parse(price.effectiveFrom) > Date.parse(held.effectiveFrom)) newest.set(key, price);
  }
  return [...newest.values()];
}

/**
 * The row for `planId` among rows ALREADY known to be in force. A plan with
 * no row for `interval` answers with its monthly one: fees are the plan's,
 * whatever it is billed by, and Free only ever has a monthly row.
 */
export function findPlanPrice(
  active: readonly PlanPrice[],
  planId: PlanId,
  interval: BillingInterval = "month",
): PlanPrice | null {
  const ofPlan = active.filter((price) => price.planId === planId);
  return ofPlan.find((price) => price.interval === interval) ?? ofPlan.find((price) => price.interval === "month") ?? null;
}

/** The price row in force for a plan at `at`, or null when it has none. */
export function getActivePlanPrice(
  prices: readonly PlanPrice[],
  planId: PlanId,
  at: Date,
  interval: BillingInterval = "month",
): PlanPrice | null {
  return findPlanPrice(activePlanPrices(prices, at), planId, interval);
}

/** A row's price as a per-month figure: a yearly price spread over twelve
 *  months, rounded to the cent. */
export function monthlyPriceOf(price: PlanPrice): number {
  return price.interval === "year" ? Math.round(price.priceCents / 12) : price.priceCents;
}

/** What a month costs on this row with `monthlyGmvCents` of direct sales:
 *  the subscription (per month) plus the direct fee on those sales. */
export function monthlyCostOf(price: PlanPrice, monthlyGmvCents: number): number {
  return monthlyPriceOf(price) + feeCents(monthlyGmvCents, price.directFeeBps);
}

/**
 * The plan that costs least in total at `monthlyGmvCents` of direct sales,
 * among rows in force. On a tie the cheaper-to-subscribe plan wins: nobody is
 * told to pay a subscription that saves them nothing. Null when no plan has a
 * price at all.
 */
export function cheapestPlanFor(
  active: readonly PlanPrice[],
  monthlyGmvCents: number,
  interval: BillingInterval = "month",
): PlanId | null {
  let best: { plan: PlanId; cost: number } | null = null;
  for (const plan of PLAN_IDS) {
    const price = findPlanPrice(active, plan, interval);
    if (!price) continue;
    const cost = monthlyCostOf(price, monthlyGmvCents);
    if (!best || cost < best.cost) best = { plan, cost };
  }
  return best?.plan ?? null;
}
