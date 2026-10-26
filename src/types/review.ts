import type { Paginated } from "@/types/pagination";
import type { ReviewSource } from "@/lib/reviews/sources";
import type { ReviewHideReason, ReviewModerationStatus } from "@/lib/reviews/moderation-rules";
import type { RemovalGround } from "@/lib/moderation/removal";

/**
 * A review as a buyer may see it: no order, no email, no seller id. Built
 * field by field by lib/reviews/queries.ts, so a new column never reaches a
 * page by accident.
 */
export type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verified: boolean;
  /** "native" for a review written here, else the app it was imported from. */
  source: ReviewSource;
  reviewedAt: string;
};

/** A product's numbers, from product_rating_summaries. */
export type RatingSummary = {
  count: number;
  /** Null until the first review. */
  average: number | null;
  /** How many reviews gave each star, index 0 = one star. */
  breakdown: [number, number, number, number, number];
};

export type ReviewPage = Paginated<PublicReview>;

/** What the product page is handed: the numbers and the first page. */
export type ProductReviews = {
  summary: RatingSummary;
  firstPage: ReviewPage;
};

/**
 * A review as its own store sees it on the moderation page: everything a
 * buyer sees, plus where the check and the seller left it. Never sent to a
 * buyer.
 */
export type SellerReview = PublicReview & {
  productId: string;
  productTitle: string;
  moderation: ReviewModerationStatus;
  /** The rule the check named, when it held or blocked the review. */
  ground: RemovalGround | null;
  /** Why the seller hid it; null while it is not hidden. */
  hiddenReason: ReviewHideReason | null;
};
