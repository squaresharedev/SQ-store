import { headers } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeIlike } from "@/lib/supabase/ilike";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { orderLookupSchema } from "@/lib/validation/checkout";
import { orderLinkUrl, orderNumber } from "@/lib/orders/order-link";
import { sendOrderLinkEmail } from "@/lib/orders/emails";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { DEFAULT_LOCALE, parseLocale } from "@/i18n/locales";

/**
 * POST /api/orders/lookup: "email me my order link".
 *
 * The withdrawal function has to be reachable from the shop itself, not only
 * from an email a buyer may have lost (CRD art. 11a). So the shop's footer
 * links a small form: the email the order was placed with and the number on
 * it. If they match an order from this storefront, the link to its page is
 * EMAILED to that address. It is never shown here: knowing someone's email
 * and an eight-character number must not be enough to open their order.
 *
 * THE ANSWER IS ALWAYS THE SAME (202), match or not, so the form cannot be
 * used to find out who has bought what. The send happens after the response,
 * so the timing says nothing either.
 */

const BODY_MAX_BYTES = 2 * 1024;

function reply(status: number): Response {
  return Response.json({ ok: status === 202 }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply(403);
  const body = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!body.ok) return reply(body.reason === "too_large" ? 413 : 400);
  const parsed = orderLookupSchema.safeParse(body.value);
  if (!parsed.success) return reply(400);
  const { storefrontId, email, number, locale } = parsed.data;

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "order_lookup", RATE_LIMITS.orderLookup))) return reply(429);

  after(async () => {
    const admin = createAdminClient();
    const { data: orders, error } = await admin
      .from("orders")
      .select("id, seller_id")
      .eq("storefront_id", storefrontId)
      // No wildcards around it: the address as typed, case aside.
      .ilike("buyer_email", escapeIlike(email))
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[order-lookup] read failed", error);
      return;
    }
    const wanted = number.trim().replace(/^#/, "").toUpperCase();
    const order = orders?.find((candidate) => orderNumber(candidate.id) === wanted);
    if (!order) return;
    const [url, seller, { data: storefront }] = await Promise.all([
      orderLinkUrl(storefrontId, order.id),
      getSellerIdentity(order.seller_id),
      admin.from("storefronts").select("name").eq("id", storefrontId).maybeSingle(),
    ]);
    if (!url) return;
    await sendOrderLinkEmail(email, parseLocale(locale) ?? DEFAULT_LOCALE, {
      number: orderNumber(order.id),
      orderUrl: url,
      store: { name: seller.businessName || storefront?.name || "", contactEmail: seller.email ?? null },
    });
  });

  return reply(202);
}
