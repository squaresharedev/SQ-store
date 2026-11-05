import { cronAuthorized } from "@/lib/ops/cron";
import { TermsNoticeBlocked, runTermsNotices } from "@/lib/legal/terms-notices";

/**
 * POST /api/cron/terms-notices: one run of the Terms notice job
 * (lib/legal/terms-notices.ts), started by the scheduler.
 *
 * Reads nothing from the request but the scheduler's secret. Answers 404 without
 * it, counts with it, and `more: true` when it should be called again. A 500
 * turns the scheduled job red, which is the point: a notice that cannot go out
 * has to be noticed by a person.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    return Response.json(await runTermsNotices(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TermsNoticeBlocked) {
      console.error(`[terms] ${error.message}`);
      return Response.json({ error: error.reason }, { status: 500, headers: NO_STORE });
    }
    console.error("[terms] run failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
