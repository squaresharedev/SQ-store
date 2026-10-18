// SERVER ONLY. WHAT ONE SALE OWES SQUARE SHARE, decided from the database at
// the moment the checkout is created.
//
// Everything that sets the fee is read here, by the server: the seller's plan
// (seller_billing), the plan price row in force (plan_prices), whether the
// seller's fee is waived (seller_fee_waivers), whether fees are switched on at
// all (billing_switches), and the sale's origin (from its channel). Nothing a
// browser sent is a fee, a plan or a rate. The arithmetic is the pricing
// contract's computeFees, the same function the tests hold to the worked
// examples.
//
// NULL MEANS REFUSE THE SALE. A plan, a price row or a waiver that cannot be
// read is answered with null, and the checkout then declines rather than
// charge a guessed rate: the fee is part of the seller's contract, and a
// buyer retrying a moment later loses nothing.

import { createAdminClient } from "@/lib/supabase/admin";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { readPlanPrices } from "@/lib/billing/catalog";
import { noSaleFee, saleFee, type SaleFee } from "@/lib/billing/fees";
import { originForChannel } from "@/lib/billing/origin";
import { readBillingSwitches } from "@/lib/billing/switches";
import type { OrderChannel } from "@/types/order-view";

/**
 * Whether this seller's per-sale fee is waived (the closed beta, founding
 * sellers). Null when it could not be read: the caller must not charge a
 * seller whose waiver it could not check.
 */
export async function readFeeWaiver(sellerId: string): Promise<boolean | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("seller_fee_waivers")
      .select("owner_id")
      .eq("owner_id", sellerId)
      .maybeSingle();
    if (error) {
      console.error("[billing] reading the fee waiver failed:", error.message);
      return null;
    }
    return data !== null;
  } catch (error) {
    console.error("[billing] reading the fee waiver threw:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * The fee on a sale of `amountCents` (what the buyer pays, delivery included)
 * to `sellerId`, arriving through `channel`. `sellerId` must be the seller
 * behind the product gate, never an id from the request.
 *
 * While fees are switched off, and for a waived seller, the answer is a fee
 * of nothing with the plan still snapshotted: the order then says truthfully
 * that it was charged 0.
 */
export async function sellerSaleFee(sale: {
  sellerId: string;
  amountCents: number;
  channel: OrderChannel;
}): Promise<SaleFee | null> {
  const billing = await readAccountBilling(sale.sellerId);
  if (!billing.ok) return null;
  const { plan } = billing.billing;

  const switches = await readBillingSwitches();
  if (!switches.feesEnabled) return noSaleFee(plan);

  const [waived, prices] = await Promise.all([readFeeWaiver(sale.sellerId), readPlanPrices()]);
  if (waived === null || prices === null) return null;

  const fee = saleFee(prices, plan, sale.amountCents, {
    origin: originForChannel(sale.channel),
    feeWaiver: waived,
  });
  // Rare by design: the cap only bites when the rates themselves are wrong.
  if (fee.feeCapped) {
    console.warn(
      `[billing] application fee capped: seller ${sale.sellerId} plan ${plan} amount ${sale.amountCents} charged ${fee.applicationFeeCents}`,
    );
  }
  return fee;
}
