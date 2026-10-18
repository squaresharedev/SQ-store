// SERVER ONLY. The Stripe payment provider: what "Pay" does once a seller has
// connected their own Stripe account.
//
// A DIRECT CHARGE ON THE SELLER'S ACCOUNT. The Checkout Session is created ON
// the connected account (the Stripe-Account header), so the seller is the
// merchant of record: their name on the buyer's statement, their liability for
// tax and chargebacks. Our cut is `application_fee_amount`: the fee the
// server worked out for this sale (lib/billing/sale-fee.ts), on everything the
// buyer pays. The session's metadata carries the origin, plan and rate it was
// worked out from, so a charge in Stripe's dashboard explains itself.
//
// STRIPE HOSTS THE PAYMENT PAGE. The buyer has already given our checkout
// everything an order needs (who, where to, which version, the gift note); the
// only thing left is the card, and that is entered on Stripe's own page. So
// this app never sees a card number, needs no Stripe script on its pages, and
// the order route's answer is simply a different place to send the browser.
//
// THE ORDER EXISTS BEFORE THE PAYMENT (lib/orders/record.ts
// reservePendingOrder): written as `pending`, holding its stock, keyed on a
// checkout id of OUR making that Stripe carries back as client_reference_id.
// That is what the webhook confirms (lib/payments/connect/webhook.ts), what an
// expired session releases, and why a product edited or deleted while the
// buyer is typing a card number cannot take the sale with it.
//
// WHAT STRIPE IS TOLD is the QUOTE's figures and nothing a browser sent: the
// total, split into the items and delivery, in the quote's currency.

import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/app-url";
import {
  StripeApiError,
  stripeRequest,
  type StripeCheckoutSession,
} from "@/lib/billing/stripe-api";
import { CHECKOUT_CANCEL_API_PATH, CHECKOUT_CANCEL_PARAM } from "@/lib/checkout/paths";
import { canTakePayments, readPaymentAccount } from "@/lib/payments/connect/account";
import { stripeConnectLive } from "@/lib/payments/connect/config";
import { orderLinkUrl } from "@/lib/orders/order-link";
import { releasePendingOrder, reservePendingOrder } from "@/lib/orders/record";
import { originForChannel } from "@/lib/billing/origin";
import { PLACED_QUERY_PARAM } from "@/lib/storefront/product-page-url";
import { recordFunnelPoint } from "@/lib/analytics/funnel/record";
import { translatorFor } from "@/i18n/translator";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "@/i18n/locales";
import type { SaleFee } from "@/lib/billing/fees";
import type { CheckoutBuyer, PlaceResult } from "@/lib/checkout/provider";
import type { CheckoutQuote } from "@/lib/checkout/quote";

/** The prefix of the checkout ids this provider mints for orders.checkout_session_id.
 *  Its own, so one is never mistaken for Stripe's (`cs_test_`, `cs_live_`) or
 *  the test provider's (`cs_sstest_`). */
const SESSION_PREFIX = "cs_ss_";

/** How long Stripe keeps the payment page open: its own minimum (30 minutes)
 *  plus a little. Shorter than PENDING_ORDER_MINUTES, so the page is always
 *  closed before the stock behind it is given back. */
const SESSION_MINUTES = 31;

/** The checkout id for one attempt. Deterministic, so pressing Pay twice asks
 *  for the same order and (through Stripe's idempotency key) the same page. */
export function stripeCheckoutId(attemptId: string): string {
  return `${SESSION_PREFIX}${attemptId.replace(/-/g, "")}`;
}

/** Stripe's hosted pages speak these; `pt` is its European Portuguese. */
function stripeLocale(locale: Locale): string {
  return locale === "pt-PT" ? "pt" : locale;
}

export async function placeStripeOrder(
  quote: CheckoutQuote,
  buyer: CheckoutBuyer,
  attemptId: string,
  fee: SaleFee,
): Promise<PlaceResult> {
  // Re-checked here, not only when the page decided to offer checkout: this is
  // the line that asks a payment provider for money.
  if (!stripeConnectLive()) return { ok: false, reason: "unavailable" };
  const account = await readPaymentAccount(quote.gate.ownerId);
  if (!canTakePayments(account)) return { ok: false, reason: "unavailable" };

  const checkoutSessionId = stripeCheckoutId(attemptId);
  const reserved = await reservePendingOrder({
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
  if (!reserved.ok) return { ok: false, reason: reserved.reason === "sold_out" ? "sold_out" : "failed" };

  const admin = createAdminClient();
  if (reserved.duplicate) {
    // A REPEAT of an attempt is answered only for the same buyer buying the
    // same thing, and only while it is still unpaid (the same rule, and the
    // same reason, as the test provider's).
    const { data: existing } = await admin
      .from("orders")
      .select("buyer_email, product_id, status")
      .eq("id", reserved.orderId)
      .maybeSingle();
    const same =
      existing?.status === "pending" &&
      existing.product_id === quote.productId &&
      existing.buyer_email?.toLowerCase() === buyer.email.toLowerCase();
    if (!same) return { ok: false, reason: "failed" };
  }

  try {
    const orderUrl = await orderLinkUrl(quote.gate.storefront.id, reserved.orderId);
    if (!orderUrl) throw new Error("no order link could be built");
    const locale = parseLocale(buyer.locale) ?? DEFAULT_LOCALE;
    const t = await translatorFor(locale);
    const currency = quote.currency.toLowerCase();
    // The fee snapshot, for whoever reads the charge in Stripe. Never read
    // back: the order row is the record, and a connected seller can write
    // anything into their own account's metadata.
    const metadata = {
      order_id: reserved.orderId,
      // What the sale is of, for the funnel count of a payment page that
      // closes after its order has already been released (the webhook then
      // has no order to read them from). Counted under the account the event
      // came from, so a seller rewriting these changes only their own count.
      storefront_id: quote.gate.storefront.id,
      product_id: quote.productId,
      origin: originForChannel(buyer.channel),
      plan_id: fee.sellerPlan,
      platform_fee_bps: String(fee.platformFeeBps),
    };
    const session = await stripeRequest<StripeCheckoutSession>(
      "POST",
      "/checkout/sessions",
      {
        mode: "payment",
        client_reference_id: checkoutSessionId,
        customer_email: buyer.email,
        locale: stripeLocale(locale),
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              // What the items cost after every discount. One line for all of
              // them: a per-item price would not always divide evenly.
              unit_amount: quote.itemsCents,
              product_data: { name: quote.quantity > 1 ? `${quote.quantity} × ${quote.title}` : quote.title },
            },
          },
          ...(quote.shippingCents && quote.shippingCents > 0
            ? [
                {
                  quantity: 1,
                  price_data: {
                    currency,
                    unit_amount: quote.shippingCents,
                    product_data: { name: t("ProductPage.checkout.summary.delivery") },
                  },
                },
              ]
            : []),
        ],
        payment_intent_data: {
          // Left out when nothing is owed (a waived seller, fees switched
          // off): Stripe then creates no fee object at all.
          ...(fee.applicationFeeCents > 0 ? { application_fee_amount: fee.applicationFeeCents } : {}),
          metadata,
        },
        metadata,
        success_url: `${orderUrl}?${PLACED_QUERY_PARAM}=1`,
        cancel_url: appUrl(`${CHECKOUT_CANCEL_API_PATH}?${CHECKOUT_CANCEL_PARAM}=${checkoutSessionId}`),
        expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60,
      },
      { account: account.stripeAccountId, idempotencyKey: `checkout_${checkoutSessionId}` },
    );
    if (!session.url) throw new Error("Stripe returned a session with no page to send the buyer to");

    // Stripe's own id for the page, kept while the order waits: it is what a
    // cancelled checkout closes (api/checkout/cancel). The payment's id
    // replaces it once the order is paid.
    await admin
      .from("orders")
      .update({ payment_ref: session.id })
      .eq("id", reserved.orderId)
      .eq("status", "pending");

    // A payment page now exists for this order: the funnel's
    // "checkout started". Once per attempt (a second press of Pay is handed
    // the same page), and it cannot fail the checkout.
    if (!reserved.duplicate) {
      await recordFunnelPoint({
        sellerId: quote.gate.ownerId,
        storeId: quote.gate.storefront.id,
        productId: quote.productId,
        event: "checkout_started",
      });
    }

    return { ok: true, orderId: reserved.orderId, redirectUrl: session.url };
  } catch (error) {
    const detail = error instanceof StripeApiError ? `${error.type ?? "error"} ${error.code ?? ""}`.trim() : String(error);
    console.error("[checkout] Stripe session could not be created:", detail);
    // Nothing was charged and nothing can be: give the units back now rather
    // than hold them until the sweep. Only what THIS call reserved.
    if (!reserved.duplicate) await releasePendingOrder(checkoutSessionId);
    return { ok: false, reason: "failed" };
  }
}
