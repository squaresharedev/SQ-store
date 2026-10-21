// WHAT IS WATCHED. Each check is one HTTP request that a working site answers
// in a known way; together they cover every public surface and the database
// behind them. Add one here and the next run watches it.
import type { CheckResult } from "./monitor";

type Check = {
  name: string;
  url: string;
  headers?: Record<string, string>;
  /** Extra proof beyond a 200, for a page that can answer 200 while broken. */
  verify?: (body: string) => string | null;
};

const TIMEOUT_MS = 10_000;

/** The Supabase project's public (anon) key, as committed in .env.production. */
const SUPABASE_URL = "https://vnyfndqpdllwhvhinjoi.supabase.co";

export function checksFor(supabaseAnonKey: string): Check[] {
  return [
    { name: "Home (squareshare.eu)", url: "https://squareshare.eu/" },
    { name: "Dashboard sign-in", url: "https://dashboard.squareshare.eu/login" },
    {
      // Answers from plan_prices, and 503 when the database does not.
      name: "Dashboard database",
      url: "https://dashboard.squareshare.eu/api/billing/plan-prices",
      verify: (body) => {
        try {
          const plans = (JSON.parse(body) as { plans?: unknown[] }).plans;
          return Array.isArray(plans) && plans.length > 0 ? null : "no plans in the answer";
        } catch {
          return "not JSON";
        }
      },
    },
    { name: "Storefront embed", url: "https://embed.squareshare.eu/widget.js" },
    { name: "Admin panel", url: "https://admin.squareshare.eu/login" },
    {
      // The database and sign-in service themselves, apart from our Worker.
      name: "Supabase",
      url: `${SUPABASE_URL}/auth/v1/health`,
      headers: { apikey: supabaseAnonKey },
    },
  ];
}

/** Run one check: never throws, always answers within the timeout. */
export async function runCheck(check: Check): Promise<CheckResult> {
  const started = Date.now();
  const base = { name: check.name, url: check.url };
  try {
    const response = await fetch(check.url, {
      headers: { "user-agent": "squareshare-uptime/1 (+ops/uptime)", ...check.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = check.verify ? await response.text() : (await response.body?.cancel(), "");
    const ms = Date.now() - started;
    if (response.status !== 200) return { ...base, ok: false, detail: `status ${response.status} in ${ms} ms` };
    const problem = check.verify?.(body) ?? null;
    if (problem) return { ...base, ok: false, detail: `${problem} (status 200 in ${ms} ms)` };
    return { ...base, ok: true, detail: `200 in ${ms} ms` };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const detail =
      name === "TimeoutError" || name === "AbortError"
        ? `timed out after ${TIMEOUT_MS / 1000} s`
        : `request failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
    return { ...base, ok: false, detail };
  }
}
