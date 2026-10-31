import { cleanUpAgentData } from "@/lib/agent/cleanup";
import { cronAuthorized } from "@/lib/ops/cron";

/**
 * POST /api/cron/agent-cleanup: drops what the agent surface no longer needs
 * (lib/agent/cleanup.ts), started by the scheduler. Nothing in the request is
 * read beyond the scheduler's secret. Answers 404 without it.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await cronAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });
  const ok = await cleanUpAgentData();
  return Response.json({ ok }, { status: ok ? 200 : 500, headers: NO_STORE });
}
