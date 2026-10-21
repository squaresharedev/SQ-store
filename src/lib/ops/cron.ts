// SERVER ONLY. Who may start a scheduled job.
//
// Scheduled work (app/api/cron/*) is started from outside: something on a
// timer calls a route. That route does things no visitor may ask for, so the
// caller has to hold CRON_SECRET, a random string set as a Worker secret
// (`wrangler secret put CRON_SECRET`) and given to the scheduler
// (.github/workflows/scheduled.yml reads the repository secret of the same
// name).
//
// OFF UNTIL THE SECRET EXISTS. Without it every cron route answers 404, the
// same as an address that was never a route, and nothing scheduled runs. A
// secret too short to be one counts as none.

/** A secret shorter than this is a typo or a placeholder, not a secret. */
const CRON_SECRET_MIN_LENGTH = 32;

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET ?? "";
  return secret.length >= CRON_SECRET_MIN_LENGTH ? secret : null;
}

/** Whether scheduled jobs can run in this deployment at all. Something that
 *  hands work to a job asks this, so the work is not left waiting in silence
 *  for a schedule that was never switched on. */
export function cronConfigured(): boolean {
  return cronSecret() !== null;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/**
 * Whether this request carries `secret` as `Authorization: Bearer <secret>`.
 *
 * Both sides are hashed before they are compared, so the comparison takes the
 * same time whatever was sent: neither the secret's length nor how much of a
 * guess was right can be read off the clock.
 */
async function bearerMatches(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const [expected, given] = await Promise.all([digest(secret), digest(presented)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ given[index];
  return difference === 0;
}

/** Whether this request carries the scheduler's secret (`Bearer <CRON_SECRET>`). */
export async function cronAuthorized(request: Request): Promise<boolean> {
  const secret = cronSecret();
  return secret !== null && bearerMatches(request, secret);
}

/**
 * Whether this request carries the ops token (`Bearer <ERROR_REPORT_TOKEN>`),
 * the secret the dashboard already shares with the uptime monitor
 * (ops/uptime). Guards the routes that only an operator may call, such as
 * api/ops/mail-test. Off until the token exists, like the scheduler's.
 */
export async function opsAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.ERROR_REPORT_TOKEN ?? "";
  return secret.length >= CRON_SECRET_MIN_LENGTH && bearerMatches(request, secret);
}
