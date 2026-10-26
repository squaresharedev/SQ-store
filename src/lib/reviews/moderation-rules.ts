/**
 * The words the review moderation speaks. Pure constants: safe on server and
 * client.
 *
 * MIRROR of reviews_moderation_status_check and reviews_hidden_reason_check
 * in supabase/migrations/20261025_reviews.sql.
 */

/**
 * Where the automatic check left a review.
 *
 *   pending  not read yet (or the classifier could not be reached); hidden
 *   clean    passed
 *   held     the classifier was unsure; hidden until the seller publishes it
 *   blocked  broke a rule; hidden, and nobody can publish it
 */
export const REVIEW_MODERATION_STATUSES = ["pending", "clean", "held", "blocked"] as const;
export type ReviewModerationStatus = (typeof REVIEW_MODERATION_STATUSES)[number];

/**
 * Why a seller may hide a review. Deliberately not "negative" or "unfair":
 * hiding a review for its opinion misleads buyers, which EU consumer law
 * forbids, so these are the reasons that are not about the opinion.
 */
export const REVIEW_HIDE_REASONS = ["spam", "offensive", "personal_info", "unrelated"] as const;
export type ReviewHideReason = (typeof REVIEW_HIDE_REASONS)[number];

/** What the seller can do to one review (review_set_visibility). */
export const REVIEW_VISIBILITY_ACTIONS = ["hide", "show", "publish"] as const;
export type ReviewVisibilityAction = (typeof REVIEW_VISIBILITY_ACTIONS)[number];

/** The seller's moderation list, filtered. */
export const REVIEW_MODERATION_FILTERS = ["all", "held", "hidden"] as const;
export type ReviewModerationFilter = (typeof REVIEW_MODERATION_FILTERS)[number];

export function isReviewHideReason(value: unknown): value is ReviewHideReason {
  return (REVIEW_HIDE_REASONS as readonly unknown[]).includes(value);
}

export function isReviewModerationStatus(value: unknown): value is ReviewModerationStatus {
  return (REVIEW_MODERATION_STATUSES as readonly unknown[]).includes(value);
}
