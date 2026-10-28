import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  RETRY_DELAYS_MS,
  SIGN_IN_UNREACHABLE,
  resilientAction,
} from "@/lib/resilient-action";

/**
 * The sign-in screens' server actions, when a request never comes back.
 *
 * In production (2026-10-28) Cloudflare stopped the Worker mid-request again
 * and again during one phone's sign-in approval. Next.js's client turns that
 * 503 into a thrown error, and a thrown error from useActionState took the
 * whole sign-in screen down to the error boundary. These pin the rule that
 * replaced it: ask again, spread out, then answer in place; never retry an
 * answer the server actually gave.
 */

/** What Next.js's client throws when the answer is not the action's own (Cloudflare's 1102 page). */
const stopped = () => new Error("An unexpected response was received from the server.");
/** What fetch throws when the network itself failed. */
const offline = () => new TypeError("Failed to fetch");
/** An error the action threw on the server: it arrives with a digest. */
const thrown = () => Object.assign(new Error("An error occurred in the Server Components render."), { digest: "123" });

type State = { error?: unknown; ok?: true };
const OK: State = { ok: true };
const UNREACHABLE: State = { error: "unreachable" };
/** Short waits, so the tests run in milliseconds; the real schedule is pinned below. */
const QUICK = [1, 1, 1];

/** An action that throws each listed failure in turn, then answers OK. */
function flaky(...failures: Error[]) {
  return vi.fn(async (_prev: State, _data: FormData): Promise<State> => {
    const failure = failures.shift();
    if (failure) throw failure;
    return OK;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resilientAction", () => {
  it("passes the action's answer straight through", async () => {
    const action = flaky();
    const data = new FormData();
    expect(await resilientAction(action, UNREACHABLE, QUICK)({}, data)).toBe(OK);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({}, data);
  });

  it("asks again when the Worker was stopped, and returns the answer that comes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const action = flaky(stopped(), stopped());
    expect(await resilientAction(action, UNREACHABLE, QUICK)({}, new FormData())).toBe(OK);
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("asks again when the network dropped", async () => {
    const action = flaky(offline());
    expect(await resilientAction(action, UNREACHABLE, QUICK)({}, new FormData())).toBe(OK);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("answers in place once the tries run out, instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const action = flaky(...Array.from({ length: 10 }, stopped));
    const answer = await resilientAction(action, UNREACHABLE, QUICK)({}, new FormData());
    expect(answer).toEqual(UNREACHABLE);
    expect(action).toHaveBeenCalledTimes(QUICK.length + 1);
    expect(warn).toHaveBeenCalledWith("[action] gave up after", 4, "tries:", expect.any(String));
  });

  it("hands back a NEW copy each time, so a form sees a second failure as a change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = resilientAction(flaky(...Array.from({ length: 10 }, stopped)), UNREACHABLE, []);
    const first = await run({}, new FormData());
    const second = await run({}, new FormData());
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).not.toBe(UNREACHABLE);
  });

  it("never sends again what the server actually answered with an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const action = flaky(thrown());
    expect(await resilientAction(action, UNREACHABLE, QUICK)({}, new FormData())).toEqual(UNREACHABLE);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("lets a redirect through: it is the action's answer", async () => {
    let redirectError: unknown;
    try {
      redirect("/dashboard");
    } catch (error) {
      redirectError = error;
    }
    const action = vi.fn(async (): Promise<void> => {
      throw redirectError;
    });
    await expect(resilientAction(action, undefined, QUICK)()).rejects.toBe(redirectError);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("lets a page older than the deploy reach the error boundary, which offers a reload", async () => {
    const outdated = new UnrecognizedActionError("Server Action \"abc\" was not found on the server.");
    const action = vi.fn(async (): Promise<void> => {
      throw outdated;
    });
    await expect(resilientAction(action, undefined, QUICK)()).rejects.toBe(outdated);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("with no tries left to give, only keeps the page from going down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const action = flaky(stopped());
    expect(await resilientAction(action, UNREACHABLE, [])({}, new FormData())).toEqual(UNREACHABLE);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("waits on the real schedule by default: spread out, about fifteen seconds in all", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const action = flaky(...Array.from({ length: 10 }, stopped));
      const answer = resilientAction(action, UNREACHABLE)({}, new FormData());
      for (const delay of RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        const before = action.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1);
        expect(action.mock.calls.length).toBe(before + 1);
      }
      expect(await answer).toEqual(UNREACHABLE);
      expect(action).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
      const total = RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
      expect(total).toBeGreaterThanOrEqual(10_000);
      expect(total).toBeLessThanOrEqual(20_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what a sign-in screen shows in the reader's language, not English", () => {
    expect(SIGN_IN_UNREACHABLE.error?.message).toMatchObject({ key: "Errors.mfa.unreachable" });
  });
});
