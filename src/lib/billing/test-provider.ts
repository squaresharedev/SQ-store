// SERVER ONLY, DEVELOPMENT ONLY. A stand-in for Stripe Billing, so the pricing
// modal, the settings page, the limits and the per-plan fee can be driven end
// to end on a laptop and in the e2e suite, with no Stripe account.
//
// It pretends each hosted page was completed the moment it is opened: "open
// checkout" subscribes the account there and then and sends the browser
// straight to the success URL; "open the portal" applies the switch or the
// cancellation and sends the browser straight back. What it writes goes
// through applyBillingSnapshot, the same write the Stripe webhook makes, so
// everything downstream of seller_billing is the production code path.
//
// Only reachable when lib/billing/availability.ts says so: `next dev` AND
// BILLING_TEST_PROVIDER=1. Every method re-checks, because this is the file
// that grants a paid plan without a payment.

import { readAccountBilling } from "@/lib/billing/account-plan";
import { billingTestProviderEnabled } from "@/lib/billing/availability";
import { computePaidUntil } from "@/lib/billing/entitlement";
import { PLANS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";
import type {
  BillingCustomerDetails,
  BillingProvider,
  CheckoutRequest,
  PortalRequest,
} from "@/lib/billing/provider";
import { applyBillingSnapshot, type ApplyResult, type BillingSnapshot } from "@/lib/billing/sync";

function assertEnabled(): void {
  if (!billingTestProviderEnabled()) {
    throw new Error("the test billing provider is not enabled in this process");
  }
}

/** The account id without dashes: Stripe-shaped ids are [A-Za-z0-9_]. */
const compact = (ownerId: string) => ownerId.replace(/-/g, "");

/** A pretend checkout session id that names its account, so the success URL
 *  can be resolved back to the customer without storing anything. */
const TEST_SESSION_PREFIX = "cs_sstest_";

/** A paid, active subscription starting now. */
function subscribedSnapshot(ownerId: string, plan: PaidPlanId, interval: BillingInterval, now: Date): BillingSnapshot {
  const periodEnd = new Date(now);
  if (interval === "year") periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  return {
    subscriptionId: `sub_sstest_${compact(ownerId)}`,
    plan,
    interval,
    status: "active",
    priceCents: PLANS[plan].priceCents[interval],
    currency: "EUR",
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    paidUntil: computePaidUntil("active", periodEnd, false, now),
    livemode: false,
  };
}

/** The current paid plan, set to end with its period (what Stripe's
 *  cancel_at_period_end does). No-op for an account on Free. */
async function cancelAtPeriodEnd(ownerId: string, customerId: string, now: Date): Promise<void> {
  const current = await readAccountBilling(ownerId, now);
  if (!current.ok || !current.billing.storedPlan || !current.billing.interval) return;
  const snapshot = subscribedSnapshot(ownerId, current.billing.storedPlan, current.billing.interval, now);
  const periodEnd = current.billing.currentPeriodEnd
    ? new Date(current.billing.currentPeriodEnd)
    : snapshot.currentPeriodEnd;
  await applyBillingSnapshot(
    ownerId,
    customerId,
    {
      ...snapshot,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
      priceCents: current.billing.priceCents,
      paidUntil: computePaidUntil("active", periodEnd, true, now),
    },
    now,
  );
}

export const testBillingProvider: BillingProvider = {
  id: "test",

  async createCustomer(details: BillingCustomerDetails): Promise<string> {
    assertEnabled();
    return `cus_sstest_${compact(details.ownerId)}`;
  },

  async createCheckout(request: CheckoutRequest): Promise<string> {
    assertEnabled();
    await applyBillingSnapshot(
      request.ownerId,
      request.customerId,
      subscribedSnapshot(request.ownerId, request.plan, request.interval, new Date()),
      new Date(),
    );
    return request.successUrl.replace(
      "{CHECKOUT_SESSION_ID}",
      `${TEST_SESSION_PREFIX}${compact(request.ownerId)}`,
    );
  },

  async createPortal(request: PortalRequest): Promise<string> {
    assertEnabled();
    const now = new Date();
    if (request.flow.kind === "switch") {
      await applyBillingSnapshot(
        request.ownerId,
        request.customerId,
        subscribedSnapshot(request.ownerId, request.flow.plan, request.flow.interval, now),
        now,
      );
    } else if (request.flow.kind === "cancel") {
      await cancelAtPeriodEnd(request.ownerId, request.customerId, now);
    }
    return request.returnUrl;
  },

  async scheduleCancellation(ownerId: string, customerId: string): Promise<void> {
    assertEnabled();
    await cancelAtPeriodEnd(ownerId, customerId, new Date());
  },

  async syncCustomer(ownerId: string): Promise<ApplyResult> {
    assertEnabled();
    // Nothing to fetch: seller_billing IS this provider's record.
    const current = await readAccountBilling(ownerId);
    const plan = current.ok ? current.billing.plan : "free";
    return { applied: false, before: plan, after: plan };
  },

  async checkoutSessionCustomer(sessionId: string): Promise<string | null> {
    assertEnabled();
    return sessionId.startsWith(TEST_SESSION_PREFIX)
      ? `cus_sstest_${sessionId.slice(TEST_SESSION_PREFIX.length)}`
      : null;
  },
};
