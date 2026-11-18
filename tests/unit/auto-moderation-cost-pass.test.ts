// @vitest-environment node
// Unit tests for cost-pass changes that run in a Node environment:
// warm-up gate (concurrent cold-start cache behaviour) and the sweep's
// wall-clock budget (SWEEP_BUDGET_MS).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PartVerdict } from "@/lib/moderation/auto/policy";

// ---- Mocks for the sweep budget tests ------------------------------------

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      select: vi.fn(),
      upsert: vi.fn(),
      eq: vi.fn(() => ({ maybeSingle: vi.fn() })),
    }),
  }),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));
vi.mock("@/lib/moderation/admin-ping", () => ({ pingAdminModeration: vi.fn() }));

// ---- Static imports (after mocks) ----------------------------------------

import { sweep } from "@/lib/moderation/auto/check";

// ---- Helper shared by warm-up gate tests ---------------------------------

const CLEAN: PartVerdict = { verdict: "clean", ground: null, paths: [] };

/** Build a fake parse response with the given parsed output. */
function answer(parsed: PartVerdict | null, stopReason = "end_turn") {
  return {
    stop_reason: stopReason,
    parsed_output: parsed,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as never;
}

// =========================================================================
// Finding 2: warm-up gate
//
// A prompt-cache entry becomes readable only after the first response STARTS.
// When several concurrent callers all fire cold, they all miss the cache and
// each pay full input price. The gate serialises only the first call after a
// cold gap: one caller goes alone, then all waiters are released.
// =========================================================================

describe("warm-up gate (prompt-cache cold start)", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    // Remove any prototype spies set up inside the tests.
    vi.restoreAllMocks();
  });

  it("first caller proceeds; concurrent callers wait and are released on settle", async () => {
    // Reset module state so lastCallFinishedAt = 0 (cold start, gate fires).
    // Re-import Anthropic first so the spy covers the same prototype the
    // freshly loaded classify.ts will use.
    vi.resetModules();
    const { default: FreshAnthropic } = await import("@anthropic-ai/sdk");
    const { classifyText } = await import("@/lib/moderation/auto/classify");

    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => { resolveFirst = r; });

    const spy = vi.spyOn(FreshAnthropic.Messages.prototype, "parse");
    // First call hangs until resolveFirst(); subsequent ones resolve immediately.
    spy.mockImplementationOnce(() => firstDone.then(() => answer(CLEAN)));
    spy.mockImplementation(() => Promise.resolve(answer(CLEAN)));

    process.env.ANTHROPIC_API_KEY = "test-key";

    const p1 = classifyText("product", ["title=Mug A"]);
    const p2 = classifyText("product", ["title=Mug B"]);

    // Let both async bodies start: p1 hits its parse await; p2 hits warmUpGate.
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(spy).toHaveBeenCalledTimes(1); // only p1 got to call parse

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(spy).toHaveBeenCalledTimes(2); // p2 got its call after gate released
  });

  it("waiters proceed even when the warm-up caller fails (no deadlock)", async () => {
    vi.resetModules();
    const { default: FreshAnthropic } = await import("@anthropic-ai/sdk");
    const { classifyText } = await import("@/lib/moderation/auto/classify");

    let rejectFirst!: (err: Error) => void;
    const firstDone = new Promise<never>((_, r) => { rejectFirst = r; });

    const spy = vi.spyOn(FreshAnthropic.Messages.prototype, "parse");
    spy.mockImplementationOnce(() => firstDone);
    spy.mockImplementation(() => Promise.resolve(answer(CLEAN)));

    process.env.ANTHROPIC_API_KEY = "test-key";

    const p1 = classifyText("product", ["title=Mug A"]);
    const p2 = classifyText("product", ["title=Mug B"]);

    await new Promise<void>((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);

    // First call fails: the finally block must still release p2.
    rejectFirst(new Error("connection reset"));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBeNull();     // first caller failed and returned null
    expect(r2).not.toBeNull(); // second caller was released and answered
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// Finding 4: sweep wall-clock budget (SWEEP_BUDGET_MS)
//
// The GitHub Actions workflow gives the sweep curl 60 s. Each classifier call
// can take up to CLASSIFY_TIMEOUT_MS = 12 s, so a full batch of 8 rows with
// all-cold caches could take 96 s. SWEEP_BUDGET_MS = 40 s stops starting new
// rows early enough that the last started row can still finish.
// =========================================================================

describe("sweep wall-clock budget (SWEEP_BUDGET_MS)", () => {
  beforeEach(() => rpc.mockReset());

  it("stops starting new rows once the budget is exceeded and sets more:true", async () => {
    rpc.mockImplementation((fnName: string) => {
      if (fnName === "moderation_due") {
        // Three rows; limit is SWEEP_BATCH=8 so none are trimmed, but the
        // time budget cuts us off after the first row.
        return Promise.resolve({
          data: [
            { target_type: "product", target_id: "a" },
            { target_type: "product", target_id: "b" },
            { target_type: "product", target_id: "c" },
          ],
          error: null,
        });
      }
      // moderation_claim returns null: row is already gone (simplest path
      // through checkTarget, no classifier calls needed).
      return Promise.resolve({ data: null, error: null });
    });

    // sweepStart = Date.now() call 1 -> 0.
    // Budget check for row "a" = call 2 -> 0  (0 - 0 = 0 < 40000, row starts).
    // Budget check for row "b" = call 3 -> 50000 (50000 > 40000, loop breaks).
    let nowCalls = 0;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() =>
      ++nowCalls >= 3 ? 50_000 : 0,
    );

    const report = await sweep();

    // Only row "a" was started (budgetExceeded after its check ran).
    expect(report.checked).toBe(1);
    // budgetExceeded -> more:true regardless of settledAny.
    expect(report.more).toBe(true);

    dateNow.mockRestore();
  });
});
