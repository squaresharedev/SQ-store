import { BRAND_NAME } from "@/lib/brand";
import { boundedCsv, datedCsvFileName, type CsvValue } from "@/lib/format/csv";
import { REVIEW_EXPORT_BYTES_MAX, REVIEW_EXPORT_ROWS_MAX } from "@/lib/reviews/limits";
import type { SellerReview } from "@/types/review";

/**
 * THE REVIEWS EXPORT: a store's reviews as a CSV, served by
 * app/api/sellers/export-reviews/route.ts from the reviews page. Pure, so the
 * file's shape and its size bounds are unit-tested.
 *
 * WHAT IS IN IT is what the reviews page shows the store, and nothing a buyer
 * did not write or the moderation did not decide: no order, no email (reviews
 * never hold one), no seller or teammate ids. The reviewer's name is the one
 * they chose to sign the review with.
 *
 * BOUNDED. Every review can carry REVIEW_BODY_MAX characters, so a count of
 * rows alone does not bound the file: it stops at REVIEW_EXPORT_ROWS_MAX rows
 * or REVIEW_EXPORT_BYTES_MAX bytes, whichever comes first, and says so
 * (`truncated`). The reviews arrive as an async stream and the stream is left
 * the moment the file is full, so the database is never read past it.
 *
 * RECOGNISED BY THE IMPORTER. The review importer knows this file by its
 * columns (lib/reviews/import.ts) and matches it by `review_id`, so a store
 * reading its own export back sees every review as already here. It never
 * writes from one: see readSquareShareExport.
 *
 * THE WATERMARK is `exported_from`, the brand on every row. A column rather
 * than a note above the header, so the file stays one header and rows, which
 * spreadsheets, scripts and other platforms' importers all read (GDPR Art. 20
 * asks for machine-readable). It says where the file came from and nothing
 * more: no claim to own what buyers wrote, none that the reviews were checked
 * or verified by us (Directive 2019/2161 on what a review may be said to be).
 *
 * The header row is a data contract (snake_case, English, never translated).
 * Add columns at the end; never rename or reorder one.
 */

/** The columns, in file order. See the note above before changing any. */
export const REVIEWS_CSV_COLUMNS = [
  "review_id",
  "review_date",
  "product_title",
  "product_id",
  "rating",
  "title",
  "body",
  "reviewer_name",
  "verified_buyer",
  "source",
  "published",
  "moderation_status",
  "hidden_reason",
  "moderation_ground",
  "exported_from",
] as const;

/** Response header set when the view held more than the file: how many rows it does hold. */
export const REVIEWS_EXPORT_TRUNCATED_HEADER = "X-Reviews-Export-Truncated";

/** Whether buyers see the review: the seller has not hidden it and the check passed it. */
export function isReviewPublished(review: SellerReview): boolean {
  return review.hiddenReason === null && review.moderation === "clean";
}

/** One review's cells, in REVIEWS_CSV_COLUMNS order. */
function reviewCells(review: SellerReview): CsvValue[] {
  return [
    review.id,
    review.reviewedAt,
    review.productTitle,
    review.productId,
    review.rating,
    review.title,
    review.body,
    review.authorName,
    String(review.verified),
    review.source,
    String(isReviewPublished(review)),
    review.moderation,
    review.hiddenReason,
    review.ground,
    BRAND_NAME,
  ];
}

export type ReviewsCsvLimits = { maxRows: number; maxBytes: number };

const DEFAULT_LIMITS: ReviewsCsvLimits = { maxRows: REVIEW_EXPORT_ROWS_MAX, maxBytes: REVIEW_EXPORT_BYTES_MAX };

export type ReviewsCsv = {
  csv: string;
  /** Reviews in the file. */
  rows: number;
  /** The stream held more than fitted. */
  truncated: boolean;
};

/**
 * The file for `reviews` (already scoped to one store and in the view's
 * order), cut at the first row past either limit. Asks the stream for one
 * review beyond the row limit, to tell "exactly full" from "cut short".
 */
export async function reviewsCsv(
  reviews: AsyncIterable<SellerReview>,
  limits: ReviewsCsvLimits = DEFAULT_LIMITS,
): Promise<ReviewsCsv> {
  const file = boundedCsv(REVIEWS_CSV_COLUMNS, limits.maxBytes);
  let truncated = false;
  for await (const review of reviews) {
    if (file.rows >= limits.maxRows || !file.add(reviewCells(review))) {
      truncated = true;
      break;
    }
  }
  return { csv: file.toString(), rows: file.rows, truncated };
}

/** "square-share-reviews-2026-10-28.csv", dated in UTC like the orders export. */
export function reviewsCsvFileName(now: Date): string {
  return datedCsvFileName("reviews", now);
}
