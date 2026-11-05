import { cronAuthorized } from "@/lib/ops/cron";
import { runReviewReminders } from "@/lib/reviews/reminder-job";

/**
 * POST /api/cron/review-reminders: one run of the review reminder job
 * (lib/reviews/reminder-job.ts), started by the scheduler.
 *
 * Reads nothing from the request but the scheduler's secret. Answers 404
 * without it; with it, counts (never an order or an address), `more: true`
 * when it should be called again, and `configured: false` while mail is off,
 * which is not a failure: the order page offers no reminder then. A 500 (the
 * queue could not be read) turns the scheduled job red.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    return Response.json(await runReviewReminders(), { headers: NO_STORE });
  } catch (error) {
    console.error("[review-reminders] run failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
