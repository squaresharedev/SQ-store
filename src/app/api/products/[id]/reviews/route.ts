import { headers } from "next/headers";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { uuidField } from "@/lib/validation/inputs";
import { parseReviewQuery, reviewSubmitSchema } from "@/lib/validation/reviews";
import { readOrderByRef } from "@/lib/orders/order-page";
import { isReviewableOrder } from "@/lib/reviews/eligibility";
import { moderateReview } from "@/lib/reviews/moderation";
import { getRatingSummary, isReviewableProduct, listReviews } from "@/lib/reviews/queries";

/**
 * /api/products/[id]/reviews: a product's reviews.
 *
 * GET, public: the rating summary and one page of approved reviews
 * (`?sort=newest|highest|lowest&page=&pageSize=&rating=1..5`). Behind the same kind of
 * gate as the product page: a per-IP rate limit, and a product that is live
 * and not taken down. Anything else is the same 404.
 *
 * POST, a buyer's review. Buyers have no accounts; what proves the purchase
 * is the ORDER LINK, the credential every buyer is emailed
 * (lib/orders/order-link.ts). In order:
 *
 *   - same origin only, bounded body, shape first;
 *   - a per-IP rate-limit token spent before any read;
 *   - the link must prove an order OF THIS PRODUCT (else the same 404 as a
 *     link that proves nothing);
 *   - the order must be paid and not refunded (lib/reviews/eligibility.ts),
 *     which is what earns the "Verified buyer" badge;
 *   - one review per order, enforced by a unique index rather than by asking;
 *   - written PENDING, so nothing a buyer types is public before the
 *     automatic check has read it (lib/reviews/moderation.ts, run after the
 *     response, so it appears within seconds; the sweep retries it otherwise).
 *
 * Answers are codes, not sentences: the order page's dialog says them in the
 * buyer's language.
 */

type Params = { params: Promise<{ id: string }> };

const productIdSchema = uuidField("product");

/** A review is a rating, a title and up to 5,000 characters in any script. */
const BODY_MAX_BYTES = 32 * 1024;

function reply(body: Record<string, unknown>, status: number, cache = "no-store"): Response {
  return Response.json(body, { status, headers: { "cache-control": cache } });
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!productIdSchema.safeParse(id).success) return reply({ ok: false, error: "not_found" }, 404);

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "review_read", RATE_LIMITS.reviewRead))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const reviewable = await isReviewableProduct(id);
  if (reviewable === null) return reply({ ok: false, error: "failed" }, 503);
  if (!reviewable) return reply({ ok: false, error: "not_found" }, 404);

  const summary = await getRatingSummary(id);
  if (!summary) return reply({ ok: false, error: "failed" }, 503);
  const query = parseReviewQuery(new URL(request.url).searchParams);
  // The summary already counts each rating, so a filtered page needs no COUNT of its own.
  const total = query.rating ? summary.breakdown[query.rating - 1] : summary.count;
  const page = await listReviews(id, query, total);
  if (!page) return reply({ ok: false, error: "failed" }, 503);

  return reply({ ok: true, summary, page }, 200, "private, max-age=30");
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  if (!isSameOriginRequest(request)) return reply({ ok: false, error: "forbidden" }, 403);
  const { id } = await params;
  if (!productIdSchema.safeParse(id).success) return reply({ ok: false, error: "not_found" }, 404);

  const body = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!body.ok) return reply({ ok: false, error: "invalid" }, body.reason === "too_large" ? 413 : 400);
  const parsed = reviewSubmitSchema.safeParse(body.value);
  if (!parsed.success) return reply({ ok: false, error: "invalid" }, 400);
  const { orderRef, rating, title, body: text, authorName } = parsed.data;

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "review_submit", RATE_LIMITS.reviewSubmit))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const order = await readOrderByRef(orderRef);
  if (!order || order.product_id !== id) return reply({ ok: false, error: "not_found" }, 404);
  if (!isReviewableOrder(order)) return reply({ ok: false, error: "not_eligible" }, 409);
  const reviewable = await isReviewableProduct(id);
  if (reviewable === null) return reply({ ok: false, error: "failed" }, 503);
  if (!reviewable) return reply({ ok: false, error: "not_eligible" }, 409);

  const { data, error } = await createAdminClient()
    .from("reviews")
    .insert({
      product_id: id,
      seller_id: order.seller_id,
      order_id: order.id,
      rating,
      title: title || null,
      body: text,
      author_name: authorName,
      is_verified_buyer: true,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 is reviews_order_unique: this order has its review already.
    if (error.code === "23505") return reply({ ok: false, error: "already_reviewed" }, 409);
    console.error("[reviews] insert failed", error.message);
    return reply({ ok: false, error: "failed" }, 500);
  }

  // After the response: the buyer is not kept waiting on the classifier, and
  // a check that fails here leaves the review pending for the sweep.
  after(() => moderateReview(data.id));
  return reply({ ok: true, status: "pending" }, 201);
}
