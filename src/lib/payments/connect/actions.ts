"use server";

import { getUser } from "@/lib/auth/session";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  failure,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import {
  dashboardLink,
  ensurePaymentAccount,
  onboardingLink,
  readPaymentAccount,
} from "@/lib/payments/connect/account";
import { stripeConnectLive } from "@/lib/payments/connect/config";

export type ConnectStripeResult = { ok: true; url: string } | ActionFailure;

/** The active store, when its owner may send it to Stripe at all; else the
 *  failure to answer with. Each action still takes from its own budget. */
async function ownerForStripe() {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!account.isOwner || !can(account.role, "billing.manage")) {
    return failure(permissionDenied(account.role, "connectPayments"));
  }
  if (!stripeConnectLive()) return failure(serverError("connectPayments"));
  return account;
}

/**
 * Send the store's owner to Stripe's hosted onboarding to connect (or finish
 * connecting) their own Stripe account. Returns the URL for the browser to go
 * to, the same way the plans checkout does (lib/billing/actions.ts): the page
 * navigates with window.location.
 *
 * Nothing financial is asked for or stored here. The account is created at
 * Stripe on first use; who the seller is and where their money goes is typed
 * into Stripe's pages, and comes back to us as three booleans.
 *
 * The OWNER's alone (billing.manage on their own store): a connected account
 * decides where every sale's money lands.
 */
export async function startStripeOnboarding(): Promise<ConnectStripeResult> {
  const account = await ownerForStripe();
  if ("ok" in account) return account;
  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failure(rateLimited("connectPayments"));
  }

  try {
    const [user, identity] = await Promise.all([getUser(), getSellerIdentity(account.accountId)]);
    const paymentAccount = await ensurePaymentAccount({
      ownerId: account.accountId,
      // The address buyers reach the seller at, when there is one: it is the
      // one Stripe should write to about the business.
      email: identity.email ?? user?.email ?? null,
      country: identity.country ?? null,
    });
    return { ok: true, url: await onboardingLink(paymentAccount.stripeAccountId) };
  } catch (error) {
    // Never the body: Stripe's errors can quote what was sent.
    console.error("[payments] could not start onboarding:", error instanceof Error ? error.message : error);
    return failure(serverError("connectPayments"));
  }
}

/**
 * Send the owner to their own Stripe dashboard (bank account, payouts). The
 * same guards as onboarding: it opens the account every sale's money lands in.
 * An account that has not finished onboarding has no dashboard yet, so it is
 * sent back into onboarding instead.
 */
export async function openStripeDashboard(): Promise<ConnectStripeResult> {
  const account = await ownerForStripe();
  if ("ok" in account) return account;
  if (!(await rateLimit("billing_write", RATE_LIMITS.billingWrite))) {
    return failure(rateLimited("connectPayments"));
  }

  try {
    const paymentAccount = await readPaymentAccount(account.accountId);
    if (!paymentAccount) return failure(serverError("connectPayments"));
    const { stripeAccountId, detailsSubmitted } = paymentAccount;
    const url = detailsSubmitted ? await dashboardLink(stripeAccountId) : await onboardingLink(stripeAccountId);
    return { ok: true, url };
  } catch (error) {
    console.error("[payments] could not open the Stripe dashboard:", error instanceof Error ? error.message : error);
    return failure(serverError("connectPayments"));
  }
}
