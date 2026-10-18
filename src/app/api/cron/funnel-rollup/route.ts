import { runFunnelRollup } from "@/lib/analytics/funnel/rollup";
import { cronAuthorized } from "@/lib/ops/cron";

/**
 * POST /api/cron/funnel-rollup: one run of the storefront funnel's daily
 * rollup (lib/analytics/funnel/rollup.ts), started by the scheduler.
 *
 * NOTHING IN THE REQUEST IS READ beyond the scheduler's secret (lib/ops/
 * cron.ts). There is no body and no parameter: a caller cannot name a seller
 * or a day. The job decides which days are due from its own clock.
 *
 * Answers 404 to anyone without the secret, and while no secret is set. With
 * it: how much was done, as counts and never as ids. 500 when a day could not
 * be rolled, so the scheduler's run goes red; the next run takes it up again.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  try {
    const result = await runFunnelRollup();
    const failed = result.configured && result.failed > 0;
    return Response.json(result, { status: failed ? 500 : 200, headers: NO_STORE });
  } catch (error) {
    console.error("[funnel] rollup run failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
