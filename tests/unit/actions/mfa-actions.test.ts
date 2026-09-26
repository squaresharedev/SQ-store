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
  remainingRecoveryCodes: vi.fn(),
  discardPendingFactors: vi.fn(),
  requireStepUpState: vi.fn(),
  alertTwoFactorChange: vi.fn(),
}));
vi.mock("@/lib/auth/mfa", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/mfa")>();
  return {
    STEP_UP_FIELDS: real.STEP_UP_FIELDS,
    SECOND_FACTOR_ERRORS: real.SECOND_FACTOR_ERRORS,
    pickFactor: real.pickFactor,
    ...Object.fromEntries(
      Object.entries(mfa).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
    ),
  };
});

// The passkey building blocks (WebAuthn verification, sealed storage, the
// factor completion) are pinned in passkey-primitives and the e2e spec; here
// they are stand-ins, and what is pinned is each passkey action's contract.
const pk = vi.hoisted(() => ({
  passkeysConfigured: vi.fn(),
  registrationOptions: vi.fn(),
  credentialIdsFor: vi.fn(),
  verifyRegistration: vi.fn(),
  storePasskey: vi.fn(),
  forgetPasskey: vi.fn(),
  completeFactor: vi.fn(),
  authenticationOptions: vi.fn(),
  verifyAssertion: vi.fn(),
}));
vi.mock("@/lib/auth/passkeys", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/passkeys")>();
  return {
    parseCredential: real.parseCredential,
    ...Object.fromEntries(
      Object.entries(pk).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
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
// Completing the challenge is where sign-in completes for an enrolled account,
// so it is where the account's language reaches a new browser.
const localeSyncMock = vi.fn();
const writeLocaleMock = vi.fn();
vi.mock("@/i18n/sign-in", () => ({
  localeForSignedInBrowser: (...args: unknown[]) => localeSyncMock(...args),
}));
vi.mock("@/i18n/cookie", () => ({
  readLocaleCookieValue: async () => undefined,
  writeLocaleCookie: (...args: unknown[]) => writeLocaleMock(...args),
}));

import {
  beginPasskeySetup,
  beginTwoFactorSetup,
  cancelTwoFactorSetup,
  confirmPasskeySetup,
  verifyPasskeySignIn,
  confirmIdentity,
  confirmTwoFactorSetup,
  regenerateRecoveryCodes,
  removeAuthenticator,
  signInWithRecoveryCode,
  verifyTwoFactorSignIn,
} from "@/lib/auth/mfa-actions";
import { invalidInput, type ActionState } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { english } from "../../setup/translate";

// ---- fixtures -------------------------------------------------------------

/** What requireStepUpState answers when it wants a code first. */
const CODE_PLEASE: ActionState = {
  error: invalidInput(msg("Errors.stepUp.codeRequired")),
  stepUp: true,
};

/** The English a state's error shows. */
function errorText(state: ActionState): string | undefined {
  return state.error ? english(state.error.message) : undefined;
}

/** The English a state's success shows. */
function successText(state: ActionState): string | undefined {
  return state.success ? english(state.success) : undefined;
}

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

function state(
  kind: string,
  opts: { enrolled?: boolean; signedInAt?: number; factors?: unknown[]; google?: boolean } = {},
) {
  const enrolled = opts.enrolled ?? true;
  return {
    kind,
    user: {
      id: USER_ID,
      email: "seller@example.com",
      factors: opts.factors ?? (enrolled ? [verifiedFactor] : []),
      identities: opts.google ? [{ provider: "google" }] : [{ provider: "email" }],
      app_metadata: { providers: opts.google ? ["google"] : ["email"] },
    },
    assurance: {
      enrolled,
      level: kind === "needs_mfa" ? "aal1" : "aal2",
      secondFactorAt: null,
      // An hour ago by default: long enough that the password (not a fresh
      // sign-in) is what proves it's them. Setup tests about recency set it.
      signedInAt: opts.signedInAt ?? now() - 3600,
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
  mfa.remainingRecoveryCodes.mockResolvedValue(0);
  mfa.requireStepUpState.mockResolvedValue(null);
  mfa.alertTwoFactorChange.mockResolvedValue(undefined);
  mfa.discardPendingFactors.mockResolvedValue(undefined);
  hasPasswordMock.mockResolvedValue(true);
  checkPasswordMock.mockResolvedValue("correct");
  rateLimitMock.mockResolvedValue(true);
  unenrollMock.mockResolvedValue({ data: {}, error: null });
  localeSyncMock.mockResolvedValue(null);
  writeLocaleMock.mockResolvedValue(undefined);
});

// ---- the sign-in challenge ------------------------------------------------

describe("verifyTwoFactorSignIn", () => {
  it("verifies a code for a session that owes one, then names where to go next", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    // Returned, not redirected: the page plays its success mark, then goes.
    const result = await verifyTwoFactorSignIn({}, form({ code: "123 456", next: "/orders" }));
    expect(result).toEqual({ verified: { next: "/orders" } });
    expect(mfa.verifySecondFactor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, factorId: FACTOR, code: "123456", context: "sign_in" }),
    );
  });

  it("never sends anyone off-site or back into the sign-in pages", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/login/two-factor"]) {
      const result = await verifyTwoFactorSignIn({}, form({ code: "123456", next }));
      expect(result.verified).toEqual({ next: "/" });
    }
  });

  it("a wrong code returns the message and does not redirect", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await verifyTwoFactorSignIn({}, form({ code: "000000", next: "/" }));
    expect(errorText(result)).toMatch(/didn't work/);
    expect(localeSyncMock).not.toHaveBeenCalled();
  });

  it("copies the account's saved language onto a browser with none, once the code is accepted", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    localeSyncMock.mockResolvedValue("cs");
    await verifyTwoFactorSignIn({}, form({ code: "123456", next: "/" }));
    expect(localeSyncMock).toHaveBeenCalledWith(client, USER_ID, undefined);
    expect(writeLocaleMock).toHaveBeenCalledWith("cs");
  });

  it("a failed language sync never fails the sign-in", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    localeSyncMock.mockRejectedValue(new Error("boom"));
    const result = await verifyTwoFactorSignIn({}, form({ code: "123456", next: "/orders" }));
    expect(result.verified).toEqual({ next: "/orders" });
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
    expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "123456", aal: "aal2" })))).toMatch(/unexpected field/i);
    expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "12345" })))).toMatch(/6 digits/);
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

  it("copies the account's saved language onto a browser with none", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue("hash-1");
    localeSyncMock.mockResolvedValue("cs");
    await redirectOf(signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" })));
    expect(localeSyncMock).toHaveBeenCalledWith(client, USER_ID, undefined);
    expect(writeLocaleMock).toHaveBeenCalledWith("cs");
  });

  it("a wrong code is logged as a failed challenge and changes nothing", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue(null);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(errorText(result)).toMatch(/didn't work/);
    expect(recordMock).toHaveBeenCalledWith({ userId: USER_ID, event: "mfa.challenge_failed" });
    expect(mfa.deleteAllFactors).not.toHaveBeenCalled();
  });

  it("gives the code back if the factors could not be removed", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.spendRecoveryCode.mockResolvedValue("hash-1");
    mfa.deleteAllFactors.mockResolvedValue(false);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(errorText(result)).toMatch(/couldn't finish/);
    expect(mfa.restoreRecoveryCode).toHaveBeenCalledWith(USER_ID, "hash-1");
    expect(mfa.clearRecoveryCodes).not.toHaveBeenCalled();
    expect(revokeOthersMock).not.toHaveBeenCalled();
  });

  it("shares the second-factor budget: out of attempts means no code is even looked up", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    mfa.takeSecondFactorAttempt.mockResolvedValue(false);
    const result = await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" }));
    expect(errorText(result)).toMatch(/too many/i);
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
          // Verbatim shape of production GoTrue's payload (SVGo output).
          qr_code:
            'data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n<svg width="231" height="231"\n     xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>',
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

  it("accepts the SVG shapes GoTrue has sent: bare, with a declaration, with a comment", async () => {
    // The comment is the one that broke production: every real setup failed
    // with "We couldn't start setup just now".
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    for (const qr_code of [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'data:image/svg+xml;utf-8,<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n<svg width="231"></svg>',
    ]) {
      enrollMock.mockResolvedValue({
        data: { id: PENDING, type: "totp", totp: { qr_code, secret: "JBSWY3DPEHPK3PXP", uri: "u" } },
        error: null,
      });
      const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
      expect(result.error, qr_code).toBeUndefined();
      expect(result.enrollment?.qrCode, qr_code).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it("refuses a comment that hides something other than an SVG", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    enrollMock.mockResolvedValue({
      data: { id: PENDING, type: "totp", totp: { qr_code: "<!-- x --><script>alert(1)</script>", secret: "X", uri: "u" } },
      error: null,
    });
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    expect(result.enrollment).toBeUndefined();
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: PENDING });
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
    expect(errorText(result)).toMatch(/incorrect/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a missing password enrolls nothing (a stolen session cannot enrol its own phone)", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(errorText(result)).toMatch(/current password/);
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
    mfa.requireStepUpState.mockResolvedValue(CODE_PLEASE);
    const result = await beginTwoFactorSetup({}, form({ name: "Tablet" }));
    expect(mfa.requireStepUpState).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result).toEqual(CODE_PLEASE);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a sign-in in the last few minutes is proof on its own: no password asked", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 60 }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(result.enrollment).toBeDefined();
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("a sign-in just over the window no longer counts", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 11 * 60 }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(errorText(result)).toMatch(/current password/i);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a GOOGLE account with an old password on file: a wrong password points at Google, not at the password", async () => {
    // The case that shipped broken: Google sign-in, a forgotten password hash
    // on file, and a password prompt the person could not satisfy.
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, google: true }));
    checkPasswordMock.mockResolvedValue("incorrect");
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "my-google-pw" }));
    expect(result).toMatchObject({ reauth: true });
    expect(errorText(result)).toMatch(/Confirm with Google/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("a GOOGLE account without a typed password is offered Google, not refused flatly", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, google: true }));
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(result).toMatchObject({ reauth: true });
    expect(errorText(result)).toMatch(/Confirm with Google/);
    expect(checkPasswordMock).not.toHaveBeenCalled();
  });

  it("an unreachable password check is never reported as a wrong password", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    checkPasswordMock.mockResolvedValue("unavailable");
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8", current_password: "pw" }));
    expect(errorText(result)).toMatch(/couldn't check your password/i);
    expect(errorText(result)).not.toMatch(/incorrect/i);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("never starts turning 2FA on while the recovery-code store is unreachable", async () => {
    // e.g. deployed before the migration: 2FA without recovery codes would
    // turn a lost phone into a locked account.
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 60 }));
    mfa.remainingRecoveryCodes.mockResolvedValue(null);
    const result = await beginTwoFactorSetup({}, form({ name: "Pixel 8" }));
    expect(errorText(result)).toMatch(/isn't available/);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("refuses a name already in use without asking GoTrue", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await beginTwoFactorSetup({}, form({ name: "phone" }));
    expect(errorText(result)).toMatch(/already have/);
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
    expect(errorText(result)).toMatch(/expired/);
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
      expect(errorText(result), factor_id).toMatch(/start again/i);
    }
    expect(mfa.verifySecondFactor).not.toHaveBeenCalled();
  });

  it("a wrong first code leaves 2FA off and says why", async () => {
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, factors: [pendingFactor] }),
    );
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    const result = await confirmTwoFactorSetup({}, form({ factor_id: PENDING, code: "000000" }));
    expect(errorText(result)).toMatch(/didn't match/);
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
    mfa.requireStepUpState.mockResolvedValue(CODE_PLEASE);
    const result = await removeAuthenticator({}, form({ factor_id: FACTOR }));
    expect(mfa.requireStepUpState).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result).toEqual(CODE_PLEASE);
    expect(unenrollMock).not.toHaveBeenCalled();
  });

  it("removing the LAST one turns 2FA off: codes voided, owner alerted", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await removeAuthenticator({}, form({ factor_id: FACTOR, mfa_code: "123456" }));
    expect(unenrollMock).toHaveBeenCalledWith({ factorId: FACTOR });
    expect(mfa.clearRecoveryCodes).toHaveBeenCalledWith(USER_ID);
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(expect.anything(), "mfa.disabled", expect.anything());
    expect(successText(result)).toBe("Two-factor authentication is off.");
  });

  it("refuses a factor that is not on the account", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await removeAuthenticator(
      {},
      form({ factor_id: "c0000000-0000-4000-8000-00000000000c", mfa_code: "123456" }),
    );
    expect(errorText(result)).toMatch(/isn't on your account/);
    expect(unenrollMock).not.toHaveBeenCalled();
  });
});

describe("regenerateRecoveryCodes", () => {
  it("demands a fresh code, then returns the new set and alerts", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in"));
    const result = await regenerateRecoveryCodes({}, form({ mfa_code: "123456" }));
    expect(mfa.requireStepUpState).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
    expect(result.codes).toEqual(["aaaa-bbbb-cccc-dddd"]);
    expect(successText(result)).toBe("New recovery codes ready. Your old ones no longer work.");
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(
      expect.anything(),
      "mfa.recovery_codes_regenerated",
      expect.anything(),
    );
  });

  it("is refused to an account without 2FA", async () => {
    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    const result = await regenerateRecoveryCodes({}, form({}));
    expect(errorText(result)).toMatch(/turn on/i);
    expect(mfa.issueRecoveryCodes).not.toHaveBeenCalled();
  });
});

describe("confirmIdentity", () => {
  it("passes a step-up refusal straight back, so the form keeps its code field", async () => {
    mfa.requireStepUpState.mockResolvedValue(CODE_PLEASE);
    expect(await confirmIdentity({}, form({}))).toEqual(CODE_PLEASE);
    expect(mfa.requireStepUpState).toHaveBeenCalledWith(expect.any(FormData));
  });

  it("confirms once the code is accepted", async () => {
    expect(successText(await confirmIdentity({}, form({ mfa_code: "123456" })))).toBe("Confirmed.");
  });
});

// ---- the words ---------------------------------------------------------------

/**
 * Every refusal and confirmation these actions give, as a reader sees it in
 * English. The actions return message keys now; what they SAY must not have
 * moved by a character, including the deliberately identical wording for a
 * wrong recovery code and one that could never be a code.
 */
describe("English is unchanged", () => {
  it("the sign-in challenge", async () => {
    sessionStateMock.mockResolvedValue({ kind: "unreachable" });
    expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "123456" })))).toBe(
      "We couldn't reach the sign-in service. Check your connection and try again.",
    );
    sessionStateMock.mockResolvedValue({ kind: "signed_out" });
    const expired = await verifyTwoFactorSignIn({}, form({ code: "123456" }));
    expect(errorText(expired)).toBe("Your sign-in expired. Sign in again.");
    expect(expired.error?.code).toBe("session_expired");

    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "123456", aal: "aal2" })))).toBe(
      'Unexpected field "aal" was rejected.',
    );
    expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "12345" })))).toBe(
      "The code is the 6 digits shown in your authenticator app.",
    );
    expect(
      errorText(
        await verifyTwoFactorSignIn(
          {},
          form({ code: "123456", factor_id: "c0000000-0000-4000-8000-00000000000c" }),
        ),
      ),
    ).toBe("Pick one of your authenticator apps.");

    const reasons = {
      invalid: "That code didn't work. Check your authenticator app and try again.",
      rate_limited: "Too many attempts. Wait a few minutes, then try again.",
      replayed: "That code has already been used. Wait for the next one in your app.",
      unavailable: "We couldn't check that code just now. Try again in a moment.",
    };
    for (const [reason, text] of Object.entries(reasons)) {
      mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason });
      expect(errorText(await verifyTwoFactorSignIn({}, form({ code: "123456" }))), reason).toBe(text);
    }
  });

  it("recovery-code sign-in", async () => {
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    expect(errorText(await signInWithRecoveryCode({}, form({ recovery_code: "  " })))).toBe(
      "Enter one of your recovery codes.",
    );

    // A code too long to be one, and a code that is simply wrong, read the same.
    const wrong = "That recovery code didn't work. Check it and try again.";
    expect(errorText(await signInWithRecoveryCode({}, form({ recovery_code: "x".repeat(65) })))).toBe(
      wrong,
    );
    mfa.spendRecoveryCode.mockResolvedValue(null);
    expect(errorText(await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" })))).toBe(
      wrong,
    );

    mfa.spendRecoveryCode.mockResolvedValue("hash-1");
    mfa.deleteAllFactors.mockResolvedValue(false);
    expect(errorText(await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" })))).toBe(
      "We couldn't finish signing you in. Try the same code again in a moment.",
    );

    mfa.takeSecondFactorAttempt.mockResolvedValue(false);
    expect(errorText(await signInWithRecoveryCode({}, form({ recovery_code: "aaaa-bbbb-cccc-dddd" })))).toBe(
      "Too many attempts. Wait a few minutes, then try again.",
    );
  });

  it("starting setup", async () => {
    const begin = (fields: Record<string, string>) => beginTwoFactorSetup({}, form(fields));
    sessionStateMock.mockResolvedValue(state("needs_mfa"));
    expect(errorText(await begin({ name: "Pixel 8" }))).toBe("Your sign-in expired. Sign in again.");

    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    expect(errorText(await begin({ name: "" }))).toBe("The name is required.");
    expect(errorText(await begin({ name: "x".repeat(41) }))).toBe(
      "The name must be 40 characters or fewer.",
    );
    expect(errorText(await begin({ name: "Pixel 8" }))).toBe(
      "Enter your current password to continue.",
    );
    expect(errorText(await begin({ name: "Pixel 8", current_password: "x".repeat(73) }))).toBe(
      "Current password is incorrect.",
    );
    checkPasswordMock.mockResolvedValue("unavailable");
    expect(errorText(await begin({ name: "Pixel 8", current_password: "pw" }))).toBe(
      "We couldn't check your password just now. Try again in a moment.",
    );
    rateLimitMock.mockImplementation(async (action: string) => action !== "password_reauth");
    expect(errorText(await begin({ name: "Pixel 8", current_password: "pw" }))).toBe(
      "Too many attempts. Wait a few minutes before trying again.",
    );

    hasPasswordMock.mockResolvedValue(false);
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, signedInAt: now() - 3600 }),
    );
    expect(errorText(await begin({ name: "Pixel 8" }))).toBe(
      "For your security, sign in again before turning on two-factor authentication.",
    );

    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, signedInAt: now() - 60 }),
    );
    rateLimitMock.mockImplementation(async (action: string) => action !== "mfa_enroll");
    expect(errorText(await begin({ name: "Pixel 8" }))).toBe(
      "That's a lot of setup attempts. Try again a bit later.",
    );

    rateLimitMock.mockResolvedValue(true);
    sessionStateMock.mockResolvedValue(state("signed_in"));
    expect(errorText(await begin({ name: "PHONE" }))).toBe(
      "You already have an authenticator with that name. Pick another.",
    );
    const enrollFailures = {
      mfa_factor_name_conflict: "You already have an authenticator with that name. Pick another.",
      too_many_enrolled_mfa_factors:
        "This account has as many authenticators as it can hold. Remove one first.",
      unexpected_failure: "We couldn't start setup just now. Try again in a moment.",
    };
    for (const [code, text] of Object.entries(enrollFailures)) {
      enrollMock.mockResolvedValue({ data: null, error: { code, message: "no" } });
      expect(errorText(await begin({ name: "Tablet" })), code).toBe(text);
    }
  });

  it("finishing setup", async () => {
    const confirm = (fields: Record<string, string>) => confirmTwoFactorSetup({}, form(fields));
    sessionStateMock.mockResolvedValue(
      state("signed_in", { enrolled: false, factors: [pendingFactor] }),
    );
    expect(errorText(await confirm({ factor_id: "nope", code: "123456" }))).toBe(
      "Setup expired. Start again.",
    );
    expect(errorText(await confirm({ factor_id: PENDING, code: "12 34" }))).toBe(
      "The code is the 6 digits shown in your authenticator app.",
    );
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(errorText(await confirm({ factor_id: PENDING, code: "000000" }))).toBe(
      "That code didn't match. Make sure your app shows Square Share, then enter the newest code.",
    );
    mfa.verifySecondFactor.mockResolvedValue({ ok: false, reason: "replayed" });
    expect(errorText(await confirm({ factor_id: PENDING, code: "000000" }))).toBe(
      "That code has already been used. Wait for the next one in your app.",
    );
  });

  it("managing it", async () => {
    const twoFactors = state("signed_in");
    twoFactors.assurance.factors.push({
      id: PENDING,
      name: "Tablet",
      type: "totp",
      createdAt: "2026-09-02T00:00:00Z",
    });
    sessionStateMock.mockResolvedValue(twoFactors);
    const removed = await removeAuthenticator({}, form({ factor_id: PENDING, mfa_code: "123456" }));
    expect(successText(removed)).toBe('Removed "Tablet".');
    expect(mfa.alertTwoFactorChange).toHaveBeenCalledWith(
      expect.anything(),
      "mfa.factor_removed",
      expect.anything(),
    );

    expect(
      errorText(await removeAuthenticator({}, form({ factor_id: "nope", mfa_code: "123456" }))),
    ).toBe("That authenticator isn't on your account.");

    unenrollMock.mockResolvedValue({ data: null, error: { code: "x", message: "no" } });
    expect(errorText(await removeAuthenticator({}, form({ factor_id: FACTOR, mfa_code: "123456" })))).toBe(
      "We couldn't remove that authenticator. Try again.",
    );

    rateLimitMock.mockResolvedValue(false);
    const changes = "That's a lot of changes in a short time. Try again a bit later.";
    expect(errorText(await removeAuthenticator({}, form({ factor_id: FACTOR, mfa_code: "123456" })))).toBe(
      changes,
    );
    expect(errorText(await regenerateRecoveryCodes({}, form({ mfa_code: "123456" })))).toBe(changes);

    rateLimitMock.mockResolvedValue(true);
    mfa.issueRecoveryCodes.mockResolvedValue(null);
    expect(errorText(await regenerateRecoveryCodes({}, form({ mfa_code: "123456" })))).toBe(
      "We couldn't create new codes. Your old ones still work.",
    );

    sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
    expect(errorText(await regenerateRecoveryCodes({}, form({})))).toBe(
      "Turn on two-factor authentication first.",
    );
  });
});

// ---- passkeys ---------------------------------------------------------------

const CREDENTIAL = JSON.stringify({ id: "cred-1", type: "public-key", response: {} });
const PASSKEY_SECRET = "JBSWY3DPEHPK3PXP";

describe("passkeys", () => {
  beforeEach(() => {
    for (const fn of Object.values(pk)) fn.mockReset();
    pk.passkeysConfigured.mockResolvedValue(true);
    pk.registrationOptions.mockResolvedValue({ challenge: "reg-challenge", rp: { id: "localhost" } });
    pk.credentialIdsFor.mockResolvedValue(["old-cred"]);
    pk.verifyRegistration.mockResolvedValue({
      ok: true,
      passkey: {
        factorId: PENDING,
        secret: PASSKEY_SECRET,
        name: "iPhone",
        credentialId: "cred-1",
        publicKey: "pk",
        signCount: 0,
        transports: ["internal"],
        backedUp: true,
      },
    });
    pk.storePasskey.mockResolvedValue(true);
    pk.forgetPasskey.mockResolvedValue(undefined);
    pk.completeFactor.mockResolvedValue({ ok: true });
    pk.verifyAssertion.mockResolvedValue({ ok: true, factorId: FACTOR, secret: PASSKEY_SECRET });
    enrollMock.mockResolvedValue({
      data: {
        id: PENDING,
        type: "totp",
        totp: { qr_code: "<svg/>", secret: PASSKEY_SECRET, uri: "otpauth://x" },
      },
      error: null,
    });
  });

  describe("beginPasskeySetup", () => {
    it("enrols a factor marked as a passkey and hands the browser options, never the secret", async () => {
      sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 60 }));
      const result = await beginPasskeySetup({}, form({ name: "iPhone" }));

      expect(enrollMock).toHaveBeenCalledWith({
        factorType: "totp",
        friendlyName: "passkey:iPhone",
        issuer: "Square Share",
      });
      expect(pk.registrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          factorId: PENDING,
          secret: PASSKEY_SECRET,
          name: "iPhone",
          excludeCredentialIds: ["old-cred"],
        }),
      );
      expect(result.registration).toEqual({
        factorId: PENDING,
        options: { challenge: "reg-challenge", rp: { id: "localhost" } },
      });
      expect(JSON.stringify(result)).not.toContain(PASSKEY_SECRET);
    });

    it("adding one to an account with 2FA takes an existing factor in THIS request", async () => {
      sessionStateMock.mockResolvedValue(state("signed_in"));
      mfa.requireStepUpState.mockResolvedValue(CODE_PLEASE);
      expect(await beginPasskeySetup({}, form({ name: "iPhone" }))).toEqual(CODE_PLEASE);
      expect(mfa.requireStepUpState).toHaveBeenCalledWith(expect.any(FormData), { maxAgeSeconds: 0 });
      expect(enrollMock).not.toHaveBeenCalled();
    });

    it("refuses when this deployment has no passkeys configured", async () => {
      sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false }));
      pk.passkeysConfigured.mockResolvedValue(false);
      expect(errorText(await beginPasskeySetup({}, form({ name: "iPhone" })))).toMatch(/aren't available/);
      expect(enrollMock).not.toHaveBeenCalled();
    });

    it("withdraws the factor if the options cannot be made", async () => {
      sessionStateMock.mockResolvedValue(state("signed_in", { enrolled: false, signedInAt: now() - 60 }));
      pk.registrationOptions.mockResolvedValue(null);
      expect(errorText(await beginPasskeySetup({}, form({ name: "iPhone" })))).toMatch(/couldn't start setup/);
      expect(unenrollMock).toHaveBeenCalledWith({ factorId: PENDING });
    });
  });

  describe("confirmPasskeySetup", () => {
    const pendingOnly = () =>
      state("signed_in", { enrolled: false, factors: [{ ...pendingFactor, id: PENDING }] });

    it("stores the passkey BEFORE the factor goes live, then issues recovery codes", async () => {
      sessionStateMock.mockResolvedValue(pendingOnly());
      const order: string[] = [];
      pk.storePasskey.mockImplementation(async () => {
        order.push("store");
        return true;
      });
      pk.completeFactor.mockImplementation(async () => {
        order.push("complete");
        return { ok: true };
      });

      const result = await confirmPasskeySetup({}, form({ credential: CREDENTIAL }));

      expect(order).toEqual(["store", "complete"]);
      expect(pk.completeFactor).toHaveBeenCalledWith(client, PENDING, PASSKEY_SECRET);
      expect(revokeOthersMock).toHaveBeenCalled();
      expect(result).toEqual({ done: true, codes: ["aaaa-bbbb-cccc-dddd"] });
    });

    it("a factor that could not go live leaves no passkey behind", async () => {
      sessionStateMock.mockResolvedValue(pendingOnly());
      pk.completeFactor.mockResolvedValue({ ok: false, reason: "unavailable" });
      expect(errorText(await confirmPasskeySetup({}, form({ credential: CREDENTIAL })))).toMatch(
        /couldn't start setup/,
      );
      expect(pk.forgetPasskey).toHaveBeenCalledWith(USER_ID, PENDING);
      expect(unenrollMock).toHaveBeenCalledWith({ factorId: PENDING });
      expect(mfa.issueRecoveryCodes).not.toHaveBeenCalled();
    });

    it("a credential that does not verify stores nothing and switches nothing on", async () => {
      sessionStateMock.mockResolvedValue(pendingOnly());
      pk.verifyRegistration.mockResolvedValue({ ok: false, reason: "invalid" });
      expect(errorText(await confirmPasskeySetup({}, form({ credential: CREDENTIAL })))).toMatch(
        /couldn't check that passkey/,
      );
      expect(pk.storePasskey).not.toHaveBeenCalled();
      expect(pk.completeFactor).not.toHaveBeenCalled();
    });

    it("only for this account's own PENDING factor", async () => {
      // The slip names a factor that is already verified: not a setup any more.
      sessionStateMock.mockResolvedValue(
        state("signed_in", { enrolled: false, factors: [{ ...verifiedFactor, id: PENDING }] }),
      );
      expect(errorText(await confirmPasskeySetup({}, form({ credential: CREDENTIAL })))).toMatch(/expired/);
      expect(pk.storePasskey).not.toHaveBeenCalled();
    });

    it("refuses anything that is not a credential, and any extra field", async () => {
      sessionStateMock.mockResolvedValue(pendingOnly());
      expect(errorText(await confirmPasskeySetup({}, form({ credential: "{}" })))).toMatch(
        /couldn't check that passkey/,
      );
      expect(
        errorText(await confirmPasskeySetup({}, form({ credential: CREDENTIAL, factor_id: PENDING }))),
      ).toMatch(/unexpected field/i);
      expect(pk.verifyRegistration).not.toHaveBeenCalled();
    });
  });

  describe("verifyPasskeySignIn", () => {
    it("completes the factor the passkey unlocked, then names where to go next", async () => {
      sessionStateMock.mockResolvedValue(state("needs_mfa"));
      const result = await verifyPasskeySignIn(
        {},
        form({ credential: CREDENTIAL, slip: "slip", next: "/orders" }),
      );
      expect(result).toEqual({ verified: { next: "/orders" } });
      expect(pk.verifyAssertion).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          purpose: "sign_in",
          slip: "slip",
          verifiedFactorIds: [FACTOR],
        }),
      );
      expect(pk.completeFactor).toHaveBeenCalledWith(client, FACTOR, PASSKEY_SECRET);
    });

    it("a passkey that does not verify is logged like a wrong code, and unlocks nothing", async () => {
      sessionStateMock.mockResolvedValue(state("needs_mfa"));
      pk.verifyAssertion.mockResolvedValue({ ok: false, reason: "invalid" });
      const result = await verifyPasskeySignIn({}, form({ credential: CREDENTIAL, slip: "slip", next: "/" }));
      expect(errorText(result)).toMatch(/didn't work for this account/);
      expect(recordMock).toHaveBeenCalledWith({ userId: USER_ID, event: "mfa.challenge_failed" });
      expect(pk.completeFactor).not.toHaveBeenCalled();
    });

    it("spends the same budget as a code, before checking anything", async () => {
      sessionStateMock.mockResolvedValue(state("needs_mfa"));
      mfa.takeSecondFactorAttempt.mockResolvedValue(false);
      const result = await verifyPasskeySignIn({}, form({ credential: CREDENTIAL, slip: "slip", next: "/" }));
      expect(errorText(result)).toMatch(/too many/i);
      expect(pk.verifyAssertion).not.toHaveBeenCalled();
    });

    it("is only for a session that still owes its second factor", async () => {
      sessionStateMock.mockResolvedValue(state("signed_in"));
      expect(
        await redirectOf(verifyPasskeySignIn({}, form({ credential: CREDENTIAL, slip: "s", next: "/x" }))),
      ).toBe("/x");
      expect(pk.verifyAssertion).not.toHaveBeenCalled();
      sessionStateMock.mockResolvedValue({ kind: "signed_out" });
      expect(
        errorText(await verifyPasskeySignIn({}, form({ credential: CREDENTIAL, slip: "s", next: "/" }))),
      ).toMatch(/expired/);
    });

    it("an assertion without its slip is refused as expired, before any check", async () => {
      sessionStateMock.mockResolvedValue(state("needs_mfa"));
      expect(errorText(await verifyPasskeySignIn({}, form({ credential: CREDENTIAL, next: "/" })))).toMatch(
        /took too long/,
      );
      expect(pk.verifyAssertion).not.toHaveBeenCalled();
    });
  });
});
