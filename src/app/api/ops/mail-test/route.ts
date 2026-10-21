import { checkMailRelay, sendTestEmail } from "@/lib/email/send";
import { opsAuthorized } from "@/lib/ops/cron";

/**
 * POST /api/ops/mail-test: does production mail work? Whether or not
 * TRANSACTIONAL_EMAIL_FROM / _ENABLED are on, so it can be asked BEFORE the
 * switch that makes sellers' pages depend on mail is turned on, and after any
 * change to the relay's secrets.
 *
 *   POST            logs in to the relay and sends nothing: `{ relay: "ok" }`.
 *                   The deploy's smoke check calls this on every new version
 *                   (scripts/smoke-check.sh), so a build whose SMTP client
 *                   cannot run on Workers never goes live.
 *   POST ?send=1    also sends ONE test email, to OPS_ALERT_EMAIL and nowhere
 *                   else: `{ sent: true }`.
 *
 * NOTHING IN THE REQUEST IS READ beyond the ops token (lib/ops/cron.ts
 * opsAuthorized) and that one flag: no body, no recipient, no message. 404 to
 * anyone without the token and while none is set, like the scheduler's
 * routes. A failure is the relay's own words (they never hold a secret).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!(await opsAuthorized(request))) return new Response(null, { status: 404, headers: NO_STORE });

  const sending = new URL(request.url).searchParams.get("send") === "1";
  try {
    if (sending) {
      const to = process.env.OPS_ALERT_EMAIL;
      if (!to) return Response.json({ sent: false, error: "OPS_ALERT_EMAIL is not set" }, { status: 409, headers: NO_STORE });
      await sendTestEmail(to);
      return Response.json({ sent: true }, { headers: NO_STORE });
    }
    await checkMailRelay();
    return Response.json({ relay: "ok" }, { headers: NO_STORE });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[mail test] failed:", detail);
    return Response.json({ error: detail.slice(0, 300) }, { status: 502, headers: NO_STORE });
  }
}
