// SERVER ONLY. THE BILLING PROVIDER SEAM: everything the app asks of whoever
// takes a seller's subscription money, as one interface with two
// implementations (lib/billing/providers.ts picks one, per
// lib/billing/availability.ts):
//
//   stripe-provider.ts   Stripe Billing on the platform account.
//   test-provider.ts     Development only: writes seller_billing directly, so
//                        the whole flow runs on a laptop and in the e2e suite.
//
// The actions (lib/billing/actions.ts) and the webhook only ever talk to this
// interface, which is what lets the test provider stand in for Stripe without
// a single `if (test)` anywhere else.
//
// Types and the error class only: the implementations import from here, so
// this module must not import them back.

import type { Locale } from "@/i18n/locales";
import type { BillingProviderId } from "@/lib/billing/availability";
import type { CancellationFeedback } from "@/lib/billing/cancellation";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";
import type { ApplyResult } from "@/lib/billing/sync";

/** What a new billing customer is created with, from the seller's profile. */
export type BillingCustomerDetails = {
  ownerId: string;
  /** The account's sign-in email: where receipts and dunning mail go. */
  email: string | null;
  /** The registered business name (Settings › Business & seller details). */
  name: string | null;
  /** ISO 3166-1 alpha-2, for VAT. */
  country: string | null;
  /** EU VAT ID, for the reverse charge. Dropped if Stripe rejects its format. */
  vatId: string | null;
  locale: Locale;
};

/**
 * What a Customer Portal session opens on. There is deliberately no "cancel":
 * cancelling happens in the app (cancelPlan in lib/billing/actions.ts), where
 * the seller can say why, and the Stripe portal configuration must have
 * `subscription_cancel` switched OFF so its home page cannot go around that.
 */
export type PortalFlow =
  /** The portal's home: card, invoices, address, VAT ID. */
  | { kind: "manage" }
  /** Straight to "confirm the switch to this plan", with Stripe's proration. */
  | { kind: "switch"; plan: PaidPlanId; interval: BillingInterval };

export type CheckoutRequest = {
  ownerId: string;
  customerId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  locale: Locale;
  /** Must contain `{CHECKOUT_SESSION_ID}`, which the provider fills in. */
  successUrl: string;
  cancelUrl: string;
};

export type PortalRequest = {
  ownerId: string;
  customerId: string;
  subscriptionId: string | null;
  flow: PortalFlow;
  locale: Locale;
  returnUrl: string;
};

export interface BillingProvider {
  readonly id: BillingProviderId;
  /** Create the customer record for an account. Idempotent per account. */
  createCustomer(details: BillingCustomerDetails): Promise<string>;
  /** A hosted checkout for a new subscription; returns its URL. */
  createCheckout(request: CheckoutRequest): Promise<string>;
  /** A hosted Customer Portal session; returns its URL. */
  createPortal(request: PortalRequest): Promise<string>;
  /** Re-read the customer's subscriptions and write seller_billing. */
  syncCustomer(ownerId: string, customerId: string): Promise<ApplyResult>;
  /**
   * End a subscription at the close of its paid period: the seller's own
   * cancel (with what they told us, passed on to the provider), or an account
   * deletion request. Writes the result to seller_billing. Safe to call again
   * after a resume: each call is its own request, never a replay.
   */
  scheduleCancellation(
    ownerId: string,
    customerId: string,
    subscriptionId: string,
    feedback?: CancellationFeedback,
  ): Promise<void>;
  /**
   * Undo a scheduled cancellation while the paid period is still running, so
   * the subscription renews as before. Refuses a subscription that is not
   * this customer's, already over, or past its period end. Writes the result
   * to seller_billing.
   */
  resumeSubscription(ownerId: string, customerId: string, subscriptionId: string): Promise<void>;
  /** The customer a checkout session belongs to, or null if unknown. */
  checkoutSessionCustomer(sessionId: string): Promise<string | null>;
}

/**
 * A configuration fault: a Stripe price that is missing, inactive, or does not
 * charge what plan_prices says it does, or a plan not sold by that interval. Logged loudly; the seller is only told
 * the upgrade is unavailable right now. Charging a price the plans page did not
 * show would be worse than not charging at all.
 */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}
