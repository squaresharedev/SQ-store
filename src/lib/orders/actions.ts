"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessibleAccounts, getActiveAccount } from "@/lib/team/account-context";
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
import { getOrderById, isProviderPayment } from "@/lib/orders/queries";
import { sendRefundEmail, sendShippedEmail } from "@/lib/orders/emails";
import { orderLinkUrl } from "@/lib/orders/order-link";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { StripeApiError, stripeRequest, type StripeRefund } from "@/lib/billing/stripe-api";
import { readPaymentAccount } from "@/lib/payments/connect/account";
import { reverseOrderFees } from "@/lib/billing/fee-ledger";
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
  if (!(await getOrderById(id.data))) return failure(notFound("order"));

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

  const order = await getOrderById(id.data);
  if (!order) return failure(notFound("order"));

  const tellBuyer =
    outcome === "shipped" ||
    (outcome === "tracking_updated" && order.fulfilment.trackingNumber !== null);
  const buyerEmailed = tellBuyer
    ? await emailBuyer(account.accountId, order, outcome === "shipped" ? "shipped" : "tracking")
    : false;

  revalidatePath(ORDERS_PATH);
  revalidatePath(OVERVIEW_PATH);
  return { ok: true, order, buyerEmailed };
}

/**
 * The shipping notice, on the seller's behalf. Reads the things the view does
 * not carry: the language the buyer checked out in, the storefront their order
 * page lives under, and who they bought from. The seller identity is a
 * service-role read, gated here by everything markOrderShipped has already
 * checked (a member of this store who may fulfil its orders).
 */
async function emailBuyer(
  accountId: string,
  order: OrderView,
  kind: "shipped" | "tracking",
): Promise<boolean> {
  if (!order.buyerEmail) return false;

  const supabase = await createClient();
  const [{ data: row }, identity, accounts] = await Promise.all([
    supabase
      .from("orders")
      .select("buyer_locale, storefront_id")
      .eq("id", order.id)
      .eq("seller_id", accountId)
      .maybeSingle(),
    getSellerIdentity(accountId),
    getAccessibleAccounts(),
  ]);
  // The buyer's own order page, where the parcel is followed. Null for an
  // order recorded without a storefront, or where no link key is configured.
  const orderUrl = row?.storefront_id ? await orderLinkUrl(row.storefront_id, order.id) : null;
  // The trading name buyers see on the product page, else the store's name.
  const storeName =
    identity.businessName ??
    accounts.find((option) => option.accountId === accountId)?.storeName ??
    "";

  const result = await sendShippedEmail(
    order.buyerEmail,
    parseLocale(row?.buyer_locale) ?? DEFAULT_LOCALE,
    {
      kind,
      productTitle: order.productTitle,
      quantity: order.quantity,
      selection: order.selection,
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

  // In THIS store, for the same reason markOrderShipped checks it.
  const before = await getOrderById(id.data);
  if (!before) return failure(notFound("order"));
  // Not refundable is said before any money is asked to move.
  if (before.status !== "paid") return failure(NOT_REFUNDABLE);

  const supabase = await createClient();
  // THE MONEY FIRST. An order a payment provider took the money for is
  // refunded WITH that provider, and recorded only when that succeeded: a row
  // saying "refunded" over money that never went back is the one outcome a
  // buyer cannot be left with.
  if (!(await refundWithProvider(supabase, account.accountId, id.data))) {
    return failure(REFUND_REFUSED);
  }

  // Recorded by the service role once the provider has refunded it: the
  // client-callable order_refund refuses an order a provider charged, so a
  // seller calling it directly can never mark one refunded over money that
  // stayed put (20261021_order_refund_provider_first). Who may refund, and
  // that this is an order of THIS store, was settled above.
  const refundArgs = {
    p_order_id: id.data,
    p_reason: why.data,
    p_restock: restock === true,
  };
  const { data, error } = before.paidThroughProvider
    ? await createAdminClient().rpc("order_apply_refund", refundArgs)
    : await supabase.rpc("order_refund", refundArgs);
  if (error) {
    console.error("[orders] order_refund failed", error.message);
    return failure(serverError("refundOrder"));
  }
  const outcome = data as RefundOutcome;
  if (outcome === "not_found") return failure(notFound("order"));
  if (outcome === "not_refundable") return failure(NOT_REFUNDABLE);
  // Our fee goes back with the sale. A provider's payment reports that itself
  // (the webhook writes it from Stripe's own figures); an order no provider
  // charged has nobody else to say so.
  if (!before.paidThroughProvider) await reverseOrderFees(id.data);

  const order = await getOrderById(id.data);
  if (!order) return failure(notFound("order"));
  const buyerEmailed = await emailBuyerRefund(account.accountId, order);

  revalidatePath(ORDERS_PATH);
  revalidatePath(OVERVIEW_PATH);
  return { ok: true, order, buyerEmailed };
}

/**
 * Give the money back through whoever took it. True when there is nothing to
 * give back that way (no provider charged this order: the seller pays the
 * buyer back themselves) or when the provider has refunded it; false when the
 * provider refused or could not be reached, and nothing may be recorded.
 *
 * The whole payment, and our fee with it (`refund_application_fee`): a seller
 * is not charged a fee on a sale that did not stand. Idempotent on the order,
 * so a second press, or a retry after a timeout, cannot refund twice.
 */
async function refundWithProvider(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  orderId: string,
): Promise<boolean> {
  const { data: row, error } = await supabase
    .from("orders")
    .select("payment_ref")
    .eq("id", orderId)
    .eq("seller_id", accountId)
    .maybeSingle();
  if (error) {
    console.error("[orders] could not read the payment to refund:", error.message);
    return false;
  }
  // Anything but a provider's payment was never charged by one.
  if (!row?.payment_ref || !isProviderPayment(row.payment_ref)) return true;

  const paymentAccount = await readPaymentAccount(accountId);
  if (!paymentAccount) {
    console.error("[orders] a paid order's seller has no connected account to refund from");
    return false;
  }
  try {
    await stripeRequest<StripeRefund>(
      "POST",
      "/refunds",
      { payment_intent: row.payment_ref, refund_application_fee: true },
      { account: paymentAccount.stripeAccountId, idempotencyKey: `refund_${orderId}` },
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

/** The refund notice, on the seller's behalf. Gated by everything refundOrder
 *  has already checked, like emailBuyer above. */
async function emailBuyerRefund(accountId: string, order: OrderView): Promise<boolean> {
  if (!order.buyerEmail) return false;

  const supabase = await createClient();
  const [{ data: row }, identity, accounts] = await Promise.all([
    supabase
      .from("orders")
      .select("buyer_locale, storefront_id, payment_ref")
      .eq("id", order.id)
      .eq("seller_id", accountId)
      .maybeSingle(),
    getSellerIdentity(accountId),
    getAccessibleAccounts(),
  ]);
  const orderUrl = row?.storefront_id ? await orderLinkUrl(row.storefront_id, order.id) : null;
  const storeName =
    identity.businessName ??
    accounts.find((option) => option.accountId === accountId)?.storeName ??
    "";

  const result = await sendRefundEmail(
    order.buyerEmail,
    parseLocale(row?.buyer_locale) ?? DEFAULT_LOCALE,
    {
      productTitle: order.productTitle,
      quantity: order.quantity,
      selection: order.selection,
      reason: order.refund?.reason ?? null,
      amountCents: order.amountCents,
      currency: order.currency,
      // No provider took this payment, so none can give it back.
      manual: !isProviderPayment(row?.payment_ref),
      orderUrl,
      store: { name: storeName, contactEmail: identity.email ?? null },
    },
  );
  return result.sent;
}
