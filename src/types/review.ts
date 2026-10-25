import type { Paginated } from "@/types/pagination";
import type { ReviewSource } from "@/lib/reviews/sources";

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
