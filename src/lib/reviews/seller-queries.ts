// SERVER ONLY. The store's own reviews, for the moderation page. Read through
// the member's own session (RLS: reviews_select_member), scoped to the active
// store, so a member sees exactly the reviews of the store they are in.

import { createClient } from "@/lib/supabase/server";
import { isRemovalGround } from "@/lib/moderation/removal";
import { isReviewSource } from "@/lib/reviews/sources";
import {
  isReviewHideReason,
  isReviewModerationStatus,
  type ReviewModerationFilter,
} from "@/lib/reviews/moderation-rules";
import type { Paginated } from "@/types/pagination";
import type { SellerReview } from "@/types/review";

/** Reviews per page on the moderation page. */
export const SELLER_REVIEWS_PAGE_SIZE = 20;

const SELLER_REVIEW_SELECT =
  "id, product_id, rating, title, body, author_name, is_verified_buyer, source, reviewed_at, moderation_status, moderation_ground, hidden_reason, products(title)" as const;

type SellerReviewRow = {
  id: string;
  product_id: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  is_verified_buyer: boolean;
  source: string;
  reviewed_at: string;
  moderation_status: string;
  moderation_ground: string | null;
  hidden_reason: string | null;
  products: { title: string } | null;
};

function toSellerReview(row: SellerReviewRow): SellerReview {
  return {
    id: row.id,
    productId: row.product_id,
    productTitle: row.products?.title ?? "",
    rating: row.rating,
    title: row.title,
    body: row.body,
    authorName: row.author_name,
    verified: row.is_verified_buyer,
    source: isReviewSource(row.source) ? row.source : "native",
    reviewedAt: row.reviewed_at,
    moderation: isReviewModerationStatus(row.moderation_status) ? row.moderation_status : "pending",
    ground: isRemovalGround(row.moderation_ground) ? row.moderation_ground : null,
    hiddenReason: isReviewHideReason(row.hidden_reason) ? row.hidden_reason : null,
  };
}

export type SellerReviewList = Paginated<SellerReview> & {
  /** Held reviews waiting on the seller, for the tab's count. */
  held: number;
};

/** One page of the store's reviews, newest first. Null on a failed read. */
export async function getSellerReviews(
  accountId: string,
  filter: ReviewModerationFilter,
  page: number,
): Promise<SellerReviewList | null> {
  const supabase = await createClient();
  const from = (page - 1) * SELLER_REVIEWS_PAGE_SIZE;
  let list = supabase
    .from("reviews")
    .select(SELLER_REVIEW_SELECT, { count: "exact" })
    .eq("seller_id", accountId);
  if (filter === "held") list = list.eq("moderation_status", "held");
  if (filter === "hidden") list = list.eq("is_approved", false);

  const [rows, held] = await Promise.all([
    list.order("created_at", { ascending: false }).range(from, from + SELLER_REVIEWS_PAGE_SIZE - 1),
    supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", accountId)
      .eq("moderation_status", "held"),
  ]);
  if (rows.error || held.error) {
    console.error("[reviews] seller review read failed", rows.error?.message ?? held.error?.message);
    return null;
  }
  return {
    rows: (rows.data as unknown as SellerReviewRow[]).map(toSellerReview),
    total: rows.count ?? 0,
    page,
    pageSize: SELLER_REVIEWS_PAGE_SIZE,
    held: held.count ?? 0,
  };
}
