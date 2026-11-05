import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { orderReference } from "@/lib/validation/checkout";
import { ORDER_REVIEW_REMINDER_REF_PARAM } from "@/lib/checkout/paths";
import { verifyOrderRef } from "@/lib/orders/order-link";
import { readOrderByRef } from "@/lib/orders/order-page";
import { orderPagePath, REVIEW_QUERY_PARAM } from "@/lib/storefront/product-page-url";
import { stopReviewReminder } from "@/lib/reviews/reminder-job";

/**
 * /api/orders/review-reminder/unsubscribe?ref=<order ref>: the review
 * reminder email's List-Unsubscribe address.
 *
 * POST is RFC 8058's one-click unsubscribe: the buyer's MAIL CLIENT (Gmail's
 * "Unsubscribe" beside the sender, say) posts `List-Unsubscribe=One-Click`
 * here from its own servers, so there is no same-origin check and no cookie;
 * the order's credential in the address is the proof, and all it can do is
 * stop a reminder. Its budget is per ORDER, never per IP: those servers carry
 * every one of their users' unsubscribes. A forged ref costs one signature
 * check and nothing else.
 *
 * GET never changes anything (link scanners fetch every address in a
 * message): it opens the order page's stop dialog instead.
 */

const NO_STORE = { "cache-control": "no-store" };

function credential(request: Request): string | null {
  const ref = new URL(request.url).searchParams.get(ORDER_REVIEW_REMINDER_REF_PARAM);
  return orderReference.safeParse(ref).success ? ref : null;
}

export async function POST(request: Request): Promise<Response> {
  const ref = credential(request);
  const orderId = ref ? await verifyOrderRef(ref) : null;
  if (!orderId) return new Response(null, { status: 404, headers: NO_STORE });
  if (!(await rateLimitKey(orderId, "order_review_reminder_unsubscribe", RATE_LIMITS.orderReviewReminderUnsubscribe))) {
    return new Response(null, { status: 429, headers: NO_STORE });
  }
  const stopped = await stopReviewReminder(orderId);
  return new Response(null, { status: stopped ? 200 : 500, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const ref = credential(request);
  if (!ref) return new Response(null, { status: 404, headers: NO_STORE });
  if (!(await rateLimitKey(await clientKey(await headers()), "order_review_reminder", RATE_LIMITS.orderReviewReminder))) {
    return new Response(null, { status: 429, headers: NO_STORE });
  }
  const order = await readOrderByRef(ref);
  if (!order?.storefront_id) return new Response(null, { status: 404, headers: NO_STORE });
  const target = `${orderPagePath(order.storefront_id, ref)}?${REVIEW_QUERY_PARAM}=stop`;
  return new Response(null, {
    status: 303,
    // no-referrer: the credential in this address must not travel onward.
    headers: { ...NO_STORE, location: new URL(target, request.url).toString(), "referrer-policy": "no-referrer" },
  });
}
