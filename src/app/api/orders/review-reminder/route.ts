import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { reviewReminderSchema } from "@/lib/validation/reviews";
import { readOrderByRef } from "@/lib/orders/order-page";
import { orderReviewState } from "@/lib/reviews/eligibility";
import { reviewRemindersAvailable, stopReviewReminder } from "@/lib/reviews/reminder-job";
import { reviewReminderOffered, reviewReminderShownDue, reviewReminderStatus } from "@/lib/reviews/reminders";

/**
 * POST /api/orders/review-reminder: the order page's "Email me a reminder"
 * switch, `{ orderRef, want }`.
 *
 * Asking (`want: true`) is the buyer's CONSENT to one email asking for a
 * review (lib/reviews/reminders.ts says why it must be), so it is recorded
 * with its time, and only where the page would offer it: mail and the
 * schedule are on, the order has an address, it can be reviewed and has not
 * been, and it is not too late. Asking again while it is on changes nothing,
 * so a double press cannot push the date back.
 *
 * Stopping (`want: false`) always works, whatever else is true of the order:
 * taking consent back must be as easy as giving it (GDPR art. 7(3)).
 *
 * The order link is the credential, as for every buyer action. Answers are
 * codes; the page says them in the buyer's language.
 */

const BODY_MAX_BYTES = 2 * 1024;

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ ok: false, error: "forbidden" }, 403);
  const body = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!body.ok) return reply({ ok: false, error: "invalid" }, body.reason === "too_large" ? 413 : 400);
  const parsed = reviewReminderSchema.safeParse(body.value);
  if (!parsed.success) return reply({ ok: false, error: "invalid" }, 400);
  const { orderRef, want } = parsed.data;

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "order_review_reminder", RATE_LIMITS.orderReviewReminder))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const order = await readOrderByRef(orderRef);
  if (!order) return reply({ ok: false, error: "not_found" }, 404);

  if (!want) {
    if (!(await stopReviewReminder(order.id))) return reply({ ok: false, error: "failed" }, 500);
    return reply({ ok: true, status: order.review_reminder_sent_at ? "sent" : "off" }, 200);
  }

  const now = new Date();
  const current = reviewReminderStatus(order);
  if (current === "sent") return reply({ ok: true, status: "sent" }, 200);
  if (current === "on") return reply({ ok: true, status: "on", dueAt: reviewReminderShownDue(order, now) }, 200);
  if (
    current === null ||
    !reviewRemindersAvailable() ||
    !order.buyer_email ||
    !order.storefront_id ||
    !reviewReminderOffered(order, now)
  ) {
    return reply({ ok: false, error: "closed" }, 409);
  }

  const admin = createAdminClient();
  const [{ data: product, error: productError }, { data: review, error: reviewError }] = await Promise.all([
    order.product_id
      ? admin.from("products").select("status, moderation_status").eq("id", order.product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("reviews").select("id").eq("order_id", order.id).maybeSingle(),
  ]);
  if (productError || reviewError) return reply({ ok: false, error: "failed" }, 503);
  if (orderReviewState(order, product, review !== null) !== "open") return reply({ ok: false, error: "closed" }, 409);

  const requestedAt = now.toISOString();
  const { data: updated, error } = await admin
    .from("orders")
    .update({ review_reminder_requested_at: requestedAt, review_reminder_stopped_at: null })
    .eq("id", order.id)
    .is("review_reminder_sent_at", null)
    .is("review_reminder_dropped_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[review-reminder] could not record the request", error.message);
    return reply({ ok: false, error: "failed" }, 500);
  }
  // Sent or let go between the read and this write.
  if (!updated) return reply({ ok: false, error: "closed" }, 409);

  const dueAt = reviewReminderShownDue(
    { ...order, review_reminder_requested_at: requestedAt, review_reminder_stopped_at: null },
    now,
  );
  return reply({ ok: true, status: "on", dueAt }, 201);
}
