// SERVER ONLY. Whether Square Share checkout can take a buyer's money, and
// through what.
//
// Checkout only appears where a payment can actually be completed. A "Pay"
// button that leads nowhere is worse than the seller's own link or an enquiry
// email, which is what the product page falls back to (see
// components/product-page/cta-target.ts) wherever this says no.
//
// TWO PROVIDERS, one question:
//   - `stripe`, once Stripe Connect onboarding exists: the seller's own
//     connected account takes the charge (see lib/payments/availability.ts,
//     which is the switch, and the header of lib/orders/record.ts for what the
//     webhook owes the order writer). Not wired yet, so never returned.
//   - `test`, the development stand-in: no money moves, and the order is
//     written through the same writer the webhook will use, so the whole flow
//     (page, quote, order, emails, thank-you) can be driven on a laptop and in
//     the e2e suite. It exists ONLY under `next dev` AND with
//     CHECKOUT_TEST_PAYMENTS=1. A deployed Worker is a production build, so
//     neither half can be true there; tests/unit/checkout-availability.test.ts
//     pins that.

import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { turnstileEnabled } from "@/lib/turnstile";
import { canQuoteShipping } from "@/lib/shipping/rates";
import { toCurrency } from "@/lib/format/money";
import type { Purchasable } from "@/lib/products/purchasable";

export type CheckoutProviderId = "test" | "stripe";

/** Whether the development test provider is switched on for this process. */
export function testPaymentsEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.CHECKOUT_TEST_PAYMENTS === "1";
}

/**
 * The provider that would take this seller's payment, or null when none can.
 * `ownerId` is unused until Stripe lands, when it becomes "has this seller
 * connected an account that can take charges".
 */
export function checkoutProviderFor(ownerId: string): CheckoutProviderId | null {
  void ownerId;
  if (STRIPE_CONNECT_AVAILABLE && turnstileEnabled()) {
    // TODO(stripe): look up the seller's connected account and return "stripe"
    // when it has charges enabled. Until then Connect is not live, so there is
    // no account to charge.
    //
    // `turnstileEnabled()` is in the condition on purpose: a checkout that
    // creates real payments with only a per-IP rate limit in front of it is a
    // card-testing endpoint, and the bot check is off unless its keys are
    // configured. Real payments therefore cannot be switched on by flipping
    // STRIPE_CONNECT_AVAILABLE alone; the keys have to be there too.
  }
  return testPaymentsEnabled() ? "test" : null;
}

/**
 * Whether THIS product can be bought through checkout right now: a provider
 * can take the money, and, for something that ships, the seller has priced
 * delivery in the product's currency. A physical product without a delivery
 * price cannot show an honest total (EU CRD art. 6(1)(e)), so it keeps the
 * product page's fallback instead.
 */
export function checkoutAvailableFor(gate: Purchasable): boolean {
  if (!checkoutProviderFor(gate.ownerId)) return false;
  const isDigital = gate.row.digital_file_key !== null;
  return isDigital || canQuoteShipping(gate.shippingPolicy, toCurrency(gate.row.currency));
}
