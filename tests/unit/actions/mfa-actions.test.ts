// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two-factor server actions. The rules they delegate to (budgets, replay,
 * GoTrue calls, recovery-code storage) are faked here and pinned in
 * tests/unit/mfa-step-up.test.ts; what is pinned here is each action's own
 * contract: who may call it, what it refuses, and what it does to the account.
 */

// ---- mocks ---------------------------------------------------------------

class Redirect extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const sessionStateMock = vi.fn();
const revokeOthersMock = vi.fn(async () => undefined);
vi.mock("@/lib/auth/session", () => ({
  getSessionState: () => sessionStateMock(),
  revokeOtherSessions: (...args: unknown[]) => revokeOthersMock(...(args as [])),
}));

const enrollMock = vi.fn();
const unenrollMock = vi.fn();
const signOutMock = vi.fn(async () => ({ error: null }));
const client = { auth: { mfa: { enroll: enrollMock, unenroll: unenrollMock }, signOut: signOutMock } };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

// Hoisted: vi.mock factories run before the rest of the module.
const mfa = vi.hoisted(() => ({
  verifySecondFactor: vi.fn(),
  takeSecondFactorAttempt: vi.fn(),
  spendRecoveryCode: vi.fn(),
  restoreRecoveryCode: vi.fn(),
  deleteAllFactors: vi.fn(),
  clearRecoveryCodes: vi.fn(),
  issueRecoveryCodes: vi.fn(),
  discardPendingFactors: vi.fn(),
  requireStepUp: vi.fn(),
  alertTwoFactorChange: vi.fn(),
}));
vi.mock("@/lib/auth/mfa", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/mfa")>();
  return {
    STEP_UP_FIELDS: real.STEP_UP_FIELDS,
    SECOND_FACTOR_MESSAGES: real.SECOND_FACTOR_MESSAGES,
    pickFactor: real.pickFactor,
    ...Object.fromEntries(
      Object.entries(mfa).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
    ),
  };
});

const hasPasswordMock = vi.fn();
vi.mock("@/lib/auth/has-password", () => ({
  accountHasPassword: (...args: unknown[]) => hasPasswordMock(...args),
}));
const checkPasswordMock = vi.fn();
vi.mock("@/lib/auth/reauth", () => ({
  checkPassword: (...args: unknown[]) => checkPasswordMock(...args),
}));
const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));
const recordMock = vi.fn();
vi.mock("@/lib/security/events", () => ({
  recordSecurityEvent: (...args: unknown[]) => recordMock(...args),
}));

import {
  beginTwoFactorSetup,
  cancelTwoFactorSetup,
  confirmTwoFactorSetup,
  regenerateRecoveryCodes,
  removeAuthenticator,
  signInWithRecoveryCode,
  verifyTwoFactorSignIn,
} from "@/lib/auth/mfa-actions";

// ---- fixtures -------------------------------------------------------------

const USER_ID = "10000000-0000-4000-8000-000000000001";
const FACTOR = "a0000000-0000-4000-8000-00000000000a";
const PENDING = "b0000000-0000-4000-8000-00000000000b";
const now = () => Math.floor(Date.now() / 1000);

const verifiedFactor = {
  id: FACTOR,
  friendly_name: "Phone",
  factor_type: "totp",
  status: "verified",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const pendingFactor = { ...verifiedFactor, id: PENDING, friendly_name: "Tablet", status: "unverified" };

function state(kind: string, opts: { enrolled?: boolean; signedInAt?: number; factors?: unknown[] } = {}) {
  const enrolled = opts.enrolled ?? true;
  return {
    kind,
    user: {
      id: USER_ID,
      email: "seller@example.com",
      factors: opts.factors ?? (enrolled ? [verifiedFactor] : []),
    },
    assurance: {
      enrolled,
      level: kind === "needs_mfa" ? "aal1" : "aal2",
      secondFactorAt: null,
      signedInAt: opts.signedInAt ?? now() - 60,
      factors: enrolled
        ? [{ id: FACTOR, name: "Phone", type: "totp", createdAt: "2026-09-01T00:00:00Z" }]
        : [],
    },
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Redirect) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mfa)) fn.mockReset();
  mfa.verifySecondFactor.mockResolvedValue({ ok: true });
  mfa.takeSecondFactorAttempt.mockResolvedValue(true);
  mfa.deleteAllFactors.mockResolvedValue(true);
  mfa.clearRecoveryCodes.mockResolvedValue(true);
  mfa.issueRecoveryCodes.mockResolvedValue(["aaaa-bbbb-cccc-dddd"]);
  mfa.requireStepUp.mockResolvedValue(null);
  mfa.alertTwoFactorChange.mockResolvedValue(undefined);
  mfa.discardPendingFactors.mockResolvedValue(undefined);
  hasPasswordMock.mockResolvedValue(true);
  checkPasswordMock.mockResolvedValue("correct");
  rateLimitMock.mockResolvedValue(true);
  unenrollMock.mockResolvedValue({ data: {}, error: null });
});

// ---- the sign-in challenge ------------------------------------------------

describe("verifyTwoFactorSignIn", () => {
  it("verifies a code for a session that owes one, then redirects to next", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    const url = await redirectOf(
      verifyTwoFactorSignIn({}, form({ code: "123 456", next: "/orders" })),
    );
    expect(url).toBe("/orders");
    expect(mfa.verifySecondFactor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, factorId: FACTOR, code: "123456", context: "sign_in" }),
    );
  });

  it("never redirects off-site or back into the sign-in pages", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/login/two-factor"]) {
      expect(await redirectOf(verifyTwoFactorSignIn({}, form({ code: "123456", next })))).toBe("/");
    }
  });

  it("a wrong code returns the message and does not redirect", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await verifyTwoFactorSignIn({}, form({ code: "000000", next: "/" }));
    expect(result.error).toMatch(/didn't work/);
  });

  it("a signed-out session is told to sign in again, and nothing is verified", async () => {
    sessionStateMock.mockResolvedValue({ kind: "signed_out" });
    const result = await verifyTwoFactorSignIn({}, form({ code: "123456", next: "/" }));
    expect(result).toMatchObject({ expired: true });
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("an already-verified session is simply sent on", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    expect(await redirectOf(verifyTwoFactorSignIn({}, form({ code: "123456", next: "/products" })))).toBe(
      "/products",
    );
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("rejects unexpected fields and malformed codes before verifying", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    expect((await verifyTwoFactorSignIn({}, form({ code: "123456", aal: "aal2" }))).error).toMatch(/unexpected field/i);
    expect((await verifyTwoFactorSignIn({}, form({ code: "12345" }))).error).toMatch(/6 digits/);
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });
});

// ---- recovery-code sign-in --------------------------------------------------

describe("signInWithRecoveryCode", () => {
  it("spends the code, removes every factor, voids the other codes, signs out other devices, alerts, and lands on setup", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue("hash-1");

    const url = await redirectOf(
      signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd", next: "/" })),
    );

    expect(url).toBe("/settings/security?recovered=1");
    expect(mfa.takeSecondFactorAttempt).toHaveBeenCalledWith(USER_ID, "seller@example.com", "sign_in");
    expect(mfa.deleteAllFactors).toHaveBeenCalledWith(USER_ID);
    expect(mfa.clearRecoveryCodes).toHaveBeenCalledWith(USER_ID);
    expect(revokeOthersMock).toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith({ userId: USER_ID, event: "mfa.disabled" });
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      "mfa.recovery_code_used",
      expect.any(Object),
    );
  });

  it("a wrong code is logged as a failed challenge and changes nothing", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue(null);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(result.error).toMatch(/didn't work/);
    expect(recordMock).toHaveBeenCalledWith({ userId: USER_ID, event: "mfa.challenge_failed" });
    expect(mfa.deleteAllFactors).not.toHaveBeenCalled();
  });

  it("gives the code back if the factors could not be removed", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue("hash-1");
    mfa.deleteAllFactors.mockResolvedValue(false);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(result.error).toMatch(/couldn't finish/);
    expect(mfa.restoreRecoveryCode).toHaveBeenCalledWith(USER_ID, "hash-1");
    expect(mfa.clearRecoveryCodes).not.toHaveBeenCalled();
    expect(revokeOthersMock).not.toHaveBeenCalled();
  });

  it("shares the second-factor budget: out of attempts means no code is even looked up", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.takeSecondFactorAttempt.mockResolvedValue(false);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(result.error).toMatch(/too many/i);
    expect(mfa.spendRecoveryCode).not.toHaveBeenCalled();
  });

  it("is only for a session that owes its second factor", async () => {
    sessionStateMock.mockResolvedValue({ kind: "signed_out" });
    expect(await signInWithRecoveryCode({}, form({ recovery_code: "x" }))).toMatchObject({ expired: true });
    expect(mfa.spendRecoveryCode).not.toHaveBeenCalled();
  });
});

// ---- setup -----------------------------------------------------------------

describe("beginTwoFactorSetup", () => {
  beforeEach(() => {
    enrollMock.mockResolvedValue({
      data: {
        id: PENDING,
        type: "totp",
        totp: {
          qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>',
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://totp/Square%20Share:seller@example.com?secret=JBSWY3DPEHPK3PXP",
        },
      },
      error: null,
    });
  });

  it("first setup with a password: checks it on a throwaway client, then enrolls", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));

    expect(checkPasswordMock).toHaveBeenCalledWith("seller@example.com", "pw");
    expect(rateLimitMock).toHaveBeenCalledWith("password_reauth", expect.anything());
    expect(rateLimitMock).toHaveBeenCalledWith("mfa_enroll", expect.anything());
    expect(enrollMock).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Pixel 8",
      issuer: "Square Share",
    });
    expect(result.enrollment).toMatchObject({ factorId: PENDING, secret: "JBSWY3DPEHPK3PXP" });
  });

  it("re-encodes GoTrue's QR SVG so a '#' cannot cut the data: URL short", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    const qr = result.enrollment!.qrCode;
    expect(qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(qr).not.toContain("#");
    expect(Buffer.from(qr.split(",")[1], "base64").toString()).toContain('fill="#fff"');
  });

  it("refuses a QR payload that is not an SVG, and withdraws the factor", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    enrollMock.mockResolvedValue({
      data: { id: PENDING, type: "totp", totp: { qr_code: "<script>alert(1)</script>", secret: "X", uri: "u" } },
      error: null,
    });
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    expect(result.enrollment).toBeUndefined();
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: PENDING });
  });

  it("a wrong password enrolls nothing", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    checkPasswordMock.mockResolvedValue("incorrect");
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "nope" }));
    expect(result.error).toMatch(/incorrect/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a missing password enrolls nothing (a stolen session cannot enrol its own phone)", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(result.error).toMatch(/current password/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a Google-only account needs a RECENT sign-in instead of a password", async () => {
    hasPasswordMock.mockResolvedValue(false);
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 3600 }));
    const stale = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(stale).toMatchObject({ reauth: true });
    expect(enrollMock).not.toHaveBeenCalled();

    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 60 }));
    const fresh = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(fresh.enrollment).toBeDefined();
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("adding a second authenticator demands a code from an existing one, in this request", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    mfa.requireStepUp.mockResolvedValue({ error: "code please", stepUp: true });
    const result = await beginTwoFactorSetup({}, form({ name: "Tablet" }));
    expect(mfa.requireStepUp).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result).toEqual({ error: "code please", stepUp: true });
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("refuses a name already in use without asking GoTrue", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await beginTwoFactorSetup({}, form({ name: "phone" }));
    expect(result.error).toMatch(/already have/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("clears abandoned setups before starting a new one", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, factors: [pendingFactor] }),
    );
    await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    expect(mfa.discardPendingFactors).toHaveBeenCalledWith(client, [pendingFactor]);
  });

  it("is refused to a session that still owes its second factor", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    expect(result.error).toMatch(/expired/);
    expect(enrollMock).not.toHaveBeenCalled();
  });
});

describe("confirmTwoFactorSetup", () => {
  it("turning 2FA on: verifies, signs out other devices, issues codes, alerts", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, factors: [pendingFactor] }),
    );
    const result = await confirmTwoFactorSetup({}, form({ factor_id: PENDING, code: "123456" }));

    expect(mfa.verifySecondFactor).toHaveBeenCalledWith(
      expect.objectContaining({ factorId: PENDING, code: "123456", context: "setup" }),
    );
    expect(revokeOthersMock).toHaveBeenCalled();
    expect(mfa.issueRecoveryCodes).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual({ done: true, codes: ["aaaa-bbbb-cccc-dddd"] });
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(expect.anything(), "mfa.enabled", expect.anything());
  });

  it("adding another authenticator does not replace the recovery codes", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { factors: [verifiedFactor, pendingFactor] }),
    );
    const result = await confirmTwoFactorSetup({}, form({ factor_id: PENDING, code: "123456" }));
    expect(result).toEqual({ done: true, codes: undefined });
    expect(mfa.issueRecoveryCodes).not.toHaveBeenCalled();
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(expect.anything(), "mfa.factor_added", expect.anything());
  });

  it("never 'confirms' an already-verified factor or someone else's", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { factors: [verifiedFactor, pendingFactor] }),
    );
    for (const factor_id of [FACTOR, "c0000000-0000-4000-8000-00000000000c", "nope"]) {
      const result = await confirmTwoFactorSetup({}, form({ factor_id, code: "123456" }));
      expect(result.error, factor_id).toMatch(/start again/i);
    }
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a wrong first code leaves 2FA off and says why", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, factors: [pendingFactor] }),
    );
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await confirmTwoFactorSetup({}, form({ factor_id: PENDING, code: "000000" }));
    expect(result.error).toMatch(/didn't match/);
    expect(mfa.issueRecoveryCodes).not.toHaveBeenCalled();
    expect(revokeOthersMock).not.toHaveBeenCalled();
  });
});

describe("cancelTwoFactorSetup", () => {
  it("withdraws only the caller's own UNVERIFIED factor", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { factors: [verifiedFactor, pendingFactor] }),
    );
    await cancelTwoFactorSetup(FACTOR);
    await cancelTwoFactorSetup("c0000000-0000-4000-8000-00000000000c");
    expect(unenrollMock).not.toHaveBeenCalled();
    await cancelTwoFactorSetup(PENDING);
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: PENDING });
  });
});

// ---- managing it -----------------------------------------------------------

describe("removeAuthenticator", () => {
  it("always demands a code in the request itself", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    mfa.requireStepUp.mockResolvedValue({ error: "code please", stepUp: true });
    const result = await removeAuthenticator({}, form({ factor_id: FACTOR }));
    expect(mfa.requireStepUp).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result).toEqual({ error: "code please", stepUp: true });
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("removing the LAST one turns 2FA off: codes voided, owner alerted", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await removeAuthenticator({}, form({ factor_id: FACTOR, mfa_code: "123456" }));
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: FACTOR });
    expect(mfa.clearRecoveryCodes).toHaveBeenCalledWith(USER_ID);
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(expect.anything(), "mfa.disabled", expect.anything());
    expect(result.success).toMatch(/off/);
  });

  it("refuses a factor that is not on the account", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await removeAuthenticator(
      {},
      form({ factor_id: "c0000000-0000-4000-8000-00000000000c", mfa_code: "123456" }),
    );
    expect(result.error).toMatch(/isn't on your account/);
    expect(unenrollMock).not.toHaveBeenCalled();
  });
});

describe("regenerateRecoveryCodes", () => {
  it("demands a fresh code, then returns the new set and alerts", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await regenerateRecoveryCodes({}, form({ mfa_code: "123456" }));
    expect(mfa.requireStepUp).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result.codes).toEqual(["aaaa-bbbb-cccc-dddd"]);
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(
      expect.anything(),
      "mfa.recovery_codes_regenerated",
      expect.anything(),
    );
  });

  it("is refused to an account without 2FA", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await regenerateRecoveryCodes({}, form({}));
    expect(result.error).toMatch(/turn on/i);
    expect(mfa.issueRecoveryCodes).not.toHaveBeenCalled();
  });
});
