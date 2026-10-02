// SERVER ONLY. What the plans page and Settings › Plan & billing know about the
// ACTIVE store's plan, in one read.
//
// Called while rendering those pages (not a server action): the store is the
// active account getActiveAccount() has just re-validated, never an id from the
// request. What comes back goes to the browser, so it carries no Stripe ids
// and no customer details, only what the page shows.

import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { readAccountBilling, readSalesSubtotal30d } from "@/lib/billing/account-plan";
import { billingProvider } from "@/lib/billing/availability";
import { isLiveSubscription, type SubscriptionStatus } from "@/lib/billing/entitlement";
import { recordFunnelEvent } from "@/lib/billing/funnel";
import { countPlanUsage } from "@/lib/billing/limits";
import type { PricingSource } from "@/lib/billing/paths";
import type { BillingInterval, PlanId, PlanLimitKey } from "@/lib/billing/plans";

export type PricingContext = {
  /** The plan in force now. */
  plan: PlanId;
  interval: BillingInterval | null;
  status: SubscriptionStatus | "none";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  /** What this store pays per interval (grandfathered prices). Null for a
   *  teammate: what the owner pays is the owner's business. */
  priceCents: number | null;
  currency: string | null;
  /** A live subscription exists: plan changes go through the Customer Portal
   *  (switch or cancel), never a second checkout. */
  hasSubscription: boolean;
  /** The store has a billing customer, so invoices and a card can exist. */
  hasBillingAccount: boolean;
  /** The viewer is the store's owner, the only person who can change its plan. */
  canManage: boolean;
  /** Plans can be bought in this deployment (a billing provider is set up). */
  available: boolean;
  /** The last 30 days of item sales, for the calculator and the upsell; null
   *  when unreadable. */
  salesSubtotal30dCents: number | null;
  /** What the store has of each capped thing now; null when uncounted. */
  usage: Record<PlanLimitKey, number | null>;
};

export type PricingContextResult =
  | { ok: true; context: PricingContext }
  | { ok: false; reason: "signed_out" | "unavailable" };

/**
 * The active store's plan context. With `source`, records a `pricing_viewed`
 * funnel event (at most once per entry point per ten minutes per person, so a
 * reload is not a second visit).
 */
export async function getPricingContext(source?: PricingSource | null): Promise<PricingContextResult> {
  const account = await getActiveAccount();
  if (!account) return { ok: false, reason: "signed_out" };
  // Every member can see the plan their store is on (store.read is every role).
  if (!can(account.role, "store.read")) return { ok: false, reason: "signed_out" };

  const billing = await readAccountBilling(account.accountId);
  if (!billing.ok) return { ok: false, reason: "unavailable" };

  const [salesSubtotal30dCents, storefronts, teamSeats, products] = await Promise.all([
    readSalesSubtotal30d(account.accountId),
    countPlanUsage(account.accountId, "storefronts"),
    countPlanUsage(account.accountId, "teamSeats"),
    countPlanUsage(account.accountId, "products"),
  ]);

  if (source && (await rateLimit(`pricing_view:${source}`, RATE_LIMITS.pricingViewDedupe))) {
    await recordFunnelEvent({
      accountId: account.accountId,
      actorId: account.userId,
      kind: "pricing_viewed",
      source,
      plan: billing.billing.plan,
    });
  }

  const { billing: b } = billing;
  const canManage = account.isOwner && can(account.role, "billing.manage");
  return {
    ok: true,
    context: {
      plan: b.plan,
      interval: b.interval,
      status: b.status,
      cancelAtPeriodEnd: b.cancelAtPeriodEnd,
      currentPeriodEnd: b.currentPeriodEnd,
      priceCents: canManage ? b.priceCents : null,
      currency: b.currency,
      hasSubscription: Boolean(b.subscriptionId) && isLiveSubscription(b.status),
      hasBillingAccount: b.customerId !== null,
      canManage,
      available: billingProvider() !== null,
      salesSubtotal30dCents,
      usage: { storefronts, teamSeats, products },
    },
  };
}
