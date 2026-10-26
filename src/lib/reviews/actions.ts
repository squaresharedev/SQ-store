"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { msg } from "@/i18n/types";
import { REVIEWS_PATH } from "@/lib/reviews/paths";
import {
  REVIEW_VISIBILITY_ACTIONS,
  isReviewHideReason,
  type ReviewHideReason,
  type ReviewVisibilityAction,
} from "@/lib/reviews/moderation-rules";

// The seller's one write on a review: hide it (with a reason), show it again,
// or publish one the automatic check held. Session -> role -> budget -> parse
// -> active-store scope -> review_set_visibility, which re-checks all of it on
// its own (20261025_reviews.sql).

export type ReviewVisibilityResult = { ok: true } | ActionFailure;

/** What public.review_set_visibility answers. */
type Outcome = "hidden" | "shown" | "published" | "unchanged" | "blocked" | "invalid" | "not_found";

export async function setReviewVisibility(
  reviewId: string,
  action: ReviewVisibilityAction,
  reason: ReviewHideReason | null = null,
): Promise<ReviewVisibilityResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "moderateReviews"));
  }
  if (!(await rateLimit("review_moderate", RATE_LIMITS.reviewModerate))) {
    return failure(rateLimited("moderateReviews"));
  }

  const id = uuidField().safeParse(reviewId);
  if (!id.success || !(REVIEW_VISIBILITY_ACTIONS as readonly unknown[]).includes(action)) {
    return failure(notFound("review"));
  }
  if (action === "hide" && !isReviewHideReason(reason)) {
    return failure(invalidInput(msg("Errors.reviews.noReason.message"), msg("Errors.reviews.noReason.fix")));
  }

  const supabase = await createClient();
  // In THIS store. The function would also act on a review in any other store
  // the caller may edit; the page only ever shows the active one.
  const { data: review } = await supabase
    .from("reviews")
    .select("id")
    .eq("id", id.data)
    .eq("seller_id", account.accountId)
    .maybeSingle();
  if (!review) return failure(notFound("review"));

  const { data, error } = await supabase.rpc("review_set_visibility", {
    p_review_id: id.data,
    p_action: action,
    ...(action === "hide" && reason ? { p_reason: reason } : {}),
  });
  if (error) {
    console.error("[reviews] review_set_visibility failed", error.message);
    return failure(serverError("moderateReview"));
  }
  const outcome = data as Outcome;
  if (outcome === "not_found") return failure(notFound("review"));
  if (outcome === "blocked") {
    return failure(invalidInput(msg("Errors.reviews.blocked.message"), msg("Errors.reviews.blocked.fix")));
  }
  if (outcome === "invalid") {
    return failure(invalidInput(msg("Errors.reviews.noReason.message"), msg("Errors.reviews.noReason.fix")));
  }

  revalidatePath(REVIEWS_PATH);
  return { ok: true };
}
