import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type { BuyerWithdrawal } from "@/types/checkout";

// WHEN A BUYER MAY WITHDRAW, as the order page offers it (the withdrawal
// function, Consumer Rights Directive art. 11a, in force since 19 June 2026).
// Pure, so the order page, the withdrawal route and the tests all ask the same
// function.
//
// THE PERIOD is 14 days (CRD art. 9), or the seller's own returns window when
// that is longer: a seller who promises 30 days is held to 30. For goods it
// runs from when the buyer RECEIVES them, which this app does not know; it
// knows when the seller marked the parcel shipped. So the function stays open
// for the period PLUS a delivery allowance after that, erring on the buyer's
// side, and while the parcel has not been sent at all it is simply open
// (a buyer may withdraw before delivery too).
//
// NOT OFFERED for a download bought with consent to immediate supply (the
// buyer gave the right up, art. 16(m)), or for an order that is no longer
// simply paid (refunded or disputed: there is nothing left to withdraw from).

/** The statutory withdrawal period, in days (CRD art. 9(1)). */
export const STATUTORY_WITHDRAWAL_DAYS = 14;
/** Added after "shipped" to stand in for "received", which nobody records. */
export const WITHDRAWAL_DELIVERY_ALLOWANCE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

type WithdrawalOrder = {
  status: string;
  fulfilment_status: string;
  shipped_at: string | null;
  created_at: string;
  supply_consent_at: string | null;
  withdrawal_requested_at: string | null;
};

export function buyerWithdrawal(
  order: WithdrawalOrder,
  policy: Pick<SellerShippingPolicy, "returnsWindowDays">,
  now: Date = new Date(),
): BuyerWithdrawal {
  const days = Math.max(STATUTORY_WITHDRAWAL_DAYS, policy.returnsWindowDays ?? 0);
  const closed = { requestedAt: order.withdrawal_requested_at, available: false, until: null, days };
  if (order.status !== "paid") return closed;

  let until: Date | null;
  if (order.fulfilment_status === "not_required") {
    // A download: nothing is delivered later, so the period runs from the
    // purchase, unless the buyer consented to having it straight away.
    if (order.supply_consent_at) return closed;
    until = new Date(new Date(order.created_at).getTime() + days * DAY_MS);
  } else if (order.fulfilment_status === "shipped" && order.shipped_at) {
    until = new Date(
      new Date(order.shipped_at).getTime() + (days + WITHDRAWAL_DELIVERY_ALLOWANCE_DAYS) * DAY_MS,
    );
  } else {
    until = null;
  }

  return {
    requestedAt: order.withdrawal_requested_at,
    available: order.withdrawal_requested_at === null && (until === null || now < until),
    until: until?.toISOString() ?? null,
    days,
  };
}
