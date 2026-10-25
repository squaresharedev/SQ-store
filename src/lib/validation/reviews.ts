import { z } from "zod";
import { boundedInt, multiLineText, optionalSingleLineText, singleLineText } from "@/lib/validation/inputs";
import { orderReference } from "@/lib/validation/checkout";
import {
  DEFAULT_REVIEW_SORT,
  REVIEW_AUTHOR_MAX,
  REVIEW_BODY_MAX,
  REVIEW_PAGE_SIZE,
  REVIEW_PAGE_SIZE_MAX,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_SORTS,
  REVIEW_TITLE_MAX,
  type ReviewSort,
} from "@/lib/reviews/limits";

/**
 * THE REVIEW SCHEMAS. What a buyer may write about a product they bought,
 * and the feed's query.
 *
 * Every typed field goes through a primitive from inputs.ts (hidden and
 * control characters out, trimmed, bounded). That is input hygiene, not the
 * XSS defence: a review is only ever rendered as React text nodes and served
 * as JSON strings, never as markup.
 */

export const reviewRating = boundedInt({ field: "reviewRating", min: REVIEW_RATING_MIN, max: REVIEW_RATING_MAX });

/** The fields a review carries, shared by the buyer's form and the importer. */
export const reviewContent = {
  rating: reviewRating,
  title: optionalSingleLineText({ field: "reviewTitle", max: REVIEW_TITLE_MAX }),
  body: multiLineText({ field: "reviewBody", max: REVIEW_BODY_MAX }),
  authorName: singleLineText({ field: "reviewAuthor", max: REVIEW_AUTHOR_MAX }),
};

/** A buyer's review. The order's link credential is the proof of purchase;
 *  the route checks it, this only bounds it. */
export const reviewSubmitSchema = z.strictObject({
  orderRef: orderReference,
  ...reviewContent,
  body: multiLineText({ field: "reviewBody", max: REVIEW_BODY_MAX, min: 1 }),
});

export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>;

export type ReviewQuery = { sort: ReviewSort; page: number; pageSize: number };

/**
 * The feed's `?sort=&page=&pageSize=`, read leniently: anything unknown or
 * out of range falls back to the default rather than failing the page.
 */
export function parseReviewQuery(params: URLSearchParams): ReviewQuery {
  const sort = params.get("sort");
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? REVIEW_PAGE_SIZE);
  return {
    sort: (REVIEW_SORTS as readonly string[]).includes(sort ?? "") ? (sort as ReviewSort) : DEFAULT_REVIEW_SORT,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    pageSize:
      Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= REVIEW_PAGE_SIZE_MAX ? pageSize : REVIEW_PAGE_SIZE,
  };
}
