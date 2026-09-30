// SERVER ONLY. Reading an account's billing row: the plan it is on, and what
// the settings page and the pricing modal show about it.
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
import {
  parseBillingInterval,
  parsePaidPlanId,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";

/** An account's billing as the server holds it. */
export type AccountBilling = {
  /** The plan in force NOW: Free unless a paid plan is paid up. */
  plan: PlanId;
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
 * The billing row for `accountId`, or Free when it has none. `{ ok: false }`
 * on a read error: callers decide which way to fail (the checkout refuses to
 * price a sale; the shell simply shows no plan chip).
 */
export async function readAccountBilling(accountId: string, now: Date = new Date()): Promise<AccountBillingResult> {
  try {
    const { data, error } = await createAdminClient()
      .from("seller_billing")
      .select(BILLING_SELECT)
      .eq("owner_id", accountId)
      .maybeSingle();
    if (error) {
      console.error("[billing] reading the billing row failed:", error.message);
      return { ok: false };
    }
    if (!data) return { ok: true, billing: FREE_BILLING };
    return {
      ok: true,
      billing: {
        plan: effectivePlan(data, now),
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

/** readAccountBilling, once per request: the shell, the page and the modal
 *  loader all ask on the same render. */
export const getAccountBilling = cache((accountId: string) => readAccountBilling(accountId));
