// SERVER ONLY. A quote and a buyer, as the order writer (lib/orders/record.ts)
// takes them. ONE mapping for every payment provider, so an order looks the
// same however it was paid.

import { paidLines, type CheckoutQuote } from "@/lib/checkout/quote";
import { linesDigest } from "@/lib/checkout/lines-digest";
import type { SaleFee } from "@/lib/billing/fees";
import type { PaidCheckout } from "@/lib/orders/record";
import type { CheckoutBuyer } from "@/lib/checkout/provider";

export async function paidCheckoutFor(
  quote: CheckoutQuote,
  buyer: CheckoutBuyer,
  checkoutSessionId: string,
  fee: SaleFee,
): Promise<PaidCheckout> {
  // The order's own row carries the first line; the rest are moreLines.
  const first = quote.lines[0]!;
  return {
    checkoutSessionId,
    productId: first.productId,
    sellerId: quote.store.ownerId,
    storefrontId: quote.store.storefront.id,
    channel: buyer.channel,
    quantity: first.quantity,
    selection: first.selection,
    unitPriceCents: first.regularUnitCents,
    discountId: first.discount?.id ?? null,
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
    moreLines: paidLines(quote),
    linesDigest: await linesDigest(quote.lines),
    cartId: buyer.cartId ?? null,
  };
}

/** Whether an order already written for an attempt is THIS buyer buying THESE
 *  lines (see lib/checkout/lines-digest.ts). */
export function sameAttempt(
  existing: { buyer_email: string | null; lines_digest: string | null } | null,
  checkout: Pick<PaidCheckout, "buyerEmail" | "linesDigest">,
): boolean {
  return (
    existing !== null &&
    existing.lines_digest !== null &&
    existing.lines_digest === checkout.linesDigest &&
    existing.buyer_email?.toLowerCase() === checkout.buyerEmail?.toLowerCase()
  );
}
