// SERVER ONLY. OUR CUT OF A SALE AS STRIPE ACTUALLY COLLECTED IT, written to
// the order and the fee ledger (lib/billing/fee-ledger.ts).
//
// The checkout ASKS Stripe for a fee (application_fee_amount, worked out by
// lib/billing/sale-fee.ts) and snapshots that on the pending order. What ends
// up in Square Share's balance is Stripe's to say: its application fee OBJECT,
// on the platform account. So once a payment is confirmed the fee is read back
// from Stripe, and it is that figure the ledger records. If the two ever
// differ the order is corrected to what Stripe collected and a person is told:
// the books follow the money, never our own arithmetic.
//
// A REFUND returns our fee in the same proportion as the payment
// (`refund_application_fee: true`, wherever the refund was made). Stripe
// reports each return as an application fee refund (`fr_...`), and each
// becomes negative ledger rows, once.
//
// EVERYTHING HERE THROWS on a Stripe or database failure. The webhook turns
// that into "deliver again", and every write is idempotent, so a retry
// finishes whatever a failed delivery left.

import { createAdminClient } from "@/lib/supabase/admin";
import { alertOps } from "@/lib/ops/alert";
import { recordFeeRefund, recordOrderFees, type FeeSource } from "@/lib/billing/fee-ledger";
import {
  stripeRequest,
  type StripeApplicationFee,
  type StripeApplicationFeeRefund,
  type StripeList,
  type StripePaymentIntent,
} from "@/lib/billing/stripe-api";

type Admin = ReturnType<typeof createAdminClient>;

/** A Stripe list page: far more than one charge's fee is ever refunded in. */
const REFUNDS_PAGE = 100;

/** The fee object for one charge, read from the PLATFORM account (no
 *  Stripe-Account header: the fee is ours, not the seller's). */
function readApplicationFee(feeId: string): Promise<StripeApplicationFee> {
  return stripeRequest<StripeApplicationFee>("GET", `/application_fees/${encodeURIComponent(feeId)}`);
}

/**
 * A payment was confirmed: read what Stripe collected for us and record it.
 *
 * `paymentIntentId` is the payment on the seller's connected account. The
 * order's fee columns are corrected first when Stripe's figure differs from
 * the one asked for (the ad fee gives way first, as in the cap), so the
 * ledger rows written from them are Stripe's.
 */
export async function settleOrderFees(
  admin: Admin,
  orderId: string,
  stripeAccountId: string,
  paymentIntentId: string | null,
): Promise<void> {
  if (!paymentIntentId) return;

  const { data: order, error } = await admin
    .from("orders")
    .select("platform_fee_cents, ad_fee_cents, application_fee_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`reading the order's fees failed: ${error.message}`);
  if (!order) return;

  const payment = await stripeRequest<StripePaymentIntent>(
    "GET",
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { expand: ["latest_charge"] },
    { account: stripeAccountId },
  );
  const feeId = payment.latest_charge?.application_fee ?? null;
  const fee = feeId ? await readApplicationFee(feeId) : null;
  const collected = fee?.amount ?? 0;

  const adFee = Number(order.ad_fee_cents ?? 0);
  const asked = order.application_fee_cents ?? Number(order.platform_fee_cents ?? 0) + adFee;
  if (collected !== asked) {
    await alertOps("A sale's fee differs from what was asked for", {
      order: orderId,
      account: stripeAccountId,
      payment: paymentIntentId,
      asked,
      collected,
    });
    const adPart = Math.min(adFee, collected);
    const { error: fixError } = await admin
      .from("orders")
      .update({
        platform_fee_cents: collected - adPart,
        ad_fee_cents: adPart,
        application_fee_cents: collected,
      })
      .eq("id", orderId);
    if (fixError) throw new Error(`correcting the order's fees failed: ${fixError.message}`);
  }

  if (fee) await recordOrderFees(orderId, { applicationFeeId: fee.id, livemode: fee.livemode });
}

/**
 * A charge was refunded (in full or in part): write every return of its
 * application fee that the ledger does not hold yet. Returns how many refunds
 * Stripe reports, for the webhook's note.
 */
export async function recordChargeFeeRefunds(orderId: string, applicationFeeId: string): Promise<number> {
  const fee = await readApplicationFee(applicationFeeId);
  if (fee.amount_refunded <= 0) return 0;
  const source: FeeSource = { applicationFeeId: fee.id, livemode: fee.livemode };

  const refunds = await stripeRequest<StripeList<StripeApplicationFeeRefund>>(
    "GET",
    `/application_fees/${encodeURIComponent(applicationFeeId)}/refunds`,
    { limit: REFUNDS_PAGE },
  );
  for (const refund of refunds.data) {
    await recordFeeRefund(orderId, refund.id, refund.amount, source);
  }
  return refunds.data.length;
}
