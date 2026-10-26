/**
 * Where a review came from. Pure constants: safe on server and client.
 *
 * MIRROR of reviews_source_check and review_imports_source_check in
 * supabase/migrations/20261025_reviews.sql.
 */

/** The Shopify review apps whose exports the importer reads. */
export const REVIEW_IMPORT_SOURCES = ["judgeme", "loox", "yotpo", "shopify"] as const;

export type ReviewImportSource = (typeof REVIEW_IMPORT_SOURCES)[number];

/** Every origin a review can have: written here, or imported. */
export const REVIEW_SOURCES = ["native", ...REVIEW_IMPORT_SOURCES] as const;

export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export function isReviewImportSource(value: unknown): value is ReviewImportSource {
  return (REVIEW_IMPORT_SOURCES as readonly unknown[]).includes(value);
}

export function isReviewSource(value: unknown): value is ReviewSource {
  return (REVIEW_SOURCES as readonly unknown[]).includes(value);
}
