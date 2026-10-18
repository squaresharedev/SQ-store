// THE FEE: what one sale owes Square Share. One pure function, called by every
// surface that prices a sale, so the checkout, the order row and the ledger
// can never disagree about a cent.
//
// MONEY IS INTEGER CENTS, RATES ARE INTEGER BASIS POINTS (100 bps = 1%). No
// float touches an amount: every division rounds half up to the cent, the
// same on every runtime.
//
// THE RULES
//   1. platform fee = amount x fee bps / 10 000, rounded half up. The rate is
//      the plan's direct fee, or its marketplace fee when the marketplace
//      brought the buyer.
//   2. ad fee = amount x ad rate / 10 000, the same rounding, and only on a
//      marketplace sale a promotion drove. A direct sale never pays one.
//   3. application fee = platform fee + ad fee, capped at
//      APPLICATION_FEE_CAP_BPS of the amount. When the cap bites, the ad fee
//      gives way first, so the two parts always add up to what is charged.
//   4. The base is the whole amount the buyer pays, delivery included.
//   5. A waived seller pays nothing at all.

import { z } from "zod";
import { isDirectOrigin, saleOriginSchema } from "./enums.ts";

/** Basis points in a whole: 10 000 bps = 100%. */
export const BPS_WHOLE = 10_000;

/** The most of a sale the application fee may ever take: a safety rail, so no
 *  combination of rates can charge a seller more than this. 3 000 = 30%. */
export const APPLICATION_FEE_CAP_BPS = 3_000;

/** The largest amount whose fee is still exact in a double. Far above any
 *  order: orders.amount_cents is a 32-bit integer. */
const AMOUNT_MAX_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / BPS_WHOLE);

/**
 * `amountCents` x `bps` / 10 000, rounded half up to the cent.
 *
 * Forgiving on purpose (a negative or fractional input is clamped, a rate is
 * held between 0 and a whole): the plans page calculator feeds it whatever a
 * slider says. computeFees below is the strict door a real sale goes through.
 */
export function feeCents(amountCents: number, bps: number): number {
  const base = Math.min(AMOUNT_MAX_CENTS, Math.max(0, Math.trunc(amountCents)));
  const rate = Math.min(BPS_WHOLE, Math.max(0, Math.trunc(bps)));
  return Math.floor((base * rate + BPS_WHOLE / 2) / BPS_WHOLE);
}

const bpsSchema = z.number().int().min(0).max(BPS_WHOLE);

export const computeFeesInputSchema = z.strictObject({
  /** What the buyer pays, delivery included. Never zero: a sale of nothing
   *  has no fee to work out, and the caller must not ask. */
  amountCents: z.number().int().positive().max(AMOUNT_MAX_CENTS),
  /** The seller's active plan price row; only its two rates are read. */
  planPrice: z.object({ directFeeBps: bpsSchema, marketplaceFeeBps: bpsSchema }),
  origin: saleOriginSchema,
  /** The promotion that drove the sale, or null. */
  promotion: z.object({ adRateBps: z.number().int().min(1).max(BPS_WHOLE) }).nullable(),
  feeWaiver: z.boolean(),
});
export type ComputeFeesInput = z.input<typeof computeFeesInputSchema>;

/** What a sale owes, part by part. The two parts always sum to the whole. */
export type FeeBreakdown = {
  /** The rate that produced platformFeeCents; 0 for a waived seller. */
  platformFeeBps: number;
  platformFeeCents: number;
  /** The promotion's rate, or null when no ad fee applies. */
  adRateBps: number | null;
  adFeeCents: number;
  /** What to charge: Stripe's application_fee_amount. */
  applicationFeeCents: number;
  /** The cap cut the fee down. Worth a log line every time. */
  capped: boolean;
};

/**
 * Every fee on one sale. Throws a ZodError on input that is not a sale: a
 * zero or fractional amount, a rate out of range, an origin nobody defined.
 */
export function computeFees(input: ComputeFeesInput): FeeBreakdown {
  const { amountCents, planPrice, origin, promotion, feeWaiver } = computeFeesInputSchema.parse(input);
  if (feeWaiver) {
    return {
      platformFeeBps: 0,
      platformFeeCents: 0,
      adRateBps: null,
      adFeeCents: 0,
      applicationFeeCents: 0,
      capped: false,
    };
  }

  const direct = isDirectOrigin(origin);
  const platformFeeBps = direct ? planPrice.directFeeBps : planPrice.marketplaceFeeBps;
  const adRateBps = direct ? null : (promotion?.adRateBps ?? null);
  const platformFee = feeCents(amountCents, platformFeeBps);
  const adFee = adRateBps === null ? 0 : feeCents(amountCents, adRateBps);

  // Rounded DOWN, unlike the fees: a cap that rounds up is not a cap.
  const cap = Math.floor((amountCents * APPLICATION_FEE_CAP_BPS) / BPS_WHOLE);
  const applicationFeeCents = Math.min(platformFee + adFee, cap);
  const platformFeeCents = Math.min(platformFee, applicationFeeCents);
  return {
    platformFeeBps,
    platformFeeCents,
    adRateBps,
    adFeeCents: applicationFeeCents - platformFeeCents,
    applicationFeeCents,
    capped: applicationFeeCents < platformFee + adFee,
  };
}

/** `value` x `part` / `whole`, rounded half up, exact for any 32-bit cents. */
function share(value: number, part: number, whole: number): number {
  const two = BigInt(2);
  return Number((BigInt(value) * BigInt(part) * two + BigInt(whole)) / (two * BigInt(whole)));
}

const cents = (value: number) => Math.max(0, Math.trunc(value));

/**
 * The part of a fee that goes back when `refundedCents` of an `amountCents`
 * payment is refunded: the same share of the fee as of the payment. A full
 * refund returns all of it; nothing refunded returns nothing.
 */
export function refundedFeeCents(feeTotalCents: number, amountCents: number, refundedCents: number): number {
  const fee = cents(feeTotalCents);
  const amount = cents(amountCents);
  const refunded = Math.min(amount, cents(refundedCents));
  if (fee === 0 || amount === 0 || refunded === 0) return 0;
  return refunded === amount ? fee : share(fee, refunded, amount);
}

/**
 * One application fee refund, split between the platform fee and the ad fee
 * in the proportion the order was charged them. The parts always sum to
 * `refundCents` (held to what was charged in the first place).
 */
export function splitFeeRefund(
  refundCents: number,
  charged: { platformFeeCents: number; adFeeCents: number },
): { platformFeeCents: number; adFeeCents: number } {
  const platform = cents(charged.platformFeeCents);
  const ad = cents(charged.adFeeCents);
  const total = platform + ad;
  const refund = Math.min(total, cents(refundCents));
  if (refund === 0) return { platformFeeCents: 0, adFeeCents: 0 };
  const adPart = ad === 0 ? 0 : Math.min(ad, share(refund, ad, total));
  return { platformFeeCents: refund - adPart, adFeeCents: adPart };
}
