import { afterEach, describe, expect, it, vi } from "vitest";
import { checksFor, failureNote, runCheck } from "../../ops/uptime/src/checks";
import {
  EMPTY_STATE,
  ERROR_EMAIL_WINDOW_MS,
  FAILS_TO_ALERT,
  REMIND_EVERY_MS,
  changed,
  cleanErrorReport,
  composeErrorEmail,
  composeStatusEmail,
  errorEmailDue,
  formatDuration,
  step,
  type CheckResult,
  type MonitorState,
} from "../../ops/uptime/src/monitor";

const T0 = new Date("2026-10-21T12:00:00.000Z");
const minute = (n: number) => new Date(T0.getTime() + n * 60_000);
const ok = (name = "Dashboard sign-in"): CheckResult => ({ name, url: `https://x/${name}`, ok: true, detail: "200 in 80 ms" });
const bad = (name = "Dashboard sign-in", detail = "status 502 in 40 ms"): CheckResult => ({
  name,
  url: `https://x/${name}`,
  ok: false,
  detail,
});

/** Run a sequence of minutes, returning every step's output. */
function run(minutes: CheckResult[][], start: MonitorState = EMPTY_STATE) {
  let state = start;
  return minutes.map((results, i) => {
    const out = step(state, results, minute(i));
    state = out.next;
    return out;
  });
}

describe("uptime monitor", () => {
  it("stays quiet for one failed run and calls it down on the second", () => {
    expect(FAILS_TO_ALERT).toBe(2);
    const [first, second] = run([[bad()], [bad()]]);
    expect(first.transitions).toEqual([]);
    expect(composeStatusEmail(first.transitions, first.remind, first.next, [bad()])).toBeNull();
    expect(second.transitions).toEqual([
      { kind: "down", name: "Dashboard sign-in", url: "https://x/Dashboard sign-in", since: T0.toISOString(), detail: "status 502 in 40 ms" },
    ]);
    const email = composeStatusEmail(second.transitions, second.remind, second.next, [bad()]);
    expect(email?.subject).toBe("[Square Share] DOWN: Dashboard sign-in");
    expect(email?.text).toContain("failing since 2026-10-21T12:00:00.000Z");
  });

  it("forgets a single blip", () => {
    const [, recovered] = run([[bad()], [ok()]]);
    expect(recovered.transitions).toEqual([]);
    expect(recovered.next.checks["Dashboard sign-in"]).toEqual({ fails: 0, down: false, since: null, detail: null });
  });

  it("emails a recovery with how long it was down", () => {
    const steps = run([[bad()], [bad()], [bad()], [ok()]]);
    const back = steps[3];
    expect(back.transitions).toEqual([
      { kind: "recovered", name: "Dashboard sign-in", url: "https://x/Dashboard sign-in", downForMs: 3 * 60_000 },
    ]);
    const email = composeStatusEmail(back.transitions, back.remind, back.next, [ok()]);
    expect(email?.subject).toBe("[Square Share] RECOVERED: Dashboard sign-in");
    expect(email?.text).toContain("back after 3 min");
    expect(back.next.lastNotifiedAt).toBeNull();
  });

  it("writes nothing new while an outage simply continues, even if the failure looks different", () => {
    const steps = run([[bad()], [bad()], [bad("Dashboard sign-in", "timed out after 10 s")], [bad()]]);
    expect(changed(steps[1].next, steps[2].next)).toBe(false);
    expect(changed(steps[2].next, steps[3].next)).toBe(false);
    expect(steps[2].transitions).toEqual([]);
  });

  it("reminds every six hours while something stays down, and not in between", () => {
    const down = run([[bad()], [bad()]])[1].next;
    expect(down.lastNotifiedAt).toBe(minute(1).toISOString());
    const early = step(down, [bad()], new Date(minute(1).getTime() + REMIND_EVERY_MS - 1));
    expect(early.remind).toBe(false);
    const due = step(down, [bad()], new Date(minute(1).getTime() + REMIND_EVERY_MS));
    expect(due.remind).toBe(true);
    expect(composeStatusEmail(due.transitions, due.remind, due.next, [bad()])?.subject).toBe(
      "[Square Share] STILL DOWN: Dashboard sign-in",
    );
    expect(due.next.lastNotifiedAt).not.toBe(down.lastNotifiedAt);
  });

  it("names what is still down when one thing recovers and another does not", () => {
    const steps = run([
      [bad("A"), bad("B")],
      [bad("A"), bad("B")],
      [ok("A"), bad("B")],
    ]);
    const mixed = steps[2];
    expect(composeStatusEmail(mixed.transitions, mixed.remind, mixed.next, [ok("A"), bad("B")])?.subject).toBe(
      "[Square Share] RECOVERED: A (still down: B)",
    );
  });

  it("formats durations for people", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration((3 * 60 + 12) * 60_000)).toBe("3 h 12 min");
  });

  it("emails at most one server error per window", () => {
    expect(errorEmailDue(null, T0)).toBe(true);
    expect(errorEmailDue(T0.toISOString(), new Date(T0.getTime() + ERROR_EMAIL_WINDOW_MS - 1))).toBe(false);
    expect(errorEmailDue(T0.toISOString(), new Date(T0.getTime() + ERROR_EMAIL_WINDOW_MS))).toBe(true);
  });

  it("keeps only the fields the app sends from an error report, each short", () => {
    const cleaned = cleanErrorReport({
      digest: "abc123",
      name: "TypeError",
      message: "x".repeat(900),
      route: "/orders",
      kind: "render",
      method: "GET",
      at: "2026-10-21T12:00:00Z",
      stack: "should never travel",
      cookie: "sb-access-token=secret",
    });
    expect(Object.keys(cleaned ?? {}).sort()).toEqual(["at", "digest", "kind", "message", "method", "name", "route"]);
    expect(cleaned?.message).toHaveLength(500);
    expect(cleanErrorReport("nope")).toBeNull();
    expect(cleanErrorReport({ route: "/orders" })).toBeNull();
    const email = composeErrorEmail(cleaned!);
    expect(email.subject).toBe("[Square Share] Server error: TypeError on GET /orders");
    expect(email.text).toContain("Digest: abc123");
  });
});

describe("what the checks call healthy", () => {
  const CLOUDFLARE_1102 = "<title>Worker exceeded resource limits | Cloudflare</title> Error 1102";

  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body = "") => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  const appCheck = () => checksFor("anon").find((check) => check.name === "Dashboard app")!;

  it("watches a signed-in page as a signed-out visitor, healthy when it sends them to sign-in", async () => {
    answer(307);
    expect(await runCheck(appCheck())).toMatchObject({ ok: true, detail: expect.stringMatching(/^307 in /) });
  });

  it("calls a Worker that ran out of resources down, and says so", async () => {
    answer(503, CLOUDFLARE_1102);
    const result = await runCheck(appCheck());
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Cloudflare 1102");
  });

  it("keeps 200 as the healthy answer for a check that names no other", async () => {
    answer(200);
    expect((await runCheck(checksFor("anon")[1])).ok).toBe(true);
    answer(307);
    expect((await runCheck(checksFor("anon")[1])).ok).toBe(false);
  });

  it("reads a healthy page to the end, so the site never logs a dropped connection", async () => {
    let finished = false;
    const page = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<!doctype html><h1>Sign in</h1>"));
        controller.close();
      },
      cancel() {
        throw new Error("the monitor hung up mid-page");
      },
    });
    const body = page.pipeThrough(new TransformStream({ flush: () => void (finished = true) }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    expect((await runCheck(checksFor("anon")[1])).ok).toBe(true);
    expect(finished).toBe(true);
  });

  it("names Cloudflare's own error pages and nothing else", () => {
    expect(failureNote(CLOUDFLARE_1102)).toContain("1102");
    expect(failureNote("Error 1101 Worker threw exception")).toContain("1101");
    expect(failureNote("<html>Bad gateway</html>")).toBe("");
  });
});
