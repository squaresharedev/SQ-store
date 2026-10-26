import { sweep } from "@/lib/moderation/auto/check";
import { sweepReviews, type ReviewSweepReport } from "@/lib/reviews/moderation";
import { cronAuthorized } from "@/lib/ops/cron";

/**
 * POST /api/cron/moderation: one run of the automatic check's worklist
 * (lib/moderation/auto/check.ts), started by the scheduler.
 *
 * WHAT IT PICKS UP. Everything the moderation wall is holding that no save
 * settled: a row written straight through the REST API or by another app, a
 * check that timed out or found the classifier down, and content from before
 * the wall, which is audited while it stays live. And buyer reviews still
 * waiting on their check (lib/reviews/moderation.ts): imports, and any whose
 * check after posting found the classifier down. A slow or missed run delays
 * sellers and never safety: what it has not reached is hidden, not public.
 *
 * `?dry=1` judges what is waiting and reports what each row WOULD become
 * without settling any of it. That is how the first run against existing
 * content is read before anything is hidden.
 *
 * Answers 404 to anyone without the scheduler's secret (lib/ops/cron.ts), and
 * while no secret is set. With it: counts by outcome, and `more: true` when
 * the scheduler should call again straight away.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    const report = await sweep({ dryRun });
    if (dryRun) return Response.json(report, { headers: NO_STORE });
    // Its own failure only: listings settled above stay settled.
    let reviews: ReviewSweepReport | { error: string };
    try {
      reviews = await sweepReviews();
    } catch (error) {
      console.error("[moderation] review sweep failed:", error instanceof Error ? error.message : error);
      reviews = { error: "failed" };
    }
    const more = report.more || ("more" in reviews && reviews.more);
    return Response.json({ ...report, reviews, more }, { headers: NO_STORE });
  } catch (error) {
    // The run could not even read what is waiting. Nothing was settled.
    console.error("[moderation] sweep failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
