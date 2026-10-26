/**
 * The review system's numbers, in one place. Pure constants: safe on server
 * and client.
 *
 * MIRROR of the length CHECKs on public.reviews
 * (supabase/migrations/20261025_reviews.sql).
 */

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MAX = 5000;
export const REVIEW_AUTHOR_MAX = 60;

/** Reviews per page on the product page and the API's default. */
export const REVIEW_PAGE_SIZE = 10;
/** The most one API call returns. */
export const REVIEW_PAGE_SIZE_MAX = 50;

/** Orderings the review feed offers. */
export const REVIEW_SORTS = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
export const DEFAULT_REVIEW_SORT: ReviewSort = "newest";

/** Bytes of import file one request may carry, and the rows it may hold. */
export const REVIEW_IMPORT_BYTES_MAX = 4 * 1024 * 1024;
export const REVIEW_IMPORT_ROWS_MAX = 5000;
/** Body cap for the import route: the file plus its mapping. */
export const REVIEW_IMPORT_BODY_MAX = REVIEW_IMPORT_BYTES_MAX + 256 * 1024;
