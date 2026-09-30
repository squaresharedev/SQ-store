// WHICH PLAN AN ACCOUNT IS ON, decided from one stored date. Pure: no I/O.
//
// THE RULE. `seller_billing.paid_until` is the moment an account's paid plan
// stops applying. Until then the account is on `seller_billing.plan`; from
// then on, and whenever there is no billing row at all, it is on Free.
//
// WHY A DATE AND NOT STRIPE'S STATUS. Every reader (the fee at checkout, the
// limit checks, the shell's plan chip) needs an answer without calling
// Stripe, and must keep working when Stripe is slow or down. The webhook
// turns each subscription into a date once (computePaidUntil below); the
// readers only compare it with the clock. A webhook that never arrives can
// therefore delay a downgrade by a bounded slack at most. It can never leave
// a cancelled seller on a paid plan for good.
//
// FALLING BACK TO FREE NEVER TAKES ANYTHING DOWN. Free can build, publish and
// sell; a downgraded seller keeps every storefront and teammate they have and
// only stops being able to add more past Free's limits (limits.ts).

import {
  DEFAULT_PLAN,
  PAST_DUE_GRACE_DAYS,
  RENEWAL_SLACK_HOURS,
  parsePaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";

/** The columns every plan reader selects from seller_billing, and no more. */
export const BILLING_PLAN_SELECT = "plan, paid_until" as const;

/** A seller_billing row as the plan readers see it (BILLING_PLAN_SELECT). */
export type BillingPlanRow = {
  plan: string | null;
  paid_until: string | null;
};

/**
 * The plan in force for an account at `now`. No row, an unknown plan, an
 * unreadable date, or a date in the past all mean Free.
 */
export function effectivePlan(row: BillingPlanRow | null | undefined, now: Date = new Date()): PlanId {
  if (!row) return DEFAULT_PLAN;
  const plan = parsePaidPlanId(row.plan);
  if (!plan || !row.paid_until) return DEFAULT_PLAN;
  const until = Date.parse(row.paid_until);
  if (!Number.isFinite(until) || until <= now.getTime()) return DEFAULT_PLAN;
  return plan;
}

/** Stripe's subscription statuses, as the webhook reads them. */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Narrow an untrusted status string. Unknown statuses read as null. */
export function parseSubscriptionStatus(value: unknown): SubscriptionStatus | null {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The `paid_until` a subscription earns, as of `now`:
 *
 *   active / trialing   the end of the paid period, plus RENEWAL_SLACK_HOURS
 *                       so a renewal that lands a little late does not flicker
 *                       the seller down to Free and back. A subscription set
 *                       to cancel at period end gets no slack: it is ending.
 *   past_due            the end of the period plus PAST_DUE_GRACE_DAYS while
 *                       Stripe retries the card.
 *   anything else       now: the plan has ended (cancelled, unpaid, paused, or
 *                       never paid for in the first place).
 *
 * `periodEnd` is null when Stripe did not say; that also ends the plan now,
 * because a paid plan with no known end is not one to keep granting.
 */
export function computePaidUntil(
  status: SubscriptionStatus,
  periodEnd: Date | null,
  cancelAtPeriodEnd: boolean,
  now: Date = new Date(),
): Date {
  if (!periodEnd) return now;
  switch (status) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd
        ? periodEnd
        : new Date(periodEnd.getTime() + RENEWAL_SLACK_HOURS * HOUR_MS);
    case "past_due":
      return new Date(periodEnd.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
    default:
      return now;
  }
}

/** Statuses under which a subscription is still live at Stripe: a second
 *  Checkout for such a customer would be a second subscription. `none` (a
 *  customer who never subscribed) and null are not. */
export function isLiveSubscription(status: SubscriptionStatus | "none" | null): boolean {
  return status === "active" || status === "trialing" || status === "past_due" || status === "unpaid";
}
