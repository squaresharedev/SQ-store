// SERVER ONLY. THE PAYMENT PROVIDERS: what happens when a buyer presses Pay.
//
// Every provider is handed a QUOTE (lib/checkout/quote.ts), never a request:
// the amount it charges is the one the quote worked out from the database.
// And every provider ends in the same place, the order writer
// (lib/orders/record.ts), so an order looks the same, is deduplicated the same
// way and tells the seller and the buyer the same things however it was paid.
//
//   - "test": development only (see lib/checkout/availability.ts for the
//     double gate). Records the order the moment Pay is pressed, with no money
//     moving, so the whole flow can be exercised end to end.
//   - "stripe": TODO(stripe). Creates a Checkout Session (ui_mode "elements")
//     on the seller's CONNECTED account from the quote, with
//     application_fee_amount as our cut (sellerFee below: the seller's plan
//     rate on the item subtotal) and the quote in its metadata; the
//     buyer confirms payment in the Payment Element; the webhook (and the
//     return route, idempotently) hand the paid session to the order writer.
//     See the header of lib/orders/record.ts for what the webhook owes it.

import { createAdminClient } from "@/lib/supabase/admin";
import { recordPaidOrder } from "@/lib/orders/record";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { saleFee, type SaleFee } from "@/lib/billing/fees";
import { testPaymentsEnabled, type CheckoutProviderId } from "@/lib/checkout/availability";
import type { CheckoutQuote } from "@/lib/checkout/quote";
import type { ShipTo } from "@/types/order-view";

/** Who is buying and where it goes, as validated by the order route. */
export type CheckoutBuyer = {
  email: string;
  locale: string;
  shipTo: ShipTo | null;
  giftMessage: string | null;
  supplyConsent: boolean;
};

export type PlaceResult =
  | { ok: true; orderId: string }
  | { ok: false; reason: "unavailable" | "failed" };

/** The test provider's checkout ids. Its own prefix, so one can never be
 *  mistaken for a real Stripe test-mode session (`cs_test_...`). */
const TEST_SESSION_PREFIX = "cs_sstest_";

/**
 * Our cut of this sale: the seller's plan rate (lib/billing/plans.ts) on the
 * item subtotal, shipping excluded. Null when the seller's plan cannot be
 * read, and the sale is then refused rather than charged a guessed rate: the
 * fee is part of the seller's contract, and a buyer retrying a moment later
 * loses nothing.
 */
async function sellerFee(quote: CheckoutQuote): Promise<SaleFee | null> {
  const billing = await readAccountBilling(quote.gate.ownerId);
  return billing.ok ? saleFee(billing.billing.plan, quote.subtotalCents) : null;
}

/**
 * Take the payment for a quote and record the order.
 *
 * `attemptId` was minted when the checkout rendered, and it is what the
 * payment is keyed on: pressing Pay twice, or a retried request, records one
 * order and answers with it both times.
 */
export async function placeOrder(
  provider: CheckoutProviderId,
  quote: CheckoutQuote,
  buyer: CheckoutBuyer,
  attemptId: string,
): Promise<PlaceResult> {
  switch (provider) {
    case "test":
      return placeTestOrder(quote, buyer, attemptId);
    case "stripe":
      // TODO(stripe): create the Checkout Session here and return its client
      // secret for the Payment Element instead of an order.
      return { ok: false, reason: "unavailable" };
  }
}

async function placeTestOrder(
  quote: CheckoutQuote,
  buyer: CheckoutBuyer,
  attemptId: string,
): Promise<PlaceResult> {
  // Re-checked here, not only when the page decided to offer checkout: this is
  // the line that writes an order without a payment, and it must be
  // impossible to reach in a deployed build however the request got here.
  if (!testPaymentsEnabled()) return { ok: false, reason: "unavailable" };

  const fee = await sellerFee(quote);
  if (!fee) return { ok: false, reason: "failed" };

  const checkoutSessionId = `${TEST_SESSION_PREFIX}${attemptId.replace(/-/g, "")}`;
  const result = await recordPaidOrder({
    checkoutSessionId,
    productId: quote.productId,
    sellerId: quote.gate.ownerId,
    storefrontId: quote.gate.storefront.id,
    channel: "direct",
    quantity: quote.quantity,
    selection: quote.selection,
    amountCents: quote.totalCents,
    shippingCents: quote.shippingCents,
    ...fee,
    currency: quote.currency,
    buyerEmail: buyer.email,
    buyerLocale: buyer.locale,
    shipTo: buyer.shipTo,
    giftMessage: buyer.giftMessage,
    supplyConsent: buyer.supplyConsent,
  });
  if (!result.ok) return { ok: false, reason: "failed" };
  if (!result.duplicate) return { ok: true, orderId: result.orderId };

  // A REPEAT of an attempt answers with its order only for the same buyer
  // buying the same thing. The attempt id lives in one buyer's page and
  // nowhere else, but an order link is a credential, and a request that merely
  // guessed or copied an attempt id must not be handed someone else's.
  const { data: existing } = await createAdminClient()
    .from("orders")
    .select("buyer_email, product_id")
    .eq("id", result.orderId)
    .maybeSingle();
  const same =
    existing?.product_id === quote.productId &&
    existing?.buyer_email?.toLowerCase() === buyer.email.toLowerCase();
  return same ? { ok: true, orderId: result.orderId } : { ok: false, reason: "failed" };
}
