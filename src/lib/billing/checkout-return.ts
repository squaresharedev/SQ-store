// SERVER ONLY. Coming back from Stripe Checkout.
//
// Stripe sends the owner back to Settings › Plan & billing with the checkout
// session id. The webhook is what makes the new plan stick, but it can land a
// few seconds after the browser does; this closes that gap by syncing the
// account right away, so the page can say "You're on Pro" instead of "Free"
// on the first render.
//
// THE SESSION ID IS A CLAIM, NOT A CREDENTIAL. Anyone can put any id in the
// URL. It is only acted on if Stripe says the session belongs to THIS
// account's own stored customer; otherwise nothing happens. And the sync it
// triggers re-reads the account's subscriptions from Stripe, so even a
// matching id can only ever make the row agree with Stripe, never with the URL.

import { readAccountBilling } from "@/lib/billing/account-plan";
import { getBillingProvider } from "@/lib/billing/providers";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import type { PlanId } from "@/lib/billing/plans";

/** Stripe's checkout session ids (and the test provider's). */
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

export type CheckoutReturn =
  /** Synced: the account is on `plan` now. */
  | { kind: "confirmed"; plan: PlanId }
  /** Not (yet) confirmed: an unknown session, one that is not this account's,
   *  or Stripe could not be asked. The webhook will still settle it. */
  | { kind: "pending" };

/**
 * Confirm a returning checkout for the owner's own account. `accountId` must
 * be the signed-in owner's (the settings page is the owner's own).
 */
export async function confirmCheckoutReturn(accountId: string, sessionId: string): Promise<CheckoutReturn> {
  if (!CHECKOUT_SESSION_ID.test(sessionId)) return { kind: "pending" };
  const provider = getBillingProvider();
  if (!provider) return { kind: "pending" };
  // Each reload of the return URL asks Stripe; a reload loop must not be able
  // to spend the platform's API quota.
  if (!(await rateLimit("billing_return", RATE_LIMITS.billingRead))) return { kind: "pending" };

  const billing = await readAccountBilling(accountId);
  if (!billing.ok || !billing.billing.customerId) return { kind: "pending" };

  try {
    const sessionCustomer = await provider.checkoutSessionCustomer(sessionId);
    if (sessionCustomer !== billing.billing.customerId) return { kind: "pending" };
    const synced = await provider.syncCustomer(accountId, billing.billing.customerId);
    return { kind: "confirmed", plan: synced.after };
  } catch (error) {
    console.error(
      "[billing] confirming a checkout return failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    return { kind: "pending" };
  }
}
