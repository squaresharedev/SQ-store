// Tell the admin panel that something moderation-related just happened, so
// staff hear about it NOW rather than on the next scheduled scan.
//
// WHY A PING AND NOT A PAYLOAD. The admin panel already learns about reports
// and review requests by reading the shared database (its notification scan,
// run once a minute by pg_cron, keeps a watermark per source and never
// announces the same row twice). This call only asks it to run that scan
// immediately. So it carries nothing: no ids, no report text, nothing a
// stranger's prose could smuggle across. If it is lost, the scheduled scan
// still finds the row within a minute; if it arrives twice, the watermark
// makes the second one a no-op.
//
// OFF UNLESS CONFIGURED, like lib/turnstile.ts and lib/email/send.ts. Both
// variables unset is a normal deployment (the scheduled scan still works), so
// it returns quietly rather than logging on every report.
//
// NEVER THROWS, NEVER BLOCKS. Callers run it inside after(), and a report or a
// review request has already been recorded by the time it runs: a slow or
// down admin panel must not be able to fail either.

/** Long enough for a cold admin worker, short enough that a hung one does not
 *  hold the request's after() work open. */
const PING_TIMEOUT_MS = 5000;

export async function pingAdminModeration(): Promise<void> {
  const base = process.env.ADMIN_NOTIFY_URL;
  const secret = process.env.ADMIN_NOTIFY_SECRET;
  if (!base || !secret) return;

  try {
    const response = await fetch(
      `${base.replace(/\/+$/, "")}/api/moderation/notify`,
      {
        method: "POST",
        headers: { "x-scan-secret": secret },
        cache: "no-store",
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.warn("[moderation] admin ping answered", response.status);
    }
  } catch (err) {
    console.warn(
      "[moderation] admin ping failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
