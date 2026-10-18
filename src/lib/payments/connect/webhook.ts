// SERVER ONLY. What a verified Stripe CONNECT event does: a payment, an
// expiry, a refund or a dispute on a seller's own Stripe account. The route
// (app/api/payments/webhook/route.ts) verifies the signature and hands the
// parsed event here.
//
// THE CONTRACT
//   1. Only CONNECT events (`account` set). A platform event is Billing's
//      (lib/billing/webhook.ts), which ignores these for the same reason.
//   2. Only events of this key's mode.
//   3. THE SELLER COMES FROM THE CONNECTED ACCOUNT, through
//      seller_payment_accounts, a table only this server writes. Never from
//      the event's metadata or client_reference_id alone: a seller's own
//      Stripe account can create a session that says anything, including
//      another seller's order. So an event may only ever touch an order whose
//      seller owns the account it came from.
//   4. Idempotent. An event id is recorded in stripe_events and marked
//      processed only AFTER its effect is applied; a failure answers 500 and
//      Stripe delivers it again. Every effect is itself idempotent
//      (order_confirm_paid, order_release_pending, order_apply_refund), so a
//      replay changes nothing.
//   5. Money with no order is never swallowed. A paid checkout that matches
//      nothing is answered 200 (delivering it again cannot conjure an order)
//      and raised with alertOps, because nobody else will ever report it.
//   6. OUR CUT IS READ BACK FROM STRIPE, not assumed. A confirmed payment's
//      application fee object, and every later return of it, is what the
//      order's fee columns and the fee ledger record
//      (lib/payments/connect/fees.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import { recordFunnelPoint } from "@/lib/analytics/funnel/record";
import { createNotification } from "@/lib/notifications/create";
import { alertOps } from "@/lib/ops/alert";
import { stripeKeyIsLive, type StripeAccount } from "@/lib/billing/stripe-api";
import type { StripeEvent, WebhookOutcome } from "@/lib/billing/webhook";
import { applyAccountFacts, readPaymentAccountByStripeId } from "@/lib/payments/connect/account";
import { recordChargeFeeRefunds, settleOrderFees } from "@/lib/payments/connect/fees";
import { confirmPendingOrder, releasePendingOrder } from "@/lib/orders/record";
import { orderDetailPath } from "@/lib/orders/paths";

/** The event types acted on. Everything else is acknowledged and ignored.
 *  Subscribe the Connect endpoint to exactly these. */
export const CONNECT_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.expired",
  "account.updated",
  "charge.refunded",
  "charge.dispute.created",
] as const;

type Admin = ReturnType<typeof createAdminClient>;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A paid or abandoned checkout names our order by client_reference_id. The
 *  order is only ever this seller's: see THE CONTRACT, point 3. */
async function orderForCheckout(admin: Admin, checkoutSessionId: string, sellerId: string) {
  const { data, error } = await admin
    .from("orders")
    .select("id, seller_id, status")
    .eq("checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (error) throw new Error(`reading the order failed: ${error.message}`);
  if (!data) return { order: null, foreign: false };
  return data.seller_id === sellerId ? { order: data, foreign: false } : { order: null, foreign: true };
}

/** A refund or dispute names the PAYMENT (orders.payment_ref). */
async function orderForPayment(admin: Admin, paymentRef: string, sellerId: string) {
  const { data, error } = await admin
    .from("orders")
    .select("id, status, product_title")
    .eq("payment_ref", paymentRef)
    .eq("seller_id", sellerId)
    .maybeSingle();
  if (error) throw new Error(`reading the order failed: ${error.message}`);
  return data;
}

/**
 * A payment page closed unpaid: the funnel's "checkout expired".
 *
 * What it was a checkout OF comes from the waiting order, read before it is
 * released. A buyer who backed out has had theirs released already
 * (api/checkout/cancel), and then it comes from what the session was created
 * with. Either way it is filed under the seller whose account sent the event,
 * never one the event names. Cannot fail the event: recordFunnelPoint
 * swallows everything, and a point it cannot make sense of is not written.
 */
async function countExpiredCheckout(admin: Admin, sellerId: string, checkoutSessionId: string, metadata: unknown) {
  const { data: order } = await admin
    .from("orders")
    .select("storefront_id, product_id")
    .eq("checkout_session_id", checkoutSessionId)
    .eq("seller_id", sellerId)
    .maybeSingle();
  const named = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
  await recordFunnelPoint({
    sellerId,
    storeId: order?.storefront_id ?? text(named.storefront_id) ?? "",
    productId: order?.product_id ?? text(named.product_id) ?? "",
    event: "checkout_expired",
  });
}

/** Handle one verified event. Never throws. */
export async function handleConnectEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const stripeAccountId = text(event.account);
  if (!stripeAccountId) return { status: 200, note: "platform event, not a sale" };
  if (event.livemode !== stripeKeyIsLive()) return { status: 200, note: "other mode" };
  if (!(CONNECT_EVENT_TYPES as readonly string[]).includes(event.type)) return { status: 200, note: "ignored type" };

  try {
    const admin = createAdminClient();

    await admin
      .from("stripe_events")
      .upsert({ id: event.id, type: event.type, livemode: event.livemode }, { onConflict: "id", ignoreDuplicates: true });
    const { data: seen, error: seenError } = await admin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", event.id)
      .single();
    if (seenError) throw new Error(`reading the event ledger failed: ${seenError.message}`);
    if (seen.processed_at) return { status: 200, note: "already processed" };

    const account = await readPaymentAccountByStripeId(stripeAccountId);
    // An account this app never created: nothing of ours to change.
    const note = account ? await apply(admin, event, account.ownerId, stripeAccountId) : "not one of our accounts";

    const { error: doneError } = await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (doneError) throw new Error(`closing the event failed: ${doneError.message}`);
    return { status: 200, note };
  } catch (error) {
    console.error("[payments] connect event failed:", event.type, error instanceof Error ? error.message : error);
    return { status: 500, note: "failed, deliver again" };
  }
}

/** What one event does, for a seller we know. Throws to be delivered again. */
async function apply(admin: Admin, event: StripeEvent, sellerId: string, stripeAccountId: string): Promise<string> {
  const object = event.data.object;

  switch (event.type) {
    case "account.updated": {
      // Only ever about the account it came from.
      if (text(object.id) !== stripeAccountId) return "account mismatch";
      await applyAccountFacts({
        id: stripeAccountId,
        charges_enabled: object.charges_enabled === true,
        payouts_enabled: object.payouts_enabled === true,
        details_submitted: object.details_submitted === true,
      } satisfies StripeAccount);
      return "account updated";
    }

    case "checkout.session.completed": {
      // A session can complete before the money has (delayed methods). Only
      // cards are offered, but the claim is checked rather than assumed.
      if (object.payment_status !== "paid") return "completed, not paid yet";
      const checkoutSessionId = text(object.client_reference_id);
      const { order, foreign } = checkoutSessionId
        ? await orderForCheckout(admin, checkoutSessionId, sellerId)
        : { order: null, foreign: false };
      if (!checkoutSessionId || !order) {
        await alertOps(foreign ? "A payment named another store's order" : "A payment arrived with no order", {
          event: event.id,
          account: stripeAccountId,
          checkout: checkoutSessionId,
          payment: text(object.payment_intent),
        });
        return foreign ? "foreign order" : "no order";
      }
      const confirmed = await confirmPendingOrder(checkoutSessionId, text(object.payment_intent));
      if (!confirmed.ok) throw new Error("confirming the order failed");
      // After the order is paid, never instead of it: a fee that cannot be
      // read yet fails this delivery, and the next one finds the order
      // already confirmed and only has the fee left to settle.
      await settleOrderFees(admin, order.id, stripeAccountId, text(object.payment_intent));
      return "order paid";
    }

    case "checkout.session.expired": {
      const checkoutSessionId = text(object.client_reference_id);
      if (!checkoutSessionId) return "no reference";
      const { order, foreign } = await orderForCheckout(admin, checkoutSessionId, sellerId);
      // Counted once per event (the ledger above), whether or not an order is
      // still waiting. Never for a session that names another store's order.
      if (!foreign) await countExpiredCheckout(admin, sellerId, checkoutSessionId, object.metadata);
      if (!order) return "nothing waiting";
      await releasePendingOrder(checkoutSessionId);
      return "released";
    }

    case "charge.refunded": {
      const paymentRef = text(object.payment_intent);
      if (!paymentRef) return "no payment";
      const order = await orderForPayment(admin, paymentRef, sellerId);
      if (!order) return "no order";
      // Our fee went back with the money, in the same proportion, whoever
      // made the refund and whether it was the whole payment or part of it.
      // Every return of it is written once.
      const feeId = text(object.application_fee);
      if (feeId) await recordChargeFeeRefunds(order.id, feeId);
      // The ORDER only changes on a full refund. One made from the order panel
      // has already been recorded, and this then changes nothing; a partial
      // one (only possible in Stripe's own dashboard) leaves the order paid.
      if (object.refunded !== true) return "partial refund";
      const { error } = await admin.rpc("order_apply_refund", {
        p_order_id: order.id,
        p_reason: "other",
        p_restock: false,
      });
      if (error) throw new Error(`recording the refund failed: ${error.message}`);
      return "refund recorded";
    }

    case "charge.dispute.created": {
      const paymentRef = text(object.payment_intent);
      if (!paymentRef) return "no payment";
      const order = await orderForPayment(admin, paymentRef, sellerId);
      if (!order) return "no order";
      const { data: changed, error } = await admin
        .from("orders")
        .update({ status: "disputed" })
        .eq("id", order.id)
        .eq("status", "paid")
        .select("id");
      if (error) throw new Error(`marking the dispute failed: ${error.message}`);
      // Told once: only the delivery that actually changed the order says so.
      if (changed && changed.length > 0) {
        await createNotification({
          userId: sellerId,
          type: "payment",
          message: {
            title: { key: "Notifications.messages.payment.dispute.title", values: { title: order.product_title } },
            body: { key: "Notifications.messages.payment.dispute.body" },
          },
          data: { href: orderDetailPath(order.id) },
        });
      }
      return "disputed";
    }

    default:
      return "ignored type";
  }
}
