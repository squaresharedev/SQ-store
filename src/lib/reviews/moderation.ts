// SERVER ONLY. The automatic check on reviews: what turns a pending review
// into clean, held or blocked.
//
// EVERY REVIEW STARTS PENDING (20261025_reviews.sql), and a pending review is
// not public. This module asks the classifier about it under the review
// policy (lib/moderation/auto/policy.ts REVIEW_POLICY_PROMPT) and records the
// answer. It is the only writer of moderation_status apart from a seller
// publishing a held review (review_set_visibility).
//
// TWO ENTRY POINTS, one mechanism:
//
//   moderateReview  one review, straight after a buyer posts it (from
//                   after() in the review route), so it appears within
//                   seconds.
//   sweepReviews    the worklist, oldest first: imported reviews, and any
//                   review whose check found the classifier down. Run by the
//                   moderation cron alongside the listing sweep.
//
// FAIL CLOSED. No answer from the classifier (no key, an outage, a rate
// limit) leaves the review pending, which is hidden; the next sweep asks
// again. Nothing here throws.

import { createAdminClient } from "@/lib/supabase/admin";
import { classifyReview } from "@/lib/moderation/auto/classify";
import { isRemovalGround } from "@/lib/moderation/removal";
import type { Verdict } from "@/lib/moderation/auto/policy";
import { notifyNewReview } from "@/lib/reviews/notify";
import type { ReviewModerationStatus } from "@/lib/reviews/moderation-rules";

/** Reviews one sweep run reads. The scheduler calls again while `more`. */
export const REVIEW_SWEEP_BATCH = 40;
/** Classifier calls in flight at once within a run. */
const REVIEW_SWEEP_CONCURRENCY = 8;

const CHECK_SELECT = "id, product_id, seller_id, source, rating, title, body, author_name, moderation_status" as const;

type CheckRow = {
  id: string;
  product_id: string;
  seller_id: string;
  source: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  moderation_status: string;
};

/** What the check made of one review; "gone" when it no longer exists. */
export type ReviewCheckOutcome = ReviewModerationStatus | "gone";

const STATUS_FOR: Record<Verdict, ReviewModerationStatus> = {
  clean: "clean",
  unsure: "held",
  violation: "blocked",
};

function log(message: string, detail?: unknown) {
  console.error(`[reviews] ${message}`, detail instanceof Error ? detail.message : (detail ?? ""));
}

/** Judge one row and record the answer. */
async function check(row: CheckRow): Promise<ReviewCheckOutcome> {
  if (row.moderation_status !== "pending") return row.moderation_status as ReviewModerationStatus;
  const verdict = await classifyReview({ authorName: row.author_name, title: row.title, body: row.body });
  if (!verdict) return "pending";

  const status = STATUS_FOR[verdict.verdict];
  const { data, error } = await createAdminClient()
    .from("reviews")
    .update({
      moderation_status: status,
      moderation_ground: status === "clean" ? null : isRemovalGround(verdict.ground) ? verdict.ground : null,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    // Only a review still waiting: never overwrite a seller's publish, or a
    // second check that got there first.
    .eq("moderation_status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    log(`could not record the check of ${row.id}:`, error.message);
    return "pending";
  }
  if (!data) return "pending";

  // A buyer's review, now settled: the seller hears about it once, here. An
  // imported review is the seller's own history and a blocked one shows
  // nothing, so neither is announced.
  if (row.source === "native" && status !== "blocked") {
    await notifyNewReview({
      reviewId: row.id,
      productId: row.product_id,
      sellerId: row.seller_id,
      rating: row.rating,
      held: status === "held",
    });
  }
  return status;
}

/** Check one review now. Used straight after a buyer posts it. */
export async function moderateReview(reviewId: string): Promise<ReviewCheckOutcome> {
  try {
    const { data, error } = await createAdminClient()
      .from("reviews")
      .select(CHECK_SELECT)
      .eq("id", reviewId)
      .maybeSingle();
    if (error) {
      log(`could not read ${reviewId}:`, error.message);
      return "pending";
    }
    return data ? await check(data as CheckRow) : "gone";
  } catch (error) {
    log(`check of ${reviewId} did not finish:`, error);
    return "pending";
  }
}

export type ReviewSweepReport = {
  checked: number;
  outcomes: Partial<Record<ReviewCheckOutcome, number>>;
  /** Worth calling again straight away: more is waiting and this run settled some. */
  more: boolean;
};

/** One run of the worklist: the oldest pending reviews, a few at a time. */
export async function sweepReviews(): Promise<ReviewSweepReport> {
  const report: ReviewSweepReport = { checked: 0, outcomes: {}, more: false };
  const { data, error } = await createAdminClient()
    .from("reviews")
    .select(CHECK_SELECT)
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: true })
    .limit(REVIEW_SWEEP_BATCH + 1);
  // The reviews migration is not applied here yet: nothing is waiting.
  if (error?.code === "PGRST205" || error?.code === "42P01") return report;
  if (error) throw new Error(`reading the review worklist failed: ${error.message}`);

  const rows = (data as CheckRow[]).slice(0, REVIEW_SWEEP_BATCH);
  let settledAny = false;
  for (let start = 0; start < rows.length; start += REVIEW_SWEEP_CONCURRENCY) {
    const outcomes = await Promise.all(
      rows.slice(start, start + REVIEW_SWEEP_CONCURRENCY).map((row) =>
        check(row).catch((checkError: unknown) => {
          log(`check of ${row.id} did not finish:`, checkError);
          return "pending" as const;
        }),
      ),
    );
    for (const outcome of outcomes) {
      report.checked += 1;
      report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1;
      if (outcome !== "pending") settledAny = true;
    }
  }
  // With the classifier down every row stays waiting, and a caller told
  // "more" would spin.
  report.more = settledAny && data.length > REVIEW_SWEEP_BATCH;
  return report;
}
