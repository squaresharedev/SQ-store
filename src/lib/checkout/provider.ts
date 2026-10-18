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
//   - "stripe": a direct charge on the seller's CONNECTED account
//     (lib/checkout/stripe-provider.ts). The order is written first, as
//     pending and holding its stock; the buyer pays on Stripe's hosted page;
//     the webhook turns the order into a paid one. So this provider answers
//     with a place to send the browser rather than a finished order.
//     Discounts need nothing from Stripe: the quote's total is already
//     discounted.

import { createAdminClient } from "@/lib/supabase/admin";
import { recordPaidOrder } from "@/lib/orders/record";
import type { SaleFee } from "@/lib/billing/fees";
import { sellerSaleFee } from "@/lib/billing/sale-fee";
import { testPaymentsEnabled, type CheckoutProviderId } from "@/lib/checkout/availability";
import { placeStripeOrder } from "@/lib/checkout/stripe-provider";
import type { CheckoutQuote } from "@/lib/checkout/quote";
import type { OrderChannel, ShipTo } from "@/types/order-view";

/** Who is buying and where it goes, as validated by the order route. */
export type CheckoutBuyer = {
  email: string;
  locale: string;
  shipTo: ShipTo | null;
  giftMessage: string | null;
  supplyConsent: boolean;
  /** Where they arrived from (the seller's buy button, the embed, or
   *  `direct`). Attribution: all three pay the same fee, and the one channel
   *  that pays another (`marketplace`) cannot be claimed by a request (see
   *  lib/billing/origin.ts). */
  channel: OrderChannel;
};

export type PlaceResult =
  // `redirectUrl`: the payment is still to be made, on the provider's own page.
  // Absent when the order is already paid (the test provider), and the buyer
  // goes straight to their order.
  | { ok: true; orderId: string; redirectUrl?: string }
  // `sold_out`: the last units went to someone else between the quote and the
  // order. Refused by the order writer before anything was charged.
  | { ok: false; reason: "unavailable" | "failed" | "sold_out" };

/** The test provider's checkout ids. Its own prefix, so one can never be
 *  mistaken for a real Stripe test-mode session (`cs_test_...`). */
const TEST_SESSION_PREFIX = "cs_sstest_";

/**
 * Our cut of this sale (lib/billing/sale-fee.ts): the seller's plan rate on
 * everything the buyer pays, after discounts, delivery included. A seller is
 * never charged a fee on money they gave away. Null when what sets the fee
 * cannot be read, and the sale is then refused rather than charged a guessed
 * rate.
 */
function sellerFee(quote: CheckoutQuote, buyer: CheckoutBuyer): Promise<SaleFee | null> {
  return sellerSaleFee({ sellerId: quote.gate.ownerId, amountCents: quote.totalCents, channel: buyer.channel });
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
    case "stripe": {
      const fee = await sellerFee(quote, buyer);
      if (!fee) return { ok: false, reason: "failed" };
      return placeStripeOrder(quote, buyer, attemptId, fee);
    }
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

  const fee = await sellerFee(quote, buyer);
  if (!fee) return { ok: false, reason: "failed" };

  const checkoutSessionId = `${TEST_SESSION_PREFIX}${attemptId.replace(/-/g, "")}`;
  const result = await recordPaidOrder({
    checkoutSessionId,
    productId: quote.productId,
    sellerId: quote.gate.ownerId,
    storefrontId: quote.gate.storefront.id,
    channel: buyer.channel,
    quantity: quote.quantity,
    selection: quote.selection,
    unitPriceCents: quote.regularUnitCents,
    discountId: quote.discount?.id ?? null,
    credit: quote.credit,
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
  if (!result.ok) return { ok: false, reason: result.reason === "sold_out" ? "sold_out" : "failed" };
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
