// SERVER ONLY. Whether a seller can change plan here, and through what.
//
// TWO PROVIDERS, one question, the same shape as lib/checkout/availability.ts:
//   - `stripe`: Stripe Billing on the PLATFORM account (Square Share bills the
//     seller; this has nothing to do with Stripe Connect, which is how buyers
//     will pay sellers). Live when both of its secrets are set:
//     STRIPE_SECRET_KEY (a restricted key) and STRIPE_WEBHOOK_SECRET.
//   - `test`: the development stand-in. No money moves; "checkout" writes the
//     subscription straight through the same sync the webhook uses, so the
//     modal, the settings page and the fee a sale is charged can all be driven
//     on a laptop and in the e2e suite. It exists ONLY under `next dev` AND
//     with BILLING_TEST_PROVIDER=1, so a deployed Worker (always a production
//     build) can never reach it.
//
// With neither, every account stays on Free and the pricing modal shows the
// plans with its upgrade buttons marked "Soon". Nothing else changes: the
// plan readers only ever look at seller_billing, never at these switches.

export type BillingProviderId = "stripe" | "test";

/** Whether the development test provider is switched on for this process. */
export function billingTestProviderEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.BILLING_TEST_PROVIDER === "1";
}

/** Whether Stripe Billing has both of its secrets. */
export function stripeBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/**
 * The provider that takes a seller's subscription, or null when plans cannot
 * be bought here. The test provider wins in development so a laptop with real
 * test-mode keys in its env still runs the e2e suite without touching Stripe;
 * unset BILLING_TEST_PROVIDER to drive real Stripe test mode locally.
 */
export function billingProvider(): BillingProviderId | null {
  if (billingTestProviderEnabled()) return "test";
  if (stripeBillingConfigured()) return "stripe";
  return null;
}
