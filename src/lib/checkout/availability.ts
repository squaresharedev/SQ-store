// SERVER ONLY. Whether Square Share checkout can take a buyer's money, and
// through what.
//
// Checkout only appears where a payment can actually be completed. A "Pay"
// button that leads nowhere is worse than the seller's own link or an enquiry
// email, which is what the product page falls back to (see
// components/product-page/cta-target.ts) wherever this says no.
//
// TWO PROVIDERS, one question:
//   - `stripe`: the seller's own connected Stripe account takes the charge
//     (lib/checkout/stripe-provider.ts). Offered only where Connect is live
//     (lib/payments/connect/config.ts), this seller's account may take
//     charges, and the two things a real payment must never go without are in
//     place: the bot check and mail (see below).
//   - `test`, the development stand-in: no money moves, and the order is
//     written through the same writer the webhook will use, so the whole flow
//     (page, quote, order, emails, thank-you) can be driven on a laptop and in
//     the e2e suite. It exists ONLY under `next dev` AND with
//     CHECKOUT_TEST_PAYMENTS=1. A deployed Worker is a production build, so
//     neither half can be true there; tests/unit/checkout-core.test.ts pins
//     that.
//
// AND ONE CONDITION ON BOTH: an order link can be issued (ORDER_LINK_SECRET,
// lib/orders/order-link.ts). The link is the buyer's only way back to what
// they paid for. Without the key the payment would still be taken and the
// order written, and the buyer would be left with neither a page nor a
// download, so no provider is offered at all.

import { emailSendingEnabled } from "@/lib/email/send";
import { canTakePayments, readPaymentAccount } from "@/lib/payments/connect/account";
import { stripeConnectLive } from "@/lib/payments/connect/config";
import { orderLinksAvailable } from "@/lib/orders/order-link";
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
 * Whether real payments have the two guards they must never go without.
 *
 * THE BOT CHECK. A checkout that creates real payments with only a per-IP rate
 * limit in front of it is a card-testing endpoint, and the bot check is off
 * unless its keys are configured. Real payments therefore cannot be switched
 * on by the Connect switch alone; the Turnstile keys have to be there too.
 * Demanded of a DEPLOYED build, which is the only thing a card tester can
 * reach: a development server talks to Stripe's test mode (or the e2e stack's
 * stand-in) and has no widget to solve.
 *
 * MAIL. A paid order is announced to the seller and confirmed to the buyer by
 * email (lib/orders/emails.ts). Without a mail provider a sale would happen in
 * silence, the seller learning of a parcel they owe only by opening the
 * dashboard, the buyer with money taken and nothing in their inbox.
 */
function realPaymentsGuarded(): boolean {
  const botCheck = process.env.NODE_ENV !== "production" || turnstileEnabled();
  return botCheck && emailSendingEnabled();
}

/**
 * The provider that would take this seller's payment, or null when none can.
 *
 * The test provider wins in development, like the billing one
 * (lib/billing/availability.ts): a laptop that happens to hold Stripe test
 * keys still runs the checkout specs without touching Stripe.
 */
export async function checkoutProviderFor(ownerId: string): Promise<CheckoutProviderId | null> {
  if (!orderLinksAvailable()) return null;
  if (testPaymentsEnabled()) return "test";
  if (stripeConnectLive() && realPaymentsGuarded()) {
    // The seller has connected an account, and Stripe says it may take
    // payments (in this deployment's mode).
    if (canTakePayments(await readPaymentAccount(ownerId))) return "stripe";
  }
  return null;
}

/**
 * Whether THIS product can be bought through checkout right now: a provider
 * can take the money, and, for something that ships, the seller has priced
 * delivery in the product's currency. A physical product without a delivery
 * price cannot show an honest total (EU CRD art. 6(1)(e)), so it keeps the
 * product page's fallback instead.
 */
export async function checkoutAvailableFor(gate: Purchasable): Promise<boolean> {
  // The cheap, local answer first: a physical product with no delivery price
  // has no checkout whoever would take the money.
  const isDigital = gate.row.digital_file_key !== null;
  if (!isDigital && !canQuoteShipping(gate.shippingPolicy, toCurrency(gate.row.currency))) return false;
  return (await checkoutProviderFor(gate.ownerId)) !== null;
}
