"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleAccounts, getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
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
import { trackingNumberSchema } from "@/lib/validation/orders";
import { getOrderById } from "@/lib/orders/queries";
import { sendShippedEmail } from "@/lib/orders/emails";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { ORDERS_PATH, OVERVIEW_PATH } from "@/lib/dashboard/paths";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";
import { msg } from "@/i18n/types";
import type { OrderView } from "@/types/order-view";

// The seller's ONE write on an order: it has shipped (or here is its tracking
// number). Session -> role -> budget -> parse -> active-store scope -> the
// self-gated database function, which re-checks all of it on its own
// (20260927_order_fulfilment.sql), then the buyer's email.

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
 * Mark an order shipped, optionally with a tracking number; on an order that
 * has already shipped, set or change its tracking number.
 *
 * The buyer is emailed when the order ships, and again when a tracking number
 * is added or changed afterwards (with the number). Nothing is sent when the
 * number is cleared or re-saved unchanged.
 */
export async function markOrderShipped(
  orderId: string,
  trackingNumber: string,
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

  // In THIS store. The database function would also ship an order in any other
  // store the caller may fulfil, and the page only ever acts on the active one,
  // so an order from elsewhere is "not found" here (getOrderById is scoped).
  if (!(await getOrderById(id.data))) return failure(notFound("order"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_mark_shipped", {
    p_order_id: id.data,
    p_tracking_number: tracking.data || null,
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
 * The shipping notice, on the seller's behalf. Reads the two things the view
 * does not carry: the language the buyer checked out in, and who they bought
 * from. The seller identity is a service-role read, gated here by everything
 * markOrderShipped has already checked (a member of this store who may
 * fulfil its orders).
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
      .select("buyer_locale")
      .eq("id", order.id)
      .eq("seller_id", accountId)
      .maybeSingle(),
    getSellerIdentity(accountId),
    getAccessibleAccounts(),
  ]);
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
      shipTo: order.shipTo,
      store: { name: storeName, contactEmail: identity.email ?? null },
    },
  );
  return result.sent;
}
