// THE PLAN CATALOG: what each plan lifts and adds, in one place.
//
// The limits each plan lifts and the perks it switches on. Changing a number
// here changes it everywhere: the plans page and the limits the create
// actions (and their database mirror) enforce.
//
// NOT THE MONEY. What a plan costs and what it charges per sale are rows in
// the database (plan_prices, read through lib/billing/catalog.ts), so a price
// or a fee changes without a deploy. See fees.ts for the arithmetic on them.
//
// IMPORT-FREE ON PURPOSE, apart from the pricing contract (itself
// import-free, by relative path). Scripts (the seed data) and the Playwright
// helpers import this file by relative path, outside the app's module
// resolution, so it must not import anything through an alias. Copy for each
// plan lives in plan-copy.ts for the same reason.
//
// MIRRORED IN SQL. The limits are enforced a second time by a database
// trigger (supabase/migrations/20260930_seller_plans.sql, public.plan_limit),
// so a direct REST insert cannot walk past them. tests/integration/
// 29-seller-plans.test.ts reads BOTH and fails when they disagree: edit the
// migration's plan_limit() in the same change as PLANS below.
//
// THE PLAN IDS AND BILLING INTERVALS are the pricing contract's
// (lib/pricing/enums.ts), re-exported here so billing code has one import.

import { BILLING_INTERVALS, PLAN_IDS, type BillingInterval, type PlanId } from "../pricing/enums.ts";

export { BILLING_INTERVALS, PLAN_IDS, type BillingInterval, type PlanId };

/** The plans a seller pays for, i.e. the ones with a Stripe price. */
export const PAID_PLAN_IDS = ["starter", "pro"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** The plan every account is on until it pays for another, and falls back to
 *  when a paid plan ends. Never a lockout: Free can build, publish and sell. */
export const DEFAULT_PLAN: PlanId = "free";

/** The currency plans are priced and billed in. EU platform, EU sellers. */
export const BILLING_CURRENCY = "EUR";

/**
 * How long a paid plan survives a failed renewal while Stripe retries the
 * card. After this the account falls back to Free (nothing is taken down).
 */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Slack past the end of a paid period before the plan is considered over.
 * A renewal that succeeds a little late, or a webhook that arrives after the
 * period boundary, must not flicker a paying seller down to Free and back.
 */
export const RENEWAL_SLACK_HOURS = 48;

/** The things a plan caps. Each is enforced where it is created (limits.ts),
 *  and again by the database (public.plan_limit mirrors these numbers). */
export const PLAN_LIMIT_KEYS = ["storefronts", "teamSeats", "products"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

/**
 * A plan's caps. `null` = unlimited. `teamSeats` counts everyone with access
 * to the store, the owner included, and pending invites too (an invite is a
 * seat promised). `products` counts every product the store holds, whatever
 * its status (a draft takes a place like a live one).
 */
export type PlanLimits = Record<PlanLimitKey, number | null>;

/**
 * Features a plan switches on. A paid plan only ever ADDS to Free: nothing
 * here is ever taken away from it.
 *
 *   ordersExport     orders as a CSV file for bookkeeping, on every plan
 *                    (GET /api/orders/export checks this flag)
 *   earlyAccess      new features switched on for the account before
 *                    everyone else (an operational promise, not a code gate)
 *   analyticsExport  the analytics page's figures for the chosen range as a
 *                    CSV report (components/analytics/AnalyticsExportButton)
 *   prioritySupport  support answers first, within one business day (an
 *                    operational promise: whoever staffs support keeps it)
 */
export const PLAN_PERK_KEYS = ["ordersExport", "earlyAccess", "analyticsExport", "prioritySupport"] as const;
export type PlanPerkKey = (typeof PLAN_PERK_KEYS)[number];
export type PlanPerks = Record<PlanPerkKey, boolean>;

export type PlanDefinition = {
  id: PlanId;
  limits: PlanLimits;
  perks: PlanPerks;
  /** The one plan the plans page and the upsell point at ("Best value"). */
  recommended: boolean;
};

// DRAFT NUMBERS. The owner sets the final limits here.
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    limits: { storefronts: 3, teamSeats: 2, products: 20 },
    perks: { ordersExport: true, earlyAccess: false, analyticsExport: false, prioritySupport: false },
    recommended: false,
  },
  starter: {
    id: "starter",
    limits: { storefronts: 10, teamSeats: 5, products: 60 },
    perks: { ordersExport: true, earlyAccess: true, analyticsExport: false, prioritySupport: false },
    // The best value: most of Pro's saving on a typical shop, at under a
    // third of the price.
    recommended: true,
  },
  pro: {
    id: "pro",
    limits: { storefronts: null, teamSeats: null, products: 500 },
    perks: { ordersExport: true, earlyAccess: true, analyticsExport: true, prioritySupport: true },
    recommended: false,
  },
};

/** The plan the plans page and the upsell recommend ("Best value"). */
export const RECOMMENDED_PLAN: PlanId = PLAN_IDS.find((plan) => PLANS[plan].recommended) ?? DEFAULT_PLAN;

/**
 * The next plan up from `plan`, the one an upsell offers; null on the top plan.
 */
export function nextPlanUp(plan: PlanId): PaidPlanId | null {
  const next = PLAN_IDS[PLAN_IDS.indexOf(plan) + 1];
  return next && next !== "free" ? next : null;
}

/** Narrow an untrusted value (a form field, a URL param, a DB column) to a plan. */
export function parsePlanId(value: unknown): PlanId | null {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
    ? (value as PlanId)
    : null;
}

/** Narrow an untrusted value to a plan a seller can pay for. */
export function parsePaidPlanId(value: unknown): PaidPlanId | null {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value)
    ? (value as PaidPlanId)
    : null;
}

/** Narrow an untrusted value to a billing interval. */
export function parseBillingInterval(value: unknown): BillingInterval | null {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value)
    ? (value as BillingInterval)
    : null;
}

export function isPaidPlan(plan: PlanId): plan is PaidPlanId {
  return plan !== "free";
}

/** `<plan>_<interval>_<currency>_v<N>`, the shape every plan_prices lookup key
 *  has (the table's CHECK holds it). */
const LOOKUP_KEY_SHAPE = /^([a-z]+)_([a-z]+)_[a-z]{3}_v\d+$/;

/**
 * The paid plan and interval a Stripe price lookup key belongs to, if any.
 *
 * Read from the key's SHAPE, not by matching the keys in force: a seller on a
 * grandfathered `_v1` price is still on that plan after plan_prices moves on
 * to `_v2`, and must not read as Free because their key is no longer current.
 */
export function planForLookupKey(
  lookupKey: string,
): { plan: PaidPlanId; interval: BillingInterval } | null {
  const match = LOOKUP_KEY_SHAPE.exec(lookupKey);
  if (!match) return null;
  const plan = parsePaidPlanId(match[1]);
  const interval = parseBillingInterval(match[2]);
  return plan && interval ? { plan, interval } : null;
}
