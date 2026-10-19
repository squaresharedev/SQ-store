// A PLAN STAFF GAVE AWAY: the pure half of plan grants. No I/O.
//
// A grant (table plan_grants, migration 20261019_plan_grants) puts an account
// on Starter or Pro without Stripe, until a date or with no end date. Staff
// set it from the admin panel; nothing a seller does changes it.
//
// THE RULE, the same as account_plan() in SQL: the plan in force is the
// HIGHER of the paid plan and an active grant. A grant never lowers anything
// (a Pro subscriber granted Starter stays on Pro), and when it ends the
// account is simply back on whatever it pays for, Free included.

import { PLAN_IDS, parsePaidPlanId, type PaidPlanId, type PlanId } from "@/lib/billing/plans";

/**
 * Why staff gave the plan. MIRROR of plan_grants_reason_check (the
 * migration) and of the admin panel's lib/plans/grants.ts, which words them;
 * tests/integration/39-plan-grants.test.ts compares this list with the SQL.
 */
export const GRANT_REASONS = [
  "beta_tester",
  "founding_seller",
  "support",
  "partner",
  "promotion",
  "internal",
  "other",
] as const;
export type GrantReason = (typeof GRANT_REASONS)[number];

/** The columns every grant reader selects from plan_grants, and no more. The
 *  reason and note are for staff: the store's own pages never need them. */
export const GRANT_SELECT = "plan, starts_at, ends_at" as const;

/** A plan_grants row as the store reads it (GRANT_SELECT). */
export type PlanGrantRow = {
  plan: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

/** A grant that applies right now. */
export type ActiveGrant = {
  plan: PaidPlanId;
  startsAt: string;
  /** Null: no end date, it holds until staff end it. */
  endsAt: string | null;
};

/**
 * The grant in `row` if it applies at `now`, else null: no row, an unknown
 * plan, an unreadable or future start, or an end that has passed.
 */
export function activeGrant(row: PlanGrantRow | null | undefined, now: Date = new Date()): ActiveGrant | null {
  if (!row?.starts_at) return null;
  const plan = parsePaidPlanId(row.plan);
  const starts = Date.parse(row.starts_at);
  if (!plan || !Number.isFinite(starts) || starts > now.getTime()) return null;
  if (row.ends_at !== null) {
    const ends = Date.parse(row.ends_at);
    if (!Number.isFinite(ends) || ends <= now.getTime()) return null;
  }
  return { plan, startsAt: row.starts_at, endsAt: row.ends_at };
}

/** Plans ranked cheapest first (PLAN_IDS order): higher is more. */
export function planRank(plan: PlanId): number {
  return PLAN_IDS.indexOf(plan);
}

/** Where the plan in force comes from. */
export type PlanSource = "free" | "paid" | "granted";

/**
 * The plan in force given the paid plan (already Free when it lapsed) and an
 * active grant, and which of the two sets it. A tie goes to the paid plan: the
 * seller is paying for it, and the grant is then only a safety net.
 */
export function grantedPlan(
  paidPlan: PlanId,
  grant: ActiveGrant | null,
): { plan: PlanId; source: PlanSource } {
  if (grant && planRank(grant.plan) > planRank(paidPlan)) return { plan: grant.plan, source: "granted" };
  return { plan: paidPlan, source: paidPlan === "free" ? "free" : "paid" };
}
