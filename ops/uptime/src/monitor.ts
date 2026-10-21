// THE MONITOR'S DECISIONS, pure: what a set of check results means for the
// state carried between runs, and what (if anything) to email about it. No
// network, no clock, no storage: index.ts feeds it results and the time and
// does what it says. Unit-tested in tests/unit/uptime-monitor.test.ts.

/** Consecutive failed runs (one a minute) before a check is called down. */
export const FAILS_TO_ALERT = 2;
/** While something stays down, a reminder this often. */
export const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;
/** At most one error-report email in this window; later reports are logged only. */
export const ERROR_EMAIL_WINDOW_MS = 15 * 60 * 1000;

export type CheckResult = {
  name: string;
  url: string;
  ok: boolean;
  /** "200 in 312 ms", "status 502", "timed out after 10 s", ... */
  detail: string;
};

export type CheckState = {
  /** Consecutive failures, capped at FAILS_TO_ALERT so a long outage writes nothing new. */
  fails: number;
  down: boolean;
  /** ISO time of the first failure in the current run of failures. */
  since: string | null;
  /** What the failure looked like when it was called down. */
  detail: string | null;
};

export type MonitorState = {
  checks: Record<string, CheckState>;
  /** ISO time of the last email about anything still down (alert or reminder). */
  lastNotifiedAt: string | null;
};

export type Transition =
  | { kind: "down"; name: string; url: string; since: string; detail: string }
  | { kind: "recovered"; name: string; url: string; downForMs: number };

export const EMPTY_STATE: MonitorState = { checks: {}, lastNotifiedAt: null };

const FRESH: CheckState = { fails: 0, down: false, since: null, detail: null };

/** One run: the next state, what changed, and whether a reminder is due. */
export function step(
  prev: MonitorState,
  results: CheckResult[],
  now: Date,
): { next: MonitorState; transitions: Transition[]; remind: boolean } {
  const nowIso = now.toISOString();
  const checks: Record<string, CheckState> = {};
  const transitions: Transition[] = [];

  for (const r of results) {
    const s = prev.checks[r.name] ?? FRESH;
    if (r.ok) {
      if (s.down) {
        const since = s.since ? Date.parse(s.since) : now.getTime();
        transitions.push({ kind: "recovered", name: r.name, url: r.url, downForMs: now.getTime() - since });
      }
      checks[r.name] = FRESH;
      continue;
    }
    const fails = Math.min(s.fails + 1, FAILS_TO_ALERT);
    const since = s.since ?? nowIso;
    if (!s.down && fails >= FAILS_TO_ALERT) {
      transitions.push({ kind: "down", name: r.name, url: r.url, since, detail: r.detail });
      checks[r.name] = { fails, down: true, since, detail: r.detail };
    } else {
      // Still down, or not down yet: keep the detail it was called down with,
      // so a long outage does not rewrite the state every minute.
      checks[r.name] = { fails, down: s.down, since, detail: s.down ? s.detail : r.detail };
    }
  }

  const anyDown = Object.values(checks).some((c) => c.down);
  const alerted = transitions.some((t) => t.kind === "down");
  const remind =
    !alerted &&
    anyDown &&
    prev.lastNotifiedAt !== null &&
    now.getTime() - Date.parse(prev.lastNotifiedAt) >= REMIND_EVERY_MS;

  const lastNotifiedAt = !anyDown ? null : alerted || remind ? nowIso : prev.lastNotifiedAt;
  return { next: { checks, lastNotifiedAt }, transitions, remind };
}

/** Whether two states differ (the only time state is written back). */
export function changed(a: MonitorState, b: MonitorState): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** "3 h 12 min", "4 min", "45 s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export type Email = { subject: string; text: string };

/** The email for a run with transitions or a reminder, or null when there is nothing to say. */
export function composeStatusEmail(
  transitions: Transition[],
  remind: boolean,
  state: MonitorState,
  results: CheckResult[],
): Email | null {
  if (transitions.length === 0 && !remind) return null;
  const down = transitions.filter((t) => t.kind === "down");
  const up = transitions.filter((t) => t.kind === "recovered");
  const stillDown = results.filter((r) => state.checks[r.name]?.down);

  const subject =
    down.length > 0
      ? `DOWN: ${down.map((t) => t.name).join(", ")}`
      : up.length > 0 && stillDown.length === 0
        ? `RECOVERED: ${up.map((t) => t.name).join(", ")}`
        : up.length > 0
          ? `RECOVERED: ${up.map((t) => t.name).join(", ")} (still down: ${stillDown.map((r) => r.name).join(", ")})`
          : `STILL DOWN: ${stillDown.map((r) => r.name).join(", ")}`;

  const lines: string[] = [];
  for (const t of down) {
    lines.push(`DOWN  ${t.name}`, `      ${t.url}`, `      ${t.detail}, failing since ${t.since}`, "");
  }
  for (const t of up) {
    lines.push(`UP    ${t.name}`, `      ${t.url}`, `      back after ${formatDuration(t.downForMs)}`, "");
  }
  if (remind && transitions.length === 0) {
    for (const r of stillDown) {
      const s = state.checks[r.name];
      lines.push(`STILL DOWN  ${r.name}`, `      ${r.url}`, `      ${r.detail}, failing since ${s?.since ?? "?"}`, "");
    }
  }
  lines.push("Every check, this minute:");
  for (const r of results) lines.push(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}: ${r.detail}`);
  lines.push(
    "",
    `A check is called down after ${FAILS_TO_ALERT} failed runs in a row (one a minute), and recovered on its first good run.`,
    "Sent by the squareshare-uptime Cloudflare Worker (ops/uptime in SQ-store).",
  );
  return { subject: `[Square Share] ${subject}`, text: lines.join("\n") };
}

/** The app's error report (src/lib/ops/report-error.ts), as far as the email needs it. */
export type ErrorReport = {
  digest?: string | null;
  name?: string;
  message?: string;
  route?: string;
  kind?: string;
  method?: string;
  at?: string;
};

/** Whether an error report may be emailed now, given when the last one was. */
export function errorEmailDue(lastSentAt: string | null, now: Date): boolean {
  return lastSentAt === null || now.getTime() - Date.parse(lastSentAt) >= ERROR_EMAIL_WINDOW_MS;
}

/** Only the fields the app sends, each a short string: never a stack, a path or a body. */
export function cleanErrorReport(input: unknown): ErrorReport | null {
  if (typeof input !== "object" || input === null) return null;
  const src = input as Record<string, unknown>;
  const out: ErrorReport = {};
  for (const key of ["digest", "name", "message", "route", "kind", "method", "at"] as const) {
    const v = src[key];
    if (typeof v === "string") out[key] = v.slice(0, key === "message" ? 500 : 200);
  }
  return out.message || out.name ? out : null;
}

export function composeErrorEmail(report: ErrorReport): Email {
  const where = [report.method, report.route].filter(Boolean).join(" ") || "unknown route";
  return {
    subject: `[Square Share] Server error: ${(report.name ?? "Error").slice(0, 60)} on ${where.slice(0, 80)}`,
    text: [
      "The dashboard hit an error it could not handle.",
      "",
      `What:   ${report.name ?? "Error"}: ${report.message ?? ""}`,
      `Where:  ${where} (${report.kind ?? "?"})`,
      `When:   ${report.at ?? "?"}`,
      `Digest: ${report.digest ?? "none"} (the code the user saw on the error page)`,
      "",
      `At most one of these emails every ${ERROR_EMAIL_WINDOW_MS / 60000} minutes: any further errors in that window are only in the logs.`,
      'Every error is logged in Workers Logs for squareshare-dashboard, one line each, behind the prefix "[server error]".',
    ].join("\n"),
  };
}
