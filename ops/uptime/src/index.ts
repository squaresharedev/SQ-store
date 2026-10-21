// squareshare-uptime: watches every public surface once a minute and emails
// when something goes down, when it comes back, and every six hours while it
// stays down. Also the dashboard's error collector (ERROR_REPORT_URL): one
// email per server error, at most one per quarter hour.
//
// Mail goes through Brevo's SMTP relay (src/lib/email/smtp.ts, shared with the app). State lives in one KV key,
// written only when it changes, so a long outage costs no writes.
//
// Deploy: `npx wrangler deploy --config ops/uptime/wrangler.jsonc` from the
// repo root. Secrets: SMTP_USER, SMTP_PASS (a Brevo SMTP login), REPORT_TOKEN
// (shared with the dashboard as ERROR_REPORT_TOKEN, also guards /status and
// /test-alert).
import { checksFor, runCheck } from "./checks";
import {
  EMPTY_STATE,
  changed,
  cleanErrorReport,
  composeErrorEmail,
  composeStatusEmail,
  errorEmailDue,
  step,
  type Email,
  type MonitorState,
} from "./monitor";
import { BREVO_SMTP_HOST, BREVO_SMTP_PORT, sendMail } from "../../../src/lib/email/smtp";
import type { ExecutionContext, KVNamespace, ScheduledController } from "./worker-types";

type Env = {
  STATE: KVNamespace;
  ALERT_TO: string;
  ALERT_FROM: string;
  ALERT_FROM_NAME: string;
  SUPABASE_ANON_KEY: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  REPORT_TOKEN: string;
};

const STATE_KEY = "monitor-state";
const ERRORS_KEY = "error-email-last-sent";
const REPORT_MAX_BYTES = 4096;

async function mail(env: Env, email: Email): Promise<void> {
  await sendMail(
    { host: BREVO_SMTP_HOST, port: BREVO_SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
    {
      fromName: env.ALERT_FROM_NAME,
      fromAddress: env.ALERT_FROM,
      to: env.ALERT_TO.split(",").map((a) => a.trim()).filter(Boolean),
      subject: email.subject,
      text: email.text,
    },
  );
}

async function readState(env: Env): Promise<MonitorState> {
  const raw = await env.STATE.get(STATE_KEY);
  if (!raw) return EMPTY_STATE;
  try {
    return JSON.parse(raw) as MonitorState;
  } catch {
    return EMPTY_STATE;
  }
}

async function runOnce(env: Env, now: Date) {
  const results = await Promise.all(checksFor(env.SUPABASE_ANON_KEY).map(runCheck));
  const prev = await readState(env);
  const { next, transitions, remind } = step(prev, results, now);
  const email = composeStatusEmail(transitions, remind, next, results);
  if (email) {
    try {
      await mail(env, email);
    } catch (error) {
      // Keep the old state so the next run tries the email again.
      console.error("[uptime] alert email failed:", error instanceof Error ? error.message : error);
      return { results, transitions, emailed: false };
    }
  }
  if (changed(prev, next)) await env.STATE.put(STATE_KEY, JSON.stringify(next));
  for (const r of results) if (!r.ok) console.warn(`[uptime] ${r.name}: ${r.detail}`);
  return { results, transitions, emailed: Boolean(email) };
}

/** Constant-time comparison of a request's bearer token. */
function authorized(request: Request, env: Env): boolean {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const want = env.REPORT_TOKEN ?? "";
  if (want.length < 32 || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (body.length > REPORT_MAX_BYTES) return new Response("too large", { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("not JSON", { status: 400 });
  }
  const report = cleanErrorReport(parsed);
  if (!report) return new Response("not an error report", { status: 400 });
  console.error("[uptime] error report:", JSON.stringify(report));
  const now = new Date();
  if (!errorEmailDue(await env.STATE.get(ERRORS_KEY), now)) {
    return Response.json({ emailed: false, reason: "an error email went out in the last 15 minutes" }, { status: 202 });
  }
  await env.STATE.put(ERRORS_KEY, now.toISOString());
  try {
    await mail(env, composeErrorEmail(report));
    return Response.json({ emailed: true }, { status: 202 });
  } catch (error) {
    console.error("[uptime] error email failed:", error instanceof Error ? error.message : error);
    return Response.json({ emailed: false, reason: "mail failed" }, { status: 502 });
  }
}

const worker = {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runOnce(env, new Date()).then(() => undefined));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!authorized(request, env)) return new Response("not found", { status: 404 });

    if (request.method === "POST" && pathname === "/report") return handleReport(request, env);

    if (request.method === "GET" && pathname === "/status") {
      return Response.json(await readState(env));
    }

    if (request.method === "POST" && pathname === "/check") {
      return Response.json(await runOnce(env, new Date()));
    }

    if (request.method === "POST" && pathname === "/test-alert") {
      const results = await Promise.all(checksFor(env.SUPABASE_ANON_KEY).map(runCheck));
      await mail(env, {
        subject: "[Square Share] Monitoring is on (test email)",
        text: [
          "This is a test from the Square Share uptime monitor. Nothing is wrong.",
          "",
          "From now on, every minute, these are checked:",
          ...results.map((r) => `  ${r.ok ? "ok  " : "FAIL"}  ${r.name}: ${r.url} (${r.detail})`),
          "",
          "You get an email when one fails twice in a row, another when it is back, and a reminder every 6 hours while it stays down.",
          "Server errors in the dashboard are emailed too, at most one every 15 minutes.",
        ].join("\n"),
      });
      return Response.json({ sent: true });
    }

    return new Response("not found", { status: 404 });
  },
};

export default worker;
