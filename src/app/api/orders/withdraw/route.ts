import { headers } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { withdrawSchema } from "@/lib/validation/checkout";
import { readOrderByRef } from "@/lib/orders/order-page";
import { buyerWithdrawal } from "@/lib/orders/withdrawal";
import { orderNumber } from "@/lib/orders/order-link";
import { orderDetailPath } from "@/lib/orders/paths";
import { sendWithdrawalAcknowledgement, sendWithdrawalNotice } from "@/lib/orders/emails";
import { createNotification } from "@/lib/notifications/create";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";

/**
 * POST /api/orders/withdraw: the withdrawal function's confirm button
 * (Consumer Rights Directive art. 11a, in force since 19 June 2026).
 *
 * The buyer proves the order twice: its credential (the order page's link) and
 * the email address it was placed with, which the link alone does not reveal.
 * Then, once:
 *
 *   - the order records WHEN the buyer withdrew (orders.withdrawal_requested_at,
 *     set only if it was empty, so asking again changes nothing and answers
 *     with the first time);
 *   - the seller is told, by bell and by email, with what they owe now;
 *   - the buyer gets the acknowledgement on a durable medium the law requires
 *     "without undue delay" (art. 11a(3)).
 *
 * What happens next (the return, the refund) is between buyer and seller, as
 * the contract always was: Square Share records the withdrawal and delivers
 * it, and is not a party to the sale.
 */

const BODY_MAX_BYTES = 2 * 1024;

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ ok: false, error: "forbidden" }, 403);
  const body = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!body.ok) return reply({ ok: false, error: "invalid" }, body.reason === "too_large" ? 413 : 400);
  const parsed = withdrawSchema.safeParse(body.value);
  if (!parsed.success) return reply({ ok: false, error: "invalid" }, 400);
  const { orderRef, name, email, locale } = parsed.data;

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "order_withdraw", RATE_LIMITS.orderWithdraw))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const order = await readOrderByRef(orderRef);
  if (!order) return reply({ ok: false, error: "not_found" }, 404);
  // Spent BEFORE the email is compared, so a wrong guess and a right one cost
  // the same, and a distributed guesser hits a wall per order.
  if (!(await rateLimitKey(order.id, "order_withdraw_order", RATE_LIMITS.orderWithdrawPerOrder))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }
  if (!order.buyer_email || order.buyer_email.toLowerCase() !== email.toLowerCase()) {
    return reply({ ok: false, error: "email" }, 403);
  }
  if (order.withdrawal_requested_at) {
    return reply({ ok: true, requestedAt: order.withdrawal_requested_at }, 200);
  }

  const policy = await getShippingPolicy(order.seller_id);
  if (!buyerWithdrawal(order, policy).available) return reply({ ok: false, error: "closed" }, 409);

  const admin = createAdminClient();
  const requestedAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("orders")
    .update({ withdrawal_requested_at: requestedAt })
    .eq("id", order.id)
    .is("withdrawal_requested_at", null)
    .select("withdrawal_requested_at")
    .maybeSingle();
  if (error) {
    console.error("[withdraw] could not record the withdrawal", error);
    return reply({ ok: false, error: "failed" }, 500);
  }
  // Someone else's request landed between the read and this write: answer
  // with the time that stands.
  if (!updated) {
    const { data: current } = await admin
      .from("orders")
      .select("withdrawal_requested_at")
      .eq("id", order.id)
      .maybeSingle();
    return reply({ ok: true, requestedAt: current?.withdrawal_requested_at ?? requestedAt }, 200);
  }

  const number = orderNumber(order.id);
  after(async () => {
    const [seller, { data: profile }, { data: user }, { data: storefront }] = await Promise.all([
      getSellerIdentity(order.seller_id),
      admin.from("profiles").select("locale").eq("id", order.seller_id).maybeSingle(),
      admin.auth.admin.getUserById(order.seller_id),
      order.storefront_id
        ? admin.from("storefronts").select("name").eq("id", order.storefront_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const store = { name: seller.businessName || storefront?.name || "", contactEmail: seller.email ?? null };
    const withdrawal = { number, productTitle: order.product_title, requestedAt: new Date(requestedAt), store };

    await createNotification({
      userId: order.seller_id,
      type: "order",
      message: {
        title: { key: "Notifications.messages.order.withdrawn.title", values: { number } },
        body: { key: "Notifications.messages.order.withdrawn.body", values: { title: order.product_title } },
      },
      data: { href: orderDetailPath(order.id) },
    });
    const sellerEmail = user?.user?.email;
    if (sellerEmail) {
      await sendWithdrawalNotice(sellerEmail, parseLocale(profile?.locale) ?? DEFAULT_LOCALE, {
        ...withdrawal,
        orderId: order.id,
        buyerEmail: order.buyer_email!,
        buyerName: name,
      });
    }
    await sendWithdrawalAcknowledgement(order.buyer_email!, parseLocale(locale) ?? DEFAULT_LOCALE, withdrawal);
  });

  return reply({ ok: true, requestedAt: updated.withdrawal_requested_at ?? requestedAt }, 201);
}
