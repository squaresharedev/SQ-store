// What a seller can tell us when they cancel a paid plan. Pure, client-safe:
// the cancel dialog lists the reasons, the action validates them, and the
// table that stores them (plan_cancellations) checks the same list.
//
// The codes are Stripe's own `cancellation_details.feedback` values, plus one
// of ours (`temporary`), so what a seller tells us here can be sent to Stripe
// as it is and the two records line up once billing runs on Stripe.

/**
 * Why a seller is leaving, in the order the dialog offers them.
 * MIRROR of the plan_cancellations.reason CHECK
 * (supabase/migrations/20261003_plan_cancellations.sql): edit both together.
 */
export const CANCELLATION_REASONS = [
  "too_expensive",
  "unused",
  "missing_features",
  "switched_service",
  "temporary",
  "other",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

/** The longest note a seller can leave with a cancellation (characters).
 *  The table's CHECK holds the same bound. */
export const CANCELLATION_DETAIL_MAX = 1000;

/** What a seller told us on the way out. Both parts are optional: leaving
 *  must never wait on a survey. */
export type CancellationFeedback = {
  reason: CancellationReason | null;
  detail: string | null;
};

/**
 * Each reason as Stripe's `cancellation_details[feedback]` value. Ours map to
 * theirs one to one, except `temporary`, which Stripe has no word for.
 */
export const STRIPE_CANCELLATION_FEEDBACK: Record<CancellationReason, string> = {
  too_expensive: "too_expensive",
  unused: "unused",
  missing_features: "missing_features",
  switched_service: "switched_service",
  temporary: "other",
  other: "other",
};
