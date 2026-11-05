// SERVER ONLY. The store's own reviews, for the moderation page. Read through
// the member's own session (RLS: reviews_select_member), scoped to the active
// store, so a member sees exactly the reviews of the store they are in.

import { presignGetUrl } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { ilikeAny } from "@/lib/supabase/ilike";
import { isRemovalGround } from "@/lib/moderation/removal";
import { isReviewSource } from "@/lib/reviews/sources";
import { isReviewHideReason, isReviewModerationStatus } from "@/lib/reviews/moderation-rules";
import { REVIEW_EXPORT_PAGE_SIZE } from "@/lib/reviews/limits";
import type { SellerReviewFilters, SellerReviewSort } from "@/lib/reviews/seller-filters";
import type { Paginated } from "@/types/pagination";
import type { RatingSummary, SellerReview } from "@/types/review";

/** Reviews per page on the moderation page. */
export const SELLER_REVIEWS_PAGE_SIZE = 20;

const SELLER_REVIEW_SELECT =
  "id, product_id, rating, title, body, author_name, is_verified_buyer, source, reviewed_at, moderation_status, moderation_ground, hidden_reason, products(title, image_key)" as const;

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
  products: { title: string; image_key: string | null } | null;
};

function toSellerReview(row: SellerReviewRow, imageUrls: Map<string, string | null>): SellerReview {
  return {
    id: row.id,
    productId: row.product_id,
    productTitle: row.products?.title ?? "",
    productImageUrl: row.products?.image_key ? (imageUrls.get(row.products.image_key) ?? null) : null,
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

/** What the search box matches: the words a buyer wrote, and who wrote them. */
const SELLER_REVIEW_SEARCH_COLUMNS = ["title", "body", "author_name"] as const;

/** Each ordering, as columns; the review date breaks ties, then the id. */
const SELLER_REVIEW_ORDER: Record<SellerReviewSort, { column: string; ascending: boolean }[]> = {
  newest: [{ column: "reviewed_at", ascending: false }],
  oldest: [{ column: "reviewed_at", ascending: true }],
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
 * The store's reviews in one view, narrowed and ordered as `filters` ask, not
 * yet paged. The page and the export both read through this, so a file always
 * holds exactly the reviews the list shows.
 */
function sellerReviewView(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  filters: SellerReviewFilters,
  options?: { count: "exact" },
) {
  let list = supabase.from("reviews").select(SELLER_REVIEW_SELECT, options).eq("seller_id", accountId);
  if (filters.status === "held") list = list.eq("moderation_status", "held");
  if (filters.status === "hidden") list = list.eq("is_approved", false);
  if (filters.search) list = list.or(ilikeAny(SELLER_REVIEW_SEARCH_COLUMNS, filters.search));
  if (filters.rating) list = list.eq("rating", filters.rating);
  if (filters.productId) list = list.eq("product_id", filters.productId);
  if (filters.origin === "verified") list = list.eq("is_verified_buyer", true);
  if (filters.origin === "imported") list = list.eq("is_imported", true);
  for (const { column, ascending } of SELLER_REVIEW_ORDER[filters.sort]) {
    list = list.order(column, { ascending });
  }
  return list.order("id", { ascending: false });
}

/** One page of the store's reviews, narrowed and ordered as asked. Null on a failed read. */
export async function getSellerReviews(
  accountId: string,
  filters: SellerReviewFilters,
  page: number,
): Promise<SellerReviewList | null> {
  const supabase = await createClient();
  const from = (page - 1) * SELLER_REVIEWS_PAGE_SIZE;

  const [rows, held] = await Promise.all([
    sellerReviewView(supabase, accountId, filters, { count: "exact" }).range(from, from + SELLER_REVIEWS_PAGE_SIZE - 1),
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
  const data = rows.data as unknown as SellerReviewRow[];
  // One signed URL per product photo, however many of its reviews are on the page.
  const keys = [...new Set(data.map((row) => row.products?.image_key).filter((key): key is string => Boolean(key)))];
  const imageUrls = new Map(await Promise.all(keys.map(async (key) => [key, await presignGetUrl(key)] as const)));
  return {
    rows: data.map((row) => toSellerReview(row, imageUrls)),
    total: rows.count ?? 0,
    page,
    pageSize: SELLER_REVIEWS_PAGE_SIZE,
    held: held.count ?? 0,
  };
}

/**
 * Every review in one view, in its order, for the export (lib/reviews/
 * export.ts): read REVIEW_EXPORT_PAGE_SIZE at a time and only as the consumer
 * asks, so a file that fills up early stops the reads, and never past `limit`
 * rows. Photos are not signed: a file has no use for a link that expires.
 *
 * THROWS on a failed read, rather than ending early: a file quietly missing
 * its tail would read as the whole store.
 */
export async function* sellerReviewsForExport(
  accountId: string,
  filters: SellerReviewFilters,
  limit: number,
): AsyncGenerator<SellerReview> {
  const supabase = await createClient();
  const noPhotos = new Map<string, string | null>();
  for (let from = 0; from < limit; from += REVIEW_EXPORT_PAGE_SIZE) {
    const to = Math.min(from + REVIEW_EXPORT_PAGE_SIZE, limit) - 1;
    const { data, error } = await sellerReviewView(supabase, accountId, filters).range(from, to);
    if (error) throw new Error(`Reviews export read failed: ${error.message}`);
    const rows = data as unknown as SellerReviewRow[];
    for (const row of rows) yield toSellerReview(row, noPhotos);
    if (rows.length < to - from + 1) return;
  }
}

/** A product the store's reviews can be narrowed to. */
export type ReviewedProduct = { id: string; title: string };

/** The store at a glance, above the list: its rating, and what can be filtered by. */
export type SellerReviewOverview = {
  /** Across every product, public reviews only: what buyers are shown. */
  summary: RatingSummary;
  /** The store's products that have reviews, by title, for the product filter. */
  products: ReviewedProduct[];
};

/**
 * The store's rating and its reviewed products. Summed from
 * product_rating_summaries, which the database keeps current on every review
 * write, so this is one small read however many reviews there are. Null on a
 * failed read.
 */
export async function getSellerReviewOverview(accountId: string): Promise<SellerReviewOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_rating_summaries")
    .select("product_id, review_count, rating_sum, rating_1, rating_2, rating_3, rating_4, rating_5, products(title)")
    .eq("seller_id", accountId);
  if (error) {
    console.error("[reviews] seller overview read failed", error.message);
    return null;
  }

  type Row = {
    product_id: string;
    review_count: number;
    rating_sum: number;
    rating_1: number;
    rating_2: number;
    rating_3: number;
    rating_4: number;
    rating_5: number;
    products: { title: string } | null;
  };
  const rows = data as unknown as Row[];
  const breakdown: RatingSummary["breakdown"] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    count += row.review_count;
    sum += row.rating_sum;
    breakdown[0] += row.rating_1;
    breakdown[1] += row.rating_2;
    breakdown[2] += row.rating_3;
    breakdown[3] += row.rating_4;
    breakdown[4] += row.rating_5;
  }

  return {
    summary: { count, average: count === 0 ? null : Math.round((sum / count) * 100) / 100, breakdown },
    // A summary row exists once a product has had a review, even one hidden
    // since, so a seller can still find that product's reviews.
    products: rows
      .filter((row) => row.products)
      .map((row) => ({ id: row.product_id, title: row.products!.title }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
