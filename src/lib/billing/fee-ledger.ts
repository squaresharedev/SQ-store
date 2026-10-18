// SERVER ONLY. THE FEE LEDGER: what Square Share actually collected on a sale
// and what it gave back, one row each (fee_ledger, 20261011_pricing_config).
//
// An order's own columns say what the sale was CHARGED. This says what
// happened to the money, refund by refund, and it is what revenue is counted
// from. Insert-only: a correction is another row.
//
// EVERY WRITE IS IDEMPOTENT on its entry key (fee_ledger_record), so a payment
// event delivered twice, or a refund pressed twice, writes its rows once:
//
//   <order id>:platform_fee            the fee the order was charged
//   <order id>:ad_fee
//   <refund id>:platform_fee_refund    one return of (part of) that fee
//   <refund id>:ad_fee_refund
//
// WHO WRITES
//   - the order writer, for a sale no provider charged (the development test
//     provider, the simulator): recordOrderFees straight away;
//   - the Connect webhook, once Stripe confirms the payment and again for each
//     application fee refund (lib/payments/connect/fees.ts), with Stripe's own
//     fee object as the source;
//   - the refund action, for an order no provider charged: reverseOrderFees.

import { createAdminClient } from "@/lib/supabase/admin";
import { splitFeeRefund, type FeeEntryKind } from "@/lib/pricing";

type Admin = ReturnType<typeof createAdminClient>;

/** Where a ledger row's money was collected, when a provider collected it. */
export type FeeSource = {
  /** Stripe's application fee object (`fee_...`). */
  applicationFeeId: string;
  livemode: boolean;
};

async function record(
  admin: Admin,
  orderId: string,
  kind: FeeEntryKind,
  amountCents: number,
  entryKey: string,
  source: FeeSource | null,
): Promise<void> {
  if (amountCents === 0) return;
  const { error } = await admin.rpc("fee_ledger_record", {
    p_order_id: orderId,
    p_kind: kind,
    p_amount_cents: amountCents,
    p_entry_key: entryKey,
    p_stripe_application_fee_id: source?.applicationFeeId ?? null,
    p_livemode: source?.livemode ?? false,
  });
  if (error) throw new Error(`writing the ${kind} ledger row failed: ${error.message}`);
}

/** What an order was charged, as its own columns hold it. */
async function chargedFees(admin: Admin, orderId: string): Promise<{ platformFeeCents: number; adFeeCents: number }> {
  const { data, error } = await admin
    .from("orders")
    .select("platform_fee_cents, ad_fee_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`reading the order's fees failed: ${error.message}`);
  if (!data) throw new Error("no such order to record fees for");
  return { platformFeeCents: Number(data.platform_fee_cents ?? 0), adFeeCents: Number(data.ad_fee_cents ?? 0) };
}

/**
 * Write the fees an order was charged: one row for the platform fee, one for
 * the ad fee, none for a part that is zero. Throws on a database error (the
 * webhook turns that into "deliver again"); safe to call any number of times.
 */
export async function recordOrderFees(orderId: string, source: FeeSource | null = null): Promise<void> {
  const admin = createAdminClient();
  const charged = await chargedFees(admin, orderId);
  await record(admin, orderId, "platform_fee", charged.platformFeeCents, `${orderId}:platform_fee`, source);
  await record(admin, orderId, "ad_fee", charged.adFeeCents, `${orderId}:ad_fee`, source);
}

/**
 * Write one return of an order's fee: `refundCents` split between the
 * platform fee and the ad fee in the proportion the order was charged them.
 * `refundKey` names the refund (Stripe's `fr_...` id), so each is written once.
 */
export async function recordFeeRefund(
  orderId: string,
  refundKey: string,
  refundCents: number,
  source: FeeSource | null,
): Promise<void> {
  const admin = createAdminClient();
  const parts = splitFeeRefund(refundCents, await chargedFees(admin, orderId));
  await record(admin, orderId, "platform_fee_refund", -parts.platformFeeCents, `${refundKey}:platform_fee_refund`, source);
  await record(admin, orderId, "ad_fee_refund", -parts.adFeeCents, `${refundKey}:ad_fee_refund`, source);
}

/**
 * Give back everything the ledger holds for an order no provider charged: the
 * refund of a test or simulated sale. Reads what was WRITTEN, not what the
 * order says, so an order from before the ledger (which has no rows) reverses
 * nothing rather than going negative. Best-effort and never throws: the
 * refund itself is already recorded.
 */
export async function reverseOrderFees(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("fee_ledger")
      .select("kind, amount_cents")
      .eq("order_id", orderId)
      .gt("amount_cents", 0);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const kind: FeeEntryKind = row.kind === "ad_fee" ? "ad_fee_refund" : "platform_fee_refund";
      await record(admin, orderId, kind, -row.amount_cents, `${orderId}:${kind}`, null);
    }
  } catch (error) {
    console.error("[billing] reversing an order's fees failed:", error instanceof Error ? error.message : error);
  }
}

/** What a store paid in fees over a period, in one currency. */
export type FeeSummary = {
  currency: string;
  chargedCents: number;
  refundedCents: number;
  /** chargedCents - refundedCents: what the store actually paid. */
  netCents: number;
};

/** The first instant of the UTC month `now` falls in, and of the next one. */
export function monthWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

/**
 * The fees `sellerId` paid in the month of `now`, per currency (usually one).
 * Null when unreadable. `sellerId` must be an account the caller has already
 * been authorised on: this reads with the service role.
 */
export async function readFeesThisMonth(sellerId: string, now: Date = new Date()): Promise<FeeSummary[] | null> {
  try {
    const { from, to } = monthWindow(now);
    const { data, error } = await createAdminClient().rpc("fee_ledger_summary", {
      p_seller_id: sellerId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) {
      console.error("[billing] reading the month's fees failed:", error.message);
      return null;
    }
    return (data ?? []).map((row) => ({
      currency: row.currency,
      chargedCents: Number(row.charged_cents),
      refundedCents: Number(row.refunded_cents),
      netCents: Number(row.net_cents),
    }));
  } catch (error) {
    console.error("[billing] reading the month's fees threw:", error instanceof Error ? error.message : error);
    return null;
  }
}
