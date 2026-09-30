// SERVER ONLY. Turning a Stripe subscription into the one row the rest of the
// app reads (seller_billing), and writing it.
//
// ALWAYS FROM A FRESH FETCH. The webhook never applies an event's payload:
// events arrive late, twice, and out of order. It re-reads the customer's
// subscriptions from Stripe and applies what they say NOW, stamped with when
// it asked. billing_apply_snapshot (the migration) refuses a snapshot older
// than the one stored, so two syncs racing can only ever end on the newer.
//
// The pure half (normalizeSubscription, pickCurrentSubscription,
// planTransition) is unit-tested in tests/unit/billing-sync.test.ts.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  computePaidUntil,
  effectivePlan,
  isLiveSubscription,
  parseSubscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/billing/entitlement";
import {
  planForLookupKey,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import type { StripeSubscription } from "@/lib/billing/stripe-api";

/** What seller_billing holds about a customer's subscription, before writing. */
export type BillingSnapshot = {
  subscriptionId: string | null;
  plan: PaidPlanId | null;
  interval: BillingInterval | null;
  status: SubscriptionStatus | "none";
  priceCents: number | null;
  currency: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  paidUntil: Date | null;
  livemode: boolean;
};

/** A customer with no subscription at all (never subscribed, or all gone). */
export function emptySnapshot(livemode: boolean): BillingSnapshot {
  return {
    subscriptionId: null,
    plan: null,
    interval: null,
    status: "none",
    priceCents: null,
    currency: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    paidUntil: null,
    livemode,
  };
}

const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;

/**
 * One subscription as a snapshot. The plan comes from the price's lookup key
 * (lib/billing/plans.ts `planForLookupKey`); a subscription on a price this
 * app does not recognise grants NO plan (paid_until stays null), because a
 * plan nobody configured is not one to guess the limits of.
 */
export function normalizeSubscription(subscription: StripeSubscription, now: Date = new Date()): BillingSnapshot {
  const item = subscription.items.data[0];
  const priced = item?.price.lookup_key ? planForLookupKey(item.price.lookup_key) : null;
  const status = parseSubscriptionStatus(subscription.status) ?? "incomplete";
  // Since API version `basil` each ITEM carries its own period. A single-item
  // subscription is the only kind this app creates; the latest end wins if
  // Stripe ever reports more.
  const periodEnd = subscription.items.data.reduce<Date | null>((latest, candidate) => {
    const end = fromUnix(candidate.current_period_end);
    return end && (!latest || end > latest) ? end : latest;
  }, null);

  return {
    subscriptionId: subscription.id,
    plan: priced?.plan ?? null,
    interval: priced?.interval ?? null,
    status,
    priceCents: item?.price.unit_amount ?? null,
    currency: item?.price.currency ? item.price.currency.toUpperCase() : null,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: fromUnix(subscription.canceled_at),
    paidUntil: priced ? computePaidUntil(status, periodEnd, subscription.cancel_at_period_end, now) : null,
    livemode: subscription.livemode,
  };
}

/**
 * The subscription that decides a customer's plan: the newest LIVE one, or,
 * with none live, the newest of any status (so a cancelled plan still shows as
 * cancelled). A customer should never hold two live subscriptions (the
 * checkout action refuses to open a second), but if Stripe reports two, the
 * newest wins and the other is logged for support to refund.
 */
export function pickCurrentSubscription(subscriptions: readonly StripeSubscription[]): StripeSubscription | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created);
  const live = newestFirst.filter((candidate) => isLiveSubscription(parseSubscriptionStatus(candidate.status)));
  if (live.length > 1) {
    console.error(
      `[billing] customer ${live[0]!.customer} holds ${live.length} live subscriptions; the newest decides the plan`,
    );
  }
  return live[0] ?? newestFirst[0] ?? null;
}

/** What changed for the seller between two effective plans, for the funnel
 *  and the notification. Null when nothing a seller would notice changed. */
export type PlanTransition = "upgraded" | "plan_changed" | "downgraded";

export function planTransition(before: PlanId, after: PlanId): PlanTransition | null {
  if (before === after) return null;
  if (before === "free") return "upgraded";
  if (after === "free") return "downgraded";
  return "plan_changed";
}

export type ApplyResult = {
  /** False when a newer snapshot was already stored and this one was dropped. */
  applied: boolean;
  /** The effective plan before and after this write. */
  before: PlanId;
  after: PlanId;
};

/**
 * Write a snapshot for an account, stamped `syncedAt` (when it was fetched).
 * Throws on a database error: the webhook turns that into a 500 so Stripe
 * delivers the event again.
 */
export async function applyBillingSnapshot(
  ownerId: string,
  customerId: string,
  snapshot: BillingSnapshot,
  syncedAt: Date,
): Promise<ApplyResult> {
  const { data, error } = await createAdminClient().rpc("billing_apply_snapshot", {
    p_owner: ownerId,
    p_customer: customerId,
    p_subscription: snapshot.subscriptionId,
    p_plan: snapshot.plan,
    p_interval: snapshot.interval,
    p_status: snapshot.status,
    p_price_cents: snapshot.priceCents,
    p_currency: snapshot.currency,
    p_current_period_end: snapshot.currentPeriodEnd?.toISOString() ?? null,
    p_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
    p_canceled_at: snapshot.canceledAt?.toISOString() ?? null,
    p_paid_until: snapshot.paidUntil?.toISOString() ?? null,
    p_livemode: snapshot.livemode,
    p_synced_at: syncedAt.toISOString(),
  });
  if (error) throw new Error(`billing_apply_snapshot failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const before = effectivePlan(
    row ? { plan: row.previous_plan, paid_until: row.previous_paid_until } : null,
    syncedAt,
  );
  const after = effectivePlan(
    { plan: snapshot.plan, paid_until: snapshot.paidUntil?.toISOString() ?? null },
    syncedAt,
  );
  return { applied: Boolean(row?.applied), before, after };
}
