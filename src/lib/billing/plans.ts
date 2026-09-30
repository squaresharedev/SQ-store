// THE PLAN CATALOG: every number a seller's plan decides, in one place.
//
// Prices, the per-sale platform fee, the limits each plan lifts, and the
// Stripe price each paid plan is billed through. Changing a number here
// changes it everywhere: the pricing modal, the fee a sale is charged, the
// limits the create actions (and their database mirror) enforce.
//
// IMPORT-FREE ON PURPOSE. Scripts (the seed data) and the Playwright helpers
// import this file by relative path, outside the app's module resolution, so
// it must not import anything itself. Copy for each plan lives in
// plan-copy.ts for the same reason.
//
// MIRRORED IN SQL. The limits are enforced a second time by a database
// trigger (supabase/migrations/20260930_seller_plans.sql, public.plan_limit),
// so a direct REST insert cannot walk past them. tests/integration/
// 29-seller-plans.test.ts reads BOTH and fails when they disagree: edit the
// migration's plan_limit() in the same change as PLANS below.
//
// MONEY IS INTEGER CENTS, FEES ARE INTEGER BASIS POINTS (100 bps = 1%), so no
// float ever touches an amount. See fees.ts for the arithmetic.

/** Every plan, cheapest first. The order is the order the pricing modal shows. */
export const PLAN_IDS = ["free", "starter", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** The plans a seller pays for, i.e. the ones with a Stripe price. */
export const PAID_PLAN_IDS = ["starter", "pro"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** The plan every account is on until it pays for another, and falls back to
 *  when a paid plan ends. Never a lockout: Free can build, publish and sell. */
export const DEFAULT_PLAN: PlanId = "free";

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

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

/** The things a plan caps. Each is enforced where it is created (limits.ts). */
export const PLAN_LIMIT_KEYS = ["storefronts", "teamSeats"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

/**
 * A plan's caps. `null` = unlimited. `teamSeats` counts everyone with access
 * to the store, the owner included, and pending invites too (an invite is a
 * seat promised).
 */
export type PlanLimits = Record<PlanLimitKey, number | null>;

export type PlanDefinition = {
  id: PlanId;
  /** Our cut of each sale through Square Share checkout, in basis points of
   *  the item subtotal (shipping excluded). 500 = 5%. */
  feeBps: number;
  /** What the plan costs per billing interval, in cents, excluding VAT. */
  priceCents: Record<BillingInterval, number>;
  /**
   * The Stripe Price lookup key per interval; null for Free. The `_vN` suffix
   * is how a price change is done: Stripe prices are immutable, so a new price
   * gets `_v2` and existing subscribers keep paying `_v1` (grandfathered).
   */
  lookupKey: Record<BillingInterval, string> | null;
  limits: PlanLimits;
  /** The plan the modal badges as recommended when it has no sales to go on. */
  recommended: boolean;
};

// DRAFT NUMBERS. The owner sets the final prices, fees and limits here.
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    // Today's rate, unchanged, so no existing seller is worse off.
    feeBps: 500,
    priceCents: { month: 0, year: 0 },
    lookupKey: null,
    limits: { storefronts: 3, teamSeats: 2 },
    recommended: false,
  },
  starter: {
    id: "starter",
    feeBps: 300,
    priceCents: { month: 1500, year: 15000 },
    lookupKey: { month: "starter_month_eur_v1", year: "starter_year_eur_v1" },
    limits: { storefronts: 10, teamSeats: 5 },
    recommended: false,
  },
  pro: {
    id: "pro",
    feeBps: 100,
    priceCents: { month: 4000, year: 40000 },
    lookupKey: { month: "pro_month_eur_v1", year: "pro_year_eur_v1" },
    limits: { storefronts: null, teamSeats: null },
    recommended: true,
  },
};

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

/** `<plan>_<interval>_<currency>_v<N>`, the shape every lookup key above has. */
const LOOKUP_KEY_SHAPE = /^([a-z]+)_([a-z]+)_[a-z]{3}_v\d+$/;

/**
 * The paid plan and interval a Stripe price lookup key belongs to, if any.
 *
 * Read from the key's SHAPE, not by matching the current keys above: a seller
 * on a grandfathered `_v1` price is still on that plan after the catalog moves
 * on to `_v2`, and must not read as Free because their key is no longer listed.
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
