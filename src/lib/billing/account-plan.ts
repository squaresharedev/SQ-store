// SERVER ONLY. Reading an account's billing row: the plan it is on, and what
// the settings page and the plans page show about it.
//
// THE PLAN IN FORCE is the higher of the paid plan and a plan staff granted
// (plan_grants, lib/billing/grants.ts): every reader that asks which plan an
// account is on gets the grant through here, the fee at checkout included.
//
// SERVICE ROLE, and so NOT an access check. seller_billing has no client
// policy (see the migration), so every read goes through here. A caller must
// already know it is entitled to ask about `accountId`: the dashboard passes
// the ACTIVE account from getActiveAccount() (a membership the server has
// re-validated), and the checkout passes the seller behind the product gate.
// Nothing here may take an account id from a request.
//
// The Stripe ids come back for the server's own use (opening Checkout or the
// Customer Portal). They are never put on anything sent to a browser.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  effectivePlan,
  parseSubscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/billing/entitlement";
import { GRANT_SELECT, activeGrant, grantedPlan, type ActiveGrant, type PlanSource } from "@/lib/billing/grants";
import { isMissingTableError } from "@/lib/supabase/errors";
import {
  parseBillingInterval,
  parsePaidPlanId,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";

/** An account's billing as the server holds it. */
export type AccountBilling = {
  /** The plan in force NOW: the higher of a paid-up plan and an active grant,
   *  Free with neither. */
  plan: PlanId;
  /** What sets `plan`: a subscription, a grant from staff, or nothing. */
  planSource: PlanSource;
  /** The plan staff granted, while it applies (whether or not it is the
   *  higher of the two). */
  grant: ActiveGrant | null;
  /** The paid plan on file, even if it has lapsed (to say "Pro ended"). */
  storedPlan: PaidPlanId | null;
  status: SubscriptionStatus | "none";
  interval: BillingInterval | null;
  /** What this account actually pays per interval (grandfathered prices). */
  priceCents: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paidUntil: string | null;
  /** Server-only. */
  customerId: string | null;
  /** Server-only. */
  subscriptionId: string | null;
};

/** An account that has never been to checkout: Free, nothing on file. */
export const FREE_BILLING: AccountBilling = {
  plan: "free",
  planSource: "free",
  grant: null,
  storedPlan: null,
  status: "none",
  interval: null,
  priceCents: null,
  currency: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  paidUntil: null,
  customerId: null,
  subscriptionId: null,
};

export type AccountBillingResult = { ok: true; billing: AccountBilling } | { ok: false };

const BILLING_SELECT =
  "plan, paid_until, status, billing_interval, price_cents, currency, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id" as const;

/**
 * The plan staff granted `accountId`, if one applies at `now`. `undefined` on
 * a read error. A database without the table (20261019_plan_grants not
 * applied yet) has no grants, which is not an error.
 */
async function readActiveGrant(accountId: string, now: Date): Promise<ActiveGrant | null | undefined> {
  const { data, error } = await createAdminClient()
    .from("plan_grants")
    .select(GRANT_SELECT)
    .eq("owner_id", accountId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    console.error("[billing] reading the plan grant failed:", error.message);
    return undefined;
  }
  return activeGrant(data, now);
}

/**
 * The billing row for `accountId` with any plan staff granted it, or Free
 * when it has neither. `{ ok: false }` on a read error: callers decide which
 * way to fail (the checkout refuses to price a sale; the shell simply shows
 * no plan chip).
 */
export async function readAccountBilling(accountId: string, now: Date = new Date()): Promise<AccountBillingResult> {
  try {
    const [{ data, error }, grant] = await Promise.all([
      createAdminClient().from("seller_billing").select(BILLING_SELECT).eq("owner_id", accountId).maybeSingle(),
      readActiveGrant(accountId, now),
    ]);
    if (error) {
      console.error("[billing] reading the billing row failed:", error.message);
      return { ok: false };
    }
    if (grant === undefined) return { ok: false };
    const inForce = grantedPlan(effectivePlan(data, now), grant);
    if (!data) return { ok: true, billing: { ...FREE_BILLING, plan: inForce.plan, planSource: inForce.source, grant } };
    return {
      ok: true,
      billing: {
        plan: inForce.plan,
        planSource: inForce.source,
        grant,
        storedPlan: parsePaidPlanId(data.plan),
        status: parseSubscriptionStatus(data.status) ?? "none",
        interval: parseBillingInterval(data.billing_interval),
        priceCents: data.price_cents,
        currency: data.currency,
        currentPeriodEnd: data.current_period_end,
        cancelAtPeriodEnd: data.cancel_at_period_end,
        paidUntil: data.paid_until,
        customerId: data.stripe_customer_id,
        subscriptionId: data.stripe_subscription_id,
      },
    };
  } catch (error) {
    // createAdminClient throws without the service role key.
    console.error("[billing] reading the billing row threw:", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

/**
 * The account's last 30 days of paid sales through its own doors, in cents:
 * the whole amount buyers paid, delivery included, which is what the plan's
 * per-sale fee is charged on. Sales the marketplace brought are left out (a
 * plan does not change what those pay). For the pricing calculator and the
 * upgrade hint. Null when unreadable: both then start from a default instead
 * of a wrong figure.
 */
export async function readDirectSales30d(accountId: string): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().rpc("billing_sales_30d", { p_seller_id: accountId });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return null;
    return Number(row.direct_cents);
  } catch {
    return null;
  }
}

/** readAccountBilling, once per request: the shell, the page and the Orders
 *  export check all ask on the same render. */
export const getAccountBilling = cache((accountId: string) => readAccountBilling(accountId));
