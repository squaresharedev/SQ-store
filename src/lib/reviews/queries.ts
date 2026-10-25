// SERVER ONLY. The buyer-facing review reads: a product's numbers and a page
// of its feed. Used by the hosted product page and GET /api/products/[id]/
// reviews, so the two can never disagree.
//
// SECURITY MODEL, same as the product page: a service-role read behind an
// application gate, never an anon RLS policy. Only APPROVED reviews are ever
// selected, and each is BUILT field by field (toPublicReview), so the order
// id, the seller id and anything added to the table later stay on the server
// by construction.
//
// FAST BY DESIGN. The numbers come from product_rating_summaries, which the
// database keeps current on every review write (20261025_reviews.sql); no
// page load aggregates reviews. The feed is one indexed range read, and its
// total is the summary's count rather than a second COUNT(*).

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRowVisible } from "@/lib/moderation/removal";
import { REVIEW_PAGE_SIZE, DEFAULT_REVIEW_SORT, type ReviewSort } from "@/lib/reviews/limits";
import { isReviewSource } from "@/lib/reviews/sources";
import type { ReviewQuery } from "@/lib/validation/reviews";
import type { ProductReviews, PublicReview, RatingSummary, ReviewPage } from "@/types/review";

/** The review columns a buyer may see. Named, so a new column is never
 *  shown by accident. */
export const PUBLIC_REVIEW_SELECT =
  "id, rating, title, body, author_name, is_verified_buyer, source, reviewed_at" as const;

export type PublicReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  is_verified_buyer: boolean;
  source: string;
  reviewed_at: string;
};

export const EMPTY_RATING_SUMMARY: RatingSummary = { count: 0, average: null, breakdown: [0, 0, 0, 0, 0] };

export function toPublicReview(row: PublicReviewRow): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: row.author_name,
    verified: row.is_verified_buyer,
    source: isReviewSource(row.source) ? row.source : "native",
    reviewedAt: row.reviewed_at,
  };
}

/** Column order per sort. Every one ends on the id, so pages never overlap. */
const SORT_ORDER: Record<ReviewSort, { column: string; ascending: boolean }[]> = {
  newest: [{ column: "reviewed_at", ascending: false }],
  highest: [
    { column: "rating", ascending: false },
    { column: "reviewed_at", ascending: false },
  ],
  lowest: [
    { column: "rating", ascending: true },
    { column: "reviewed_at", ascending: false },
  ],
};

/**
 * Whether this product's reviews may be shown at all: it exists, is live and
 * has not been taken down. Null when the database did not answer.
 */
export async function isReviewableProduct(productId: string): Promise<boolean | null> {
  const { data, error } = await createAdminClient()
    .from("products")
    .select("status, moderation_status")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    console.error("[reviews] product read failed", error.message);
    return null;
  }
  return data !== null && data.status === "active" && isRowVisible(data);
}

/** A product's numbers. No row yet means no reviews yet. Null on a failed read. */
export async function getRatingSummary(productId: string): Promise<RatingSummary | null> {
  const { data, error } = await createAdminClient()
    .from("product_rating_summaries")
    .select("review_count, average, rating_1, rating_2, rating_3, rating_4, rating_5")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) {
    console.error("[reviews] summary read failed", error.message);
    return null;
  }
  if (!data || data.review_count === 0) return EMPTY_RATING_SUMMARY;
  return {
    count: data.review_count,
    average: data.average === null ? null : Number(data.average),
    breakdown: [data.rating_1, data.rating_2, data.rating_3, data.rating_4, data.rating_5],
  };
}

/** One page of a product's approved reviews. Null on a failed read. */
export async function listReviews(
  productId: string,
  query: ReviewQuery,
  total: number,
): Promise<ReviewPage | null> {
  const from = (query.page - 1) * query.pageSize;
  let request = createAdminClient()
    .from("reviews")
    .select(PUBLIC_REVIEW_SELECT)
    .eq("product_id", productId)
    .eq("is_approved", true);
  for (const { column, ascending } of SORT_ORDER[query.sort]) {
    request = request.order(column, { ascending });
  }
  const { data, error } = await request
    .order("id", { ascending: false })
    .range(from, from + query.pageSize - 1);
  if (error) {
    console.error("[reviews] feed read failed", error.message);
    return null;
  }
  return {
    rows: (data as PublicReviewRow[]).map(toPublicReview),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * What the product page renders: the numbers and the first page, newest
 * first. Null when either read failed, and the page then simply shows no
 * reviews section: reviews never cost a buyer the product page.
 */
export const getProductReviews = cache(async (productId: string): Promise<ProductReviews | null> => {
  const summary = await getRatingSummary(productId);
  if (!summary) return null;
  const firstPage =
    summary.count === 0
      ? { rows: [], total: 0, page: 1, pageSize: REVIEW_PAGE_SIZE }
      : await listReviews(productId, { sort: DEFAULT_REVIEW_SORT, page: 1, pageSize: REVIEW_PAGE_SIZE }, summary.count);
  return firstPage ? { summary, firstPage } : null;
});
