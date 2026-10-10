import { runAccountDeletions } from "@/lib/account-deletion/run";
import { cronAuthorized } from "@/lib/ops/cron";

/**
 * POST /api/cron/account-deletions: one run of the deletion job
 * (lib/account-deletion/run.ts), started by the scheduler.
 *
 * NOTHING IN THE REQUEST IS READ beyond the scheduler's secret (lib/ops/
 * cron.ts). There is no body and no parameter: a caller cannot name an account,
 * a date or a count. The job decides what is due from its own table and its
 * own clock.
 *
 * Answers 404 to anyone without the secret, and while no secret is set, so the
 * route is indistinguishable from one that does not exist. With it: how much
 * was done, as counts and never as ids, and `more: true` when the scheduler
 * should call again straight away (one run does a bounded amount of work).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    return Response.json(await runAccountDeletions(), { headers: NO_STORE });
  } catch (error) {
    // The run could not even read what is due. Nothing was deleted.
    console.error("[account deletion] run failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
