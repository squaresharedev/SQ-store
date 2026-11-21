"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  actionError,
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { firstIssue } from "@/lib/validation/messages";
import { carrierSchema, refundReasonSchema, trackingNumberSchema } from "@/lib/validation/orders";
import { getOrderById, getOrderByIdWithEmailFields, isProviderPayment, type OrderEmailFields } from "@/lib/orders/queries";
import { sendRefundEmail, sendShippedEmail } from "@/lib/orders/emails";
import { orderLinkUrl } from "@/lib/orders/order-link";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { StripeApiError, stripeRequest, type StripeRefund } from "@/lib/billing/stripe-api";
import { readPaymentAccount } from "@/lib/payments/connect/account";
import { reverseOrderFees, reverseOrderFeesShare } from "@/lib/billing/fee-ledger";
import { ORDERS_PATH, OVERVIEW_PATH } from "@/lib/dashboard/paths";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { msg } from "@/i18n/types";
import type { CarrierId, OrderView, RefundReason } from "@/types/order-view";

// The seller's TWO writes on an order: it has shipped (or here is its tracking
// number and carrier), and it is being taken back (refunded). Both go the same
// way: session -> role -> budget -> parse -> active-store scope -> a self-gated
// database function, which re-checks all of it on its own
// (20260927_order_fulfilment.sql, 20261008_order_lifecycle.sql), then the
// buyer's email.

export type MarkShippedResult =
  | {
      ok: true;
      /** The order as it now stands, so the open panel can show it at once. */
      order: OrderView;
      /** Whether the buyer was actually emailed. The panel says so only when
       *  it is true: "we told the buyer" must never be a guess. */
      buyerEmailed: boolean;
    }
  | ActionFailure;

/** What public.order_mark_shipped answers. */
type Outcome = "shipped" | "tracking_updated" | "unchanged" | "not_shippable" | "not_found";

const NOT_SHIPPABLE = invalidInput(
  msg("Errors.orders.notShippable.message"),
  msg("Errors.orders.notShippable.fix"),
);

/**
 * Mark an order shipped, optionally with a tracking number and the carrier it
 * belongs to; on an order that has already shipped, set or change them.
 *
 * The buyer is emailed when the order ships, and again when the tracking number
 * or its carrier is added or changed afterwards. Nothing is sent when the
 * number is cleared or re-saved unchanged.
 *
 * `carrier` is an id from CARRIER_IDS or null. It is never a link: the buyer's
 * tracking link is built from it (lib/orders/carriers.ts).
 */
export async function markOrderShipped(
  orderId: string,
  trackingNumber: string,
  carrier: CarrierId | null = null,
): Promise<MarkShippedResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "orders.fulfil")) {
    return failure(permissionDenied(account.role, "fulfilOrders"));
  }
  if (!(await rateLimit("order_fulfil", RATE_LIMITS.orderFulfil))) {
    return failure(rateLimited("fulfilOrders"));
  }

  const id = uuidField().safeParse(orderId);
  if (!id.success) return failure(notFound("order"));
  const tracking = trackingNumberSchema.safeParse(
    typeof trackingNumber === "string" ? trackingNumber : "",
  );
  if (!tracking.success) return failure(invalidInput(firstIssue(tracking.error)));
  const chosenCarrier = carrierSchema.safeParse(carrier ?? null);
  if (!chosenCarrier.success) return failure(invalidInput(firstIssue(chosenCarrier.error)));

  // In THIS store. The database function would also ship an order in any other
  // store the caller may fulfil, and the page only ever acts on the active one,
  // so an order from elsewhere is "not found" here (getOrderById is scoped).
  // Pass the already-resolved account so getOrderById does not call
  // getActiveAccount() (and therefore getUser()) a second and third time.
  if (!(await getOrderById(id.data, account))) return failure(notFound("order"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_mark_shipped", {
    p_order_id: id.data,
    p_tracking_number: tracking.data || null,
    // A carrier says where a number is followed; without one it is nothing.
    p_carrier: tracking.data ? chosenCarrier.data : null,
  });
  if (error) {
    console.error("[orders] order_mark_shipped failed", error.message);
    return failure(serverError("markOrderShipped"));
  }
  const outcome = data as Outcome;
  if (outcome === "not_found") return failure(notFound("order"));
  if (outcome === "not_shippable") return failure(NOT_SHIPPABLE);

  // Combined post-RPC read: order view + email fields in one round-trip.
  // order_mark_shipped only writes fulfilment_status, shipped_at, and
  // tracking_number, so buyer_locale and storefront_id are stable across it.
  const postRpc = await getOrderByIdWithEmailFields(id.data, account);
  if (!postRpc) return failure(notFound("order"));
  const { order, email } = postRpc;

  const tellBuyer =
    outcome === "shipped" ||
    (outcome === "tracking_updated" && order.fulfilment.trackingNumber !== null);
  const buyerEmailed = tellBuyer
    ? await emailBuyer(account, order, email, outcome === "shipped" ? "shipped" : "tracking")
    : false;

  revalidatePath(ORDERS_PATH);
  revalidatePath(OVERVIEW_PATH);
  return { ok: true, order, buyerEmailed };
}

/**
 * The shipping notice, on the seller's behalf. `email` carries the buyer
 * locale and storefront id already read by getOrderByIdWithEmailFields, so
 * this function makes no extra DB round-trip for them.
 *
 * The store name comes from the trading name in getSellerIdentity (a
 * service-role read). Only when that is absent does this call
 * supabase.rpc("team_my_accounts") on the existing session client, skipping
 * the extra getUser() that getAccessibleAccounts() would impose in a Server
 * Action where React cache() is a no-op.
 */
async function emailBuyer(
  account: Awaited<ReturnType<typeof getActiveAccount>> & {},
  order: OrderView,
  email: OrderEmailFields,
  kind: "shipped" | "tracking",
): Promise<boolean> {
  if (!order.buyerEmail) return false;

  const { accountId } = account;
  // The buyer's own order page, where the parcel is followed. Null for an
  // order recorded without a storefront, or where no link key is configured.
  const orderUrl = email.storefrontId ? await orderLinkUrl(email.storefrontId, order.id) : null;
  const identity = await getSellerIdentity(accountId);
  // The trading name buyers see on the product page, else the store handle.
  // Only look up accounts when the trading name is absent, to avoid the extra
  // getUser() call that getAccessibleAccounts() imposes in Server Actions.
  let storeName = identity.businessName ?? "";
  if (!storeName) {
    const supabase = await createClient();
    const { data: accts } = await supabase.rpc("team_my_accounts");
    storeName =
      (accts as { account_owner_id: string; store_name: string }[] | null)?.find(
        (a) => a.account_owner_id === accountId,
      )?.store_name ?? "";
  }

  const result = await sendShippedEmail(
    order.buyerEmail,
    parseLocale(email.buyerLocale) ?? DEFAULT_LOCALE,
    {
      kind,
      productTitle: order.productTitle,
      quantity: order.quantity,
      selection: order.selection,
      more: order.addOns,
      trackingNumber: order.fulfilment.trackingNumber,
      carrier: order.fulfilment.carrier,
      orderUrl,
      shipTo: order.shipTo,
      store: { name: storeName, contactEmail: identity.email ?? null },
    },
  );
  return result.sent;
}

export type RefundOrderResult =
  | {
      ok: true;
      /** The order as it now stands, so the open panel can show it at once. */
      order: OrderView;
      /** Whether the buyer was actually emailed (see MarkShippedResult). */
      buyerEmailed: boolean;
    }
  | ActionFailure;

/** What public.order_refund answers. */
type RefundOutcome = "refunded" | "not_refundable" | "not_found";

const NOT_REFUNDABLE = invalidInput(
  msg("Errors.orders.notRefundable.message"),
  msg("Errors.orders.notRefundable.fix"),
);

/** The payment provider would not give the money back. Its own sentence: the
 *  seller's next move is the provider's dashboard, not "try again". */
const REFUND_REFUSED = actionError(
  "server_error",
  msg("Errors.orders.refundRefused.message"),
  msg("Errors.orders.refundRefused.fix"),
);

/**
 * Take a paid order back: cancelled before it was sent, returned, or refunded
 * for another reason. The order leaves the To ship queue and the sales
 * figures, its code (if it used one) is free again, and the buyer is emailed.
 *
 * `restock` puts the order's units back on the shelf (a parcel that never
 * left, or came back fit to sell). The database function does it at most once.
 *
 * UNTIL A PAYMENT PROVIDER IS CONNECTED THIS RECORDS A REFUND; IT DOES NOT MAKE
 * ONE. The seller pays the buyer back themselves, and the buyer's email says
 * so. Once an order carries a payment reference, the refund is made with the
 * provider FIRST and recorded only when that succeeds.
 */
export async function refundOrder(
  orderId: string,
  reason: RefundReason,
  restock: boolean,
): Promise<RefundOrderResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "orders.refund")) {
    return failure(permissionDenied(account.role, "refundOrders"));
  }
  if (!(await rateLimit("order_refund", RATE_LIMITS.orderRefund))) {
    return failure(rateLimited("refundOrders"));
  }

  const id = uuidField().safeParse(orderId);
  if (!id.success) return failure(notFound("order"));
  const why = refundReasonSchema.safeParse(reason);
  if (!why.success) return failure(NOT_REFUNDABLE);

  // Narrow pre-check: scope (seller_id), status, and payment_ref in one read.
  // This replaces two separate round-trips: the old getOrderById scope check
  // and the payment_ref read inside refundWithProvider.
  // order_apply_refund / order_refund only write status, refunded_at, and
  // refund_reason (20261021_order_refund_provider_first.sql), so payment_ref
  // stays stable across the call and is safe to pass forward.
  const supabase = await createClient();
  const { data: preCheck, error: preErr } = await supabase
    .from("orders")
    .select("id, status, payment_ref")
    .eq("seller_id", account.accountId)
    .eq("id", id.data)
    .maybeSingle();
  if (preErr || !preCheck) return failure(notFound("order"));
  const preRow = preCheck as unknown as { id: string; status: string; payment_ref: string | null };
  if (preRow.status !== "paid") return failure(NOT_REFUNDABLE);
  const paymentRef = preRow.payment_ref;

  const settled = await refundWhatIsLeft(supabase, {
    orderId: id.data,
    reason: why.data,
    restock: restock === true,
    paymentRef,
    accountId: account.accountId,
  });
  if (settled === "refused") return failure(REFUND_REFUSED);
  if (settled === "error") return failure(serverError("refundOrder"));
  if (settled === "not_found") return failure(notFound("order"));
  if (settled === "not_refundable") return failure(NOT_REFUNDABLE);

  // Combined post-RPC read: order view + email fields in one round-trip.
  const postRpc = await getOrderByIdWithEmailFields(id.data, account);
  if (!postRpc) return failure(notFound("order"));
  const { order, email } = postRpc;
  const buyerEmailed = await emailBuyerRefund(account, order, email, paymentRef);

  revalidatePath(ORDERS_PATH);
  revalidatePath(OVERVIEW_PATH);
  return { ok: true, order, buyerEmailed };
}

/**
 * Refund ONE line of an order (a cart's order holds several products, and "one
 * arrived broken" is a refund of that line). `lineId` is the line's
 * order_add_ons id, or null for the order's own first line. The same rules as
 * refundOrder: the store's owner only, rate limited, the money back through
 * the provider FIRST (a partial refund of exactly this line, keyed on it so a
 * retry cannot refund twice) and recorded only when that succeeded. What the
 * line gives back is the database's answer (order_line_refund_amount): its
 * own amount, and everything left (delivery too) when it is the last line
 * standing, so refunding every line gives back everything that was paid.
 */
export async function refundOrderLine(
  orderId: string,
  lineId: string | null,
  reason: RefundReason,
  restock: boolean,
): Promise<RefundOrderResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "orders.refund")) {
    return failure(permissionDenied(account.role, "refundOrders"));
  }
  if (!(await rateLimit("order_refund", RATE_LIMITS.orderRefund))) {
    return failure(rateLimited("refundOrders"));
  }

  const id = uuidField().safeParse(orderId);
  if (!id.success) return failure(notFound("order"));
  const line = lineId === null ? null : uuidField().safeParse(lineId);
  if (line && !line.success) return failure(notFound("order"));
  const lineKey = line ? line.data : null;
  const why = refundReasonSchema.safeParse(reason);
  if (!why.success) return failure(NOT_REFUNDABLE);

  // Scope (this store's order, read through the seller's own session and its
  // two-factor rule), status and how it was paid, in one read.
  const supabase = await createClient();
  const { data: preCheck, error: preErr } = await supabase
    .from("orders")
    .select("id, status, payment_ref, amount_cents")
    .eq("seller_id", account.accountId)
    .eq("id", id.data)
    .maybeSingle();
  if (preErr || !preCheck) return failure(notFound("order"));
  const preRow = preCheck as unknown as { status: string; payment_ref: string | null; amount_cents: number };
  if (preRow.status !== "paid") return failure(NOT_REFUNDABLE);
  const paymentRef = preRow.payment_ref;
  const paidThroughProvider = isProviderPayment(paymentRef);

  const admin = createAdminClient();
  const { data: owed, error: owedError } = await admin.rpc("order_line_refund_amount", {
    p_order_id: id.data,
    p_line_id: lineKey,
  });
  if (owedError) {
    console.error("[orders] order_line_refund_amount failed", owedError.message);
    return failure(serverError("refundOrder"));
  }
  if (typeof owed !== "number") return failure(NOT_REFUNDABLE);

  // THE MONEY FIRST, exactly this line's.
  if (
    owed > 0 &&
    !(await refundWithProvider(paymentRef, account.accountId, id.data, { amountCents: owed, lineKey: lineKey ?? "first" }))
  ) {
    return failure(REFUND_REFUSED);
  }

  const { data, error } = await admin.rpc("order_apply_line_refund", {
    p_order_id: id.data,
    p_line_id: lineKey,
    p_reason: why.data,
    p_restock: restock === true,
    p_amount_cents: owed,
  });
  if (error) {
    console.error("[orders] order_apply_line_refund failed", error.message);
    return failure(serverError("refundOrder"));
  }
  let outcome = data as "line_refunded" | "refunded" | "rest" | "already" | "not_found" | "not_refundable";
  if (outcome === "not_found") return failure(notFound("order"));
  if (outcome === "not_refundable" || outcome === "already") return failure(NOT_REFUNDABLE);

  if (outcome === "rest") {
    // Every line is back but not all the money: another line was refunded at
    // the same moment, so neither took the delivery. What is left goes back as
    // the whole order's refund (which also gives back our fee).
    const settled = await refundWhatIsLeft(supabase, {
      orderId: id.data,
      reason: why.data,
      restock: false,
      paymentRef,
      accountId: account.accountId,
    });
    if (settled === "refused") return failure(REFUND_REFUSED);
    if (settled === "error") return failure(serverError("refundOrder"));
    if (settled !== "refunded") return failure(NOT_REFUNDABLE);
    outcome = "refunded";
  } else if (!paidThroughProvider) {
    // Our fee on this part goes back with it. A provider's payment reports
    // that itself (the webhook writes it from Stripe's own figures).
    if (outcome === "refunded") await reverseOrderFees(id.data);
    else await reverseOrderFeesShare(id.data, { refundedCents: owed, orderCents: preRow.amount_cents, key: lineKey ?? "first" });
  }

  const postRpc = await getOrderByIdWithEmailFields(id.data, account);
  if (!postRpc) return failure(notFound("order"));
  const { order, email } = postRpc;
  // The buyer hears once the whole order is refunded (the refund email says
  // the order was). A single line's refund shows on their order page.
  const buyerEmailed = outcome === "refunded" ? await emailBuyerRefund(account, order, email, paymentRef) : false;

  revalidatePath(ORDERS_PATH);
  revalidatePath(OVERVIEW_PATH);
  return { ok: true, order, buyerEmailed };
}

/**
 * Give back whatever of an order's payment is left, then record the whole order
 * refunded: refundOrder's job, and the end of refundOrderLine when two lines
 * refunded at once left the delivery behind.
 *
 * THE MONEY FIRST. An order a payment provider took the money for is refunded
 * WITH that provider, and recorded only when that succeeded: a row saying
 * "refunded" over money that never went back is the one outcome a buyer cannot
 * be left with. Recorded by the service role then: the client-callable
 * order_refund refuses an order a provider charged, so a seller calling it
 * directly can never mark one refunded over money that stayed put
 * (20261021_order_refund_provider_first). Who may refund, and that this is an
 * order of THIS store, is the caller's pre-check.
 */
async function refundWhatIsLeft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  refund: { orderId: string; reason: RefundReason; restock: boolean; paymentRef: string | null; accountId: string },
): Promise<RefundOutcome | "refused" | "error"> {
  const paidThroughProvider = isProviderPayment(refund.paymentRef);
  if (!(await refundWithProvider(refund.paymentRef, refund.accountId, refund.orderId))) return "refused";

  const refundArgs = { p_order_id: refund.orderId, p_reason: refund.reason, p_restock: refund.restock };
  const { data, error } = paidThroughProvider
    ? await createAdminClient().rpc("order_apply_refund", refundArgs)
    : await supabase.rpc("order_refund", refundArgs);
  if (error) {
    console.error("[orders] order_refund failed", error.message);
    return "error";
  }
  const outcome = data as RefundOutcome;
  // Our fee goes back with the sale. A provider's payment reports that itself
  // (the webhook writes it from Stripe's own figures); an order no provider
  // charged has nobody else to say so.
  if (outcome === "refunded" && !paidThroughProvider) await reverseOrderFees(refund.orderId);
  return outcome;
}

/**
 * Give the money back through whoever took it. `paymentRef` is the
 * orders.payment_ref read by the caller's pre-check, so this function makes
 * no extra DB round-trip.
 *
 * Returns true when there is nothing to give back through a provider (the
 * seller pays the buyer back themselves), or when the provider has refunded
 * it; false when the provider refused or could not be reached, and nothing
 * may be recorded.
 *
 * The whole payment, and our fee with it (`refund_application_fee`): a seller
 * is not charged a fee on a sale that did not stand. Idempotent on the order,
 * so a second press, or a retry after a timeout, cannot refund twice.
 */
async function refundWithProvider(
  paymentRef: string | null,
  accountId: string,
  orderId: string,
  /** One line of the order: how much, and which line (for the idempotency
   *  key). Absent = whatever of the payment is left. */
  part?: { amountCents: number; lineKey: string },
): Promise<boolean> {
  // Anything but a provider's payment was never charged by one.
  if (!paymentRef || !isProviderPayment(paymentRef)) return true;

  const paymentAccount = await readPaymentAccount(accountId);
  if (!paymentAccount) {
    console.error("[orders] a paid order's seller has no connected account to refund from");
    return false;
  }
  try {
    await stripeRequest<StripeRefund>(
      "POST",
      "/refunds",
      {
        payment_intent: paymentRef,
        // Our fee goes back in proportion with the part (Stripe works it out).
        refund_application_fee: true,
        ...(part ? { amount: part.amountCents } : {}),
      },
      {
        account: paymentAccount.stripeAccountId,
        idempotencyKey: part ? `refund_${orderId}_${part.lineKey}` : `refund_${orderId}`,
      },
    );
    return true;
  } catch (failed) {
    // Already refunded (in Stripe's dashboard, or by an earlier press whose
    // answer was lost): the money is back, so the order may say so.
    if (failed instanceof StripeApiError && failed.code === "charge_already_refunded") return true;
    console.error(
      "[orders] the provider refused the refund:",
      failed instanceof StripeApiError ? (failed.code ?? failed.type) : String(failed),
    );
    return false;
  }
}

/**
 * The refund notice, on the seller's behalf. `email` and `paymentRef` are
 * read by refundOrder's pre-check, so no extra DB round-trip is needed here.
 * Store name resolution follows the same pattern as emailBuyer.
 */
async function emailBuyerRefund(
  account: Awaited<ReturnType<typeof getActiveAccount>> & {},
  order: OrderView,
  email: OrderEmailFields,
  paymentRef: string | null,
): Promise<boolean> {
  if (!order.buyerEmail) return false;

  const { accountId } = account;
  const orderUrl = email.storefrontId ? await orderLinkUrl(email.storefrontId, order.id) : null;
  const identity = await getSellerIdentity(accountId);
  let storeName = identity.businessName ?? "";
  if (!storeName) {
    const supabase = await createClient();
    const { data: accts } = await supabase.rpc("team_my_accounts");
    storeName =
      (accts as { account_owner_id: string; store_name: string }[] | null)?.find(
        (a) => a.account_owner_id === accountId,
      )?.store_name ?? "";
  }

  const result = await sendRefundEmail(
    order.buyerEmail,
    parseLocale(email.buyerLocale) ?? DEFAULT_LOCALE,
    {
      productTitle: order.productTitle,
      quantity: order.quantity,
      selection: order.selection,
      more: order.addOns,
      reason: order.refund?.reason ?? null,
      amountCents: order.amountCents,
      currency: order.currency,
      // No provider took this payment, so none can give it back.
      manual: !isProviderPayment(paymentRef),
      orderUrl,
      store: { name: storeName, contactEmail: identity.email ?? null },
    },
  );
  return result.sent;
}
