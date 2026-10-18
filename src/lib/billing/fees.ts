// FEE ARITHMETIC on a set of plan prices: what a sale owes the platform, and
// what a plan costs a seller at a given volume. Pure integer maths, no I/O.
//
// EVERY FUNCTION TAKES THE PRICES IT WORKS ON: the plan_prices rows in force,
// read from the database by lib/billing/catalog.ts and handed down (to a
// browser too: they are the numbers on the plans page). Nothing here knows a
// price of its own, so a row changed in the database changes every figure.
// The fee itself is the pricing contract's computeFees (lib/pricing/fees.ts).
//
// IMPORT-FREE apart from the catalog and the pricing contract (themselves
// import-free), for the same reason as plans.ts: the seed script and the
// Playwright helpers price seeded sales with it, so a fixture can never
// charge a rate the app does not. The explicit `.ts` extension is what lets
// Node's type stripping run this file directly.
//
// THE FEE BASE IS THE WHOLE AMOUNT THE BUYER PAYS, delivery included.

import { BILLING_INTERVALS, DEFAULT_PLAN, PAID_PLAN_IDS, type BillingInterval, type PlanId } from "./plans.ts";
import { BPS_WHOLE, computeFees, type SaleOrigin } from "../pricing/index.ts";
import {
  cheapestPlanFor as cheapestAmong,
  findPlanPrice,
  monthlyCostOf,
  monthlyPriceOf,
  type PlanPrice,
} from "../pricing/plan-price.ts";

/** The plan prices in force, as every function here takes them. */
export type PlanPrices = readonly PlanPrice[];

/**
 * The price row a plan is on for `interval` (its monthly row when it is not
 * sold by that interval). Throws when the plan has none at all: the catalog
 * loader refuses a set with a plan missing, so reaching this is a bug, and a
 * plan shown at a made-up price would be worse than an error.
 */
export function planPrice(prices: PlanPrices, plan: PlanId, interval: BillingInterval = "month"): PlanPrice {
  const price = findPlanPrice(prices, plan, interval);
  if (!price) throw new Error(`no price in force for the ${plan} plan`);
  return price;
}

/** A plan's cut of a sale through the seller's own doors, in basis points. */
export function directFeeBps(prices: PlanPrices, plan: PlanId): number {
  return planPrice(prices, plan).directFeeBps;
}

/**
 * The intervals plans can be bought by: always monthly, and yearly only once
 * EVERY paid plan has a yearly price (a toggle that prices one plan and not
 * the other would compare nothing).
 */
export function soldIntervals(prices: PlanPrices): BillingInterval[] {
  return BILLING_INTERVALS.filter(
    (interval) =>
      interval === "month" ||
      PAID_PLAN_IDS.every((plan) => prices.some((price) => price.planId === plan && price.interval === interval)),
  );
}

/** The platform's cut of one sale, as the order writer records it. */
export type SaleFee = {
  /** The seller's plan at the moment of checkout, which set the rate. */
  sellerPlan: PlanId;
  /** The rate that produced platformFeeCents, snapshotted on the order. */
  platformFeeBps: number;
  platformFeeCents: number;
  /** The promotion's rate, when one drove the sale. */
  adRateBps: number | null;
  adFeeCents: number;
  /** platformFeeCents + adFeeCents, after the cap: what is charged. */
  applicationFeeCents: number;
  feeCapped: boolean;
};

/** A sale that owes nothing: a waived seller, fees switched off, or a free order. */
export function noSaleFee(plan: PlanId): SaleFee {
  return {
    sellerPlan: plan,
    platformFeeBps: 0,
    platformFeeCents: 0,
    adRateBps: null,
    adFeeCents: 0,
    applicationFeeCents: 0,
    feeCapped: false,
  };
}

/**
 * The fee a sale of `amountCents` owes on `plan`, from the prices in force.
 * `origin` defaults to a sale on the seller's own hosted pages. An order of
 * nothing owes nothing (and is never handed to computeFees, which refuses it).
 */
export function saleFee(
  prices: PlanPrices,
  plan: PlanId,
  amountCents: number,
  options: { origin?: SaleOrigin; feeWaiver?: boolean; promotion?: { adRateBps: number } | null } = {},
): SaleFee {
  if (amountCents <= 0) return noSaleFee(plan);
  const fees = computeFees({
    amountCents,
    planPrice: planPrice(prices, plan),
    origin: options.origin ?? "hosted_storefront",
    promotion: options.promotion ?? null,
    feeWaiver: options.feeWaiver ?? false,
  });
  return {
    sellerPlan: plan,
    platformFeeBps: fees.platformFeeBps,
    platformFeeCents: fees.platformFeeCents,
    adRateBps: fees.adRateBps,
    adFeeCents: fees.adFeeCents,
    applicationFeeCents: fees.applicationFeeCents,
    feeCapped: fees.capped,
  };
}

/** A plan's subscription price as a per-month figure, in cents. A yearly
 *  price is spread over twelve months (rounded to the cent). */
export function monthlyPriceCents(prices: PlanPrices, plan: PlanId, interval: BillingInterval): number {
  return monthlyPriceOf(planPrice(prices, plan, interval));
}

/** What a plan is billed per `interval`, in cents: the figure on the invoice. */
export function intervalPriceCents(prices: PlanPrices, plan: PlanId, interval: BillingInterval): number {
  return planPrice(prices, plan, interval).priceCents;
}

/** A plan's REGULAR price per `interval`, when what it charges today is a
 *  launch price below it (plan_prices.list_price_cents); null otherwise. */
export function intervalListPriceCents(prices: PlanPrices, plan: PlanId, interval: BillingInterval): number | null {
  const price = planPrice(prices, plan, interval);
  return price.listPriceCents !== null && price.listPriceCents > price.priceCents ? price.listPriceCents : null;
}

/**
 * A plan's REGULAR price as a per-month figure, when what it charges today is
 * a launch price below it; null when the price charged is the regular one.
 * Spread over twelve months like the price itself.
 */
export function monthlyListPriceCents(prices: PlanPrices, plan: PlanId, interval: BillingInterval): number | null {
  const list = intervalListPriceCents(prices, plan, interval);
  if (list === null) return null;
  return planPrice(prices, plan, interval).interval === "year" ? Math.round(list / 12) : list;
}

/** How far the launch price sits below the regular one, as a whole percent
 *  of the regular price; 0 when the plan has no launch price. */
export function launchDiscountPercent(prices: PlanPrices, plan: PlanId, interval: BillingInterval): number {
  const list = intervalListPriceCents(prices, plan, interval);
  if (list === null) return 0;
  return Math.round(((list - intervalPriceCents(prices, plan, interval)) / list) * 100);
}

/**
 * What a seller would pay on `plan` in a month with `monthlySalesCents` of
 * sales through their own doors: the subscription (per month) plus the fee
 * on those sales.
 */
export function monthlyCostCents(
  prices: PlanPrices,
  plan: PlanId,
  interval: BillingInterval,
  monthlySalesCents: number,
): number {
  return monthlyCostOf(planPrice(prices, plan, interval), monthlySalesCents);
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
  prices: PlanPrices,
  lower: PlanId,
  upper: PlanId,
  interval: BillingInterval,
): number | null {
  const feeGap = directFeeBps(prices, lower) - directFeeBps(prices, upper);
  if (feeGap <= 0) return null;
  const priceGap = monthlyPriceCents(prices, upper, interval) - monthlyPriceCents(prices, lower, interval);
  if (priceGap <= 0) return 0;
  return Math.ceil((priceGap * BPS_WHOLE) / feeGap);
}

/**
 * The plan that costs least in total at `monthlySalesCents`. On a tie the
 * cheaper-to-subscribe plan wins: nobody should be told to pay a subscription
 * that saves them nothing.
 */
export function cheapestPlanFor(prices: PlanPrices, monthlySalesCents: number, interval: BillingInterval): PlanId {
  return cheapestAmong(prices, monthlySalesCents, interval) ?? DEFAULT_PLAN;
}

/**
 * What a year on the yearly price saves against twelve monthly payments, in
 * cents. Zero for Free, for a plan not sold yearly, or when the yearly price
 * is no discount.
 */
export function yearlySavingCents(prices: PlanPrices, plan: PlanId): number {
  const yearly = planPrice(prices, plan, "year");
  if (yearly.interval !== "year") return 0;
  return Math.max(0, intervalPriceCents(prices, plan, "month") * 12 - yearly.priceCents);
}

/**
 * How many whole months a year on the yearly price gives away against paying
 * monthly: the SMALLEST across the paid plans, so "2 months free" is true of
 * every plan it is said beside. Zero when any paid plan saves less than a
 * month, or yearly billing is not sold.
 */
export function yearlyFreeMonths(prices: PlanPrices): number {
  if (!soldIntervals(prices).includes("year")) return 0;
  const months = PAID_PLAN_IDS.map((plan) =>
    Math.floor(yearlySavingCents(prices, plan) / intervalPriceCents(prices, plan, "month")),
  );
  return months.length > 0 ? Math.min(...months) : 0;
}
