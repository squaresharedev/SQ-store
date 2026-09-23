// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/auth/mfa.ts: how a second-factor code is checked (budgets, replay guard,
 * GoTrue challenge + verify), how sensitive actions demand one (requireStepUp),
 * and how recovery codes are stored and spent. GoTrue, the rate limiter and
 * the database are faked; the ORDER of the checks and what each refusal does
 * (and does not do) is the thing under test.
 */

// ---- mocks ---------------------------------------------------------------

const sessionStateMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionState: () => sessionStateMock(),
}));

const challengeMock = vi.fn();
const verifyMock = vi.fn();
const unenrollMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { challenge: challengeMock, verify: verifyMock, unenroll: unenrollMock } },
  }),
}));

const rpcMock = vi.fn();
const adminListFactorsMock = vi.fn();
const adminDeleteFactorMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
    auth: {
      admin: { mfa: { listFactors: adminListFactorsMock, deleteFactor: adminDeleteFactorMock } },
    },
  }),
}));

/** Every keyed take, recorded as its action name, so a test can see which
 *  budgets were spent and in what order. */
const takes: string[] = [];
const rateLimitKeyMock = vi.fn(async (_key: string, action: string) => {
  takes.push(action);
  return true;
});
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: (key: string, action: string) => rateLimitKeyMock(key, action),
  clientKey: async () => "203.0.113.9",
}));

const cookieSetMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: cookieSetMock }),
}));

const recordMock = vi.fn(async () => true);
const alertMock = vi.fn(async () => undefined);
vi.mock("@/lib/security/events", () => ({
  recordSecurityEvent: (...args: unknown[]) => recordMock(...(args as [])),
  alertSecurityEvent: (...args: unknown[]) => alertMock(...(args as [])),
}));

import {
  SECOND_FACTOR_MESSAGES,
  deleteAllFactors,
  issueRecoveryCodes,
  pickFactor,
  requireStepUp,
  spendRecoveryCode,
  verifySecondFactor,
} from "@/lib/auth/mfa";
import { hashRecoveryCode, normalizeRecoveryCode } from "@/lib/auth/recovery-codes";
import { STEP_UP_WINDOW_SECONDS } from "@/lib/auth/assurance";

// ---- fixtures -------------------------------------------------------------

const USER = { id: "10000000-0000-4000-8000-000000000001", email: "seller@example.com" };
const FACTOR_A = "a0000000-0000-4000-8000-00000000000a";
const FACTOR_B = "b0000000-0000-4000-8000-00000000000b";
const now = () => Math.floor(Date.now() / 1000);

function signedIn(overrides: Record<string, unknown> = {}) {
  return {
    kind: "signed_in",
    user: USER,
    assurance: {
      enrolled: true,
      level: "aal2",
      secondFactorAt: now() - STEP_UP_WINDOW_SECONDS - 60, // stale by default
      signedInAt: now() - 3600,
      factors: [
        { id: FACTOR_A, name: "Phone", type: "totp" as const, createdAt: "2026-09-01T00:00:00Z" },
        { id: FACTOR_B, name: "Tablet", type: "totp" as const, createdAt: "2026-09-02T00:00:00Z" },
      ],
      ...overrides,
    },
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  takes.length = 0;
  rateLimitKeyMock.mockImplementation(async (_key: string, action: string) => {
    takes.push(action);
    return true;
  });
  sessionStateMock.mockResolvedValue(signedIn());
  challengeMock.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
  verifyMock.mockResolvedValue({ data: {}, error: null });
});

// ---- requireStepUp --------------------------------------------------------

describe("requireStepUp", () => {
  it("lets an account WITHOUT 2FA straight through, no code, no GoTrue", async () => {
    sessionStateMock.mockResolvedValue(signedIn({ enrolled: false, factors: [] }));
    expect(await requireStepUp(form({}))).toBeNull();
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("lets a session with a code from the last few minutes through", async () => {
    sessionStateMock.mockResolvedValue(signedIn({ secondFactorAt: now() - 60 }));
    expect(await requireStepUp(form({}))).toBeNull();
    expect(takes).toEqual([]);
  });

  it("asks for a code once the window has passed", async () => {
    const refusal = await requireStepUp(form({}));
    expect(refusal).toMatchObject({ stepUp: true });
    expect(refusal?.error).toMatch(/6-digit code/);
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("maxAgeSeconds: 0 demands a code even from a session that just gave one", async () => {
    sessionStateMock.mockResolvedValue(signedIn({ secondFactorAt: now() }));
    expect(await requireStepUp(form({}), { maxAgeSeconds: 0 })).toMatchObject({ stepUp: true });
  });

  it("refuses a malformed code without spending an attempt", async () => {
    for (const code of ["12345", "1234567", "abcdef", "١٢٣٤٥٦"]) {
      const refusal = await requireStepUp(form({ mfa_code: code }));
      expect(refusal, code).toMatchObject({ stepUp: true });
    }
    expect(takes).toEqual([]);
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("accepts a code with the space most apps show in the middle", async () => {
    expect(await requireStepUp(form({ mfa_code: "123 456" }))).toBeNull();
    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456", factorId: FACTOR_A }),
    );
  });

  it("checks the code against the factor the form named, if it is the caller's", async () => {
    await requireStepUp(form({ mfa_code: "123456", mfa_factor_id: FACTOR_B }));
    expect(challengeMock).toHaveBeenCalledWith({ factorId: FACTOR_B });
  });

  it("never checks against a factor id that is not the caller's", async () => {
    const stranger = "c0000000-0000-4000-8000-00000000000c";
    const refusal = await requireStepUp(form({ mfa_code: "123456", mfa_factor_id: stranger }));
    expect(refusal?.error).toMatch(/pick one/i);
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("reports a wrong code and keeps the field up", async () => {
    verifyMock.mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", status: 422 } });
    const refusal = await requireStepUp(form({ mfa_code: "000000" }));
    expect(refusal).toEqual({ error: SECOND_FACTOR_MESSAGES.invalid, stepUp: true });
  });

  it("a code that goes through tells the browser (a readable, non-secret hint cookie)", async () => {
    expect(await requireStepUp(form({ mfa_code: "123456" }))).toBeNull();
    expect(cookieSetMock).toHaveBeenCalledWith(
      "ss_step_up_until",
      expect.stringMatching(/^\d+$/),
      expect.objectContaining({ httpOnly: false, maxAge: STEP_UP_WINDOW_SECONDS }),
    );
    const until = Number(cookieSetMock.mock.calls[0][1]);
    expect(Math.abs(until - (now() + STEP_UP_WINDOW_SECONDS))).toBeLessThanOrEqual(2);
  });

  it("a wrong code sets no hint", async () => {
    verifyMock.mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", status: 422 } });
    await requireStepUp(form({ mfa_code: "000000" }));
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("refuses when the session is not fully signed in", async () => {
    sessionStateMock.mockResolvedValue({ kind: "needs_mfa", user: USER, assurance: signedIn().assurance });
    const refusal = await requireStepUp(form({ mfa_code: "123456" }));
    expect(refusal?.error).toMatch(/session expired/i);
    expect(refusal?.stepUp).toBeUndefined();
    expect(challengeMock).not.toHaveBeenCalled();
  });
});

// ---- verifySecondFactor -----------------------------------------------------

describe("verifySecondFactor", () => {
  async function verify(context: "sign_in" | "step_up" | "setup" = "sign_in", code = "123456") {
    const { createClient } = await import("@/lib/supabase/server");
    return verifySecondFactor({
      supabase: (await createClient()) as never,
      userId: USER.id,
      email: USER.email,
      factorId: FACTOR_A,
      code,
      context,
    });
  }

  it("spends the account, daily and client budgets, then the replay key, then asks GoTrue", async () => {
    expect(await verify()).toEqual({ ok: true });
    expect(takes).toEqual([
      "mfa_verify_user",
      "mfa_verify_user_day",
      "mfa_verify_client",
      "mfa_code_replay",
    ]);
    expect(challengeMock).toHaveBeenCalledWith({ factorId: FACTOR_A });
    expect(verifyMock).toHaveBeenCalledWith({
      factorId: FACTOR_A,
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("keys the account budget on the account and the replay key on account + code", async () => {
    await verify();
    const keys = rateLimitKeyMock.mock.calls.map(([key]) => key);
    expect(keys[0]).toBe(`mfa:${USER.id}`);
    expect(keys[3]).toBe(`mfa-code:${USER.id}:123456`);
  });

  it("out of attempts: refused before GoTrue is asked anything", async () => {
    rateLimitKeyMock.mockImplementation(async (_k: string, action: string) => {
      takes.push(action);
      return action !== "mfa_verify_user";
    });
    expect(await verify("step_up")).toEqual({ ok: false, reason: "rate_limited" });
    expect(challengeMock).not.toHaveBeenCalled();
    // A short-window refusal must not also eat the day's allowance.
    expect(takes).toEqual(["mfa_verify_user"]);
  });

  it("a lockout at SIGN-IN alerts the owner (once per hour, by its own key)", async () => {
    rateLimitKeyMock.mockImplementation(async (_k: string, action: string) => {
      takes.push(action);
      return action !== "mfa_verify_user";
    });
    await verify("sign_in");
    expect(takes).toContain("mfa_lockout_alert");
    expect(alertMock).toHaveBeenCalledWith(
      USER.id,
      "mfa.locked_out",
      expect.objectContaining({ emailTo: USER.email }),
    );
  });

  it("does not alert on a lockout during a step-up (the session already passed 2FA)", async () => {
    rateLimitKeyMock.mockImplementation(async (_k: string, action: string) => {
      takes.push(action);
      return action !== "mfa_verify_user";
    });
    await verify("step_up");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("the lockout alert is not repeated inside the hour", async () => {
    rateLimitKeyMock.mockImplementation(async (_k: string, action: string) => {
      takes.push(action);
      return action !== "mfa_verify_user" && action !== "mfa_lockout_alert";
    });
    await verify("sign_in");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("a replayed code is refused before GoTrue", async () => {
    rateLimitKeyMock.mockImplementation(async (_k: string, action: string) => {
      takes.push(action);
      return action !== "mfa_code_replay";
    });
    expect(await verify()).toEqual({ ok: false, reason: "replayed" });
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("a wrong code at sign-in is logged as a failed challenge", async () => {
    verifyMock.mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", status: 422 } });
    expect(await verify("sign_in")).toEqual({ ok: false, reason: "invalid" });
    expect(recordMock).toHaveBeenCalledWith({ userId: USER.id, event: "mfa.challenge_failed" });
  });

  it("a wrong code during setup or step-up is not logged as an attack", async () => {
    verifyMock.mockResolvedValue({ data: null, error: { code: "mfa_verification_failed", status: 422 } });
    await verify("setup");
    await verify("step_up");
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("maps GoTrue's own throttle and outages to their own answers, never 'wrong code'", async () => {
    verifyMock.mockResolvedValueOnce({ data: null, error: { code: "over_request_rate_limit", status: 429 } });
    expect(await verify()).toEqual({ ok: false, reason: "rate_limited" });
    verifyMock.mockResolvedValueOnce({ data: null, error: { code: "unexpected_failure", status: 500 } });
    expect(await verify()).toEqual({ ok: false, reason: "unavailable" });
    challengeMock.mockResolvedValueOnce({ data: null, error: { code: "insufficient_aal", status: 403 } });
    expect(await verify()).toEqual({ ok: false, reason: "unavailable" });
    verifyMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await verify()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("an expired challenge reads as a wrong code (ask again), not an outage", async () => {
    verifyMock.mockResolvedValue({ data: null, error: { code: "mfa_challenge_expired", status: 422 } });
    expect(await verify("step_up")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("pickFactor", () => {
  const assurance = signedIn().assurance;

  it("defaults to the first factor when none is named", () => {
    expect(pickFactor(assurance, null)).toBe(FACTOR_A);
    expect(pickFactor(assurance, "")).toBe(FACTOR_A);
  });

  it("refuses a name that is not a uuid rather than guessing", () => {
    expect(pickFactor(assurance, "phone")).toBeNull();
  });

  it("refuses a well-formed id that is not the caller's", () => {
    expect(pickFactor(assurance, "c0000000-0000-4000-8000-00000000000c")).toBeNull();
  });
});

// ---- recovery codes ---------------------------------------------------------

describe("issueRecoveryCodes", () => {
  it("stores ten salted hashes in ONE atomic replace and returns the plaintext once", async () => {
    rpcMock.mockResolvedValue({ data: 10, error: null });
    const codes = await issueRecoveryCodes(USER.id);
    expect(codes).toHaveLength(10);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe("mfa_replace_recovery_codes");
    expect(args.p_user_id).toBe(USER.id);
    expect(args.p_hashes).toHaveLength(10);
    // What is stored is the hash of each code, never the code.
    for (const [i, code] of codes!.entries()) {
      expect(args.p_hashes[i]).toBe(await hashRecoveryCode(USER.id, normalizeRecoveryCode(code)!));
      expect(JSON.stringify(args)).not.toContain(code);
    }
  });

  it("returns null (old set stays in force) when the store fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await issueRecoveryCodes(USER.id)).toBeNull();
  });
});

describe("spendRecoveryCode", () => {
  it("consumes by hash and hands the hash back on success", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const spent = await spendRecoveryCode(USER.id, "7K2M 9QPX R4TB HC0W");
    const expected = await hashRecoveryCode(USER.id, "7k2m9qpxr4tbhc0w");
    expect(spent).toBe(expected);
    expect(rpcMock).toHaveBeenCalledWith("mfa_consume_recovery_code", {
      p_user_id: USER.id,
      p_hash: expected,
    });
  });

  it("an unknown or already-used code is null", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await spendRecoveryCode(USER.id, "7k2m-9qpx-r4tb-hc0w")).toBeNull();
  });

  it("something that cannot be a code never reaches the database", async () => {
    expect(await spendRecoveryCode(USER.id, "123456")).toBeNull();
    expect(await spendRecoveryCode(USER.id, "x".repeat(10_000))).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("deleteAllFactors", () => {
  it("deletes every factor through the admin API", async () => {
    adminListFactorsMock.mockResolvedValue({
      data: { factors: [{ id: FACTOR_A }, { id: FACTOR_B }] },
      error: null,
    });
    adminDeleteFactorMock.mockResolvedValue({ data: {}, error: null });
    expect(await deleteAllFactors(USER.id)).toBe(true);
    expect(adminDeleteFactorMock).toHaveBeenCalledWith({ id: FACTOR_A, userId: USER.id });
    expect(adminDeleteFactorMock).toHaveBeenCalledWith({ id: FACTOR_B, userId: USER.id });
  });

  it("reports failure if any one deletion fails", async () => {
    adminListFactorsMock.mockResolvedValue({
      data: { factors: [{ id: FACTOR_A }, { id: FACTOR_B }] },
      error: null,
    });
    adminDeleteFactorMock
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    expect(await deleteAllFactors(USER.id)).toBe(false);
  });
});
