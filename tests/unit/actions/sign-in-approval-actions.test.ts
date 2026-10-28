// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone's answer to a sign-in approval (decideSignInApproval), when the
 * same tap arrives twice.
 *
 * The phone's page asks again when its request never comes back
 * (lib/resilient-action.ts): in production on 2026-10-28 Cloudflare stopped
 * the Worker mid-request, so a tap could be decided on the server while its
 * answer was lost. The second try must then say what the first decided, not
 * "this request has expired", and it must decide nothing itself. The rest of
 * the action's rules are pinned in server-action-security.test.ts and e2e 76.
 */

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const sessionStateMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionState: () => sessionStateMock() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {} }) }));

const approval = vi.hoisted(() => ({
  findApprovalRequest: vi.fn(),
  decideApprovalRequest: vi.fn(),
  prepareApprovalFactor: vi.fn(),
  approvalsEnabled: vi.fn(),
  approvalsConfigured: vi.fn(),
}));
vi.mock("@/lib/auth/sign-in-approval", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/sign-in-approval")>();
  return {
    ...real,
    ...Object.fromEntries(
      Object.entries(approval).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
    ),
  };
});

const alertTwoFactorChangeMock = vi.fn();
vi.mock("@/lib/auth/mfa", () => ({
  STEP_UP_FIELDS: ["mfa_code", "mfa_factor_id", "mfa_passkey", "mfa_passkey_slip"],
  alertTwoFactorChange: (...args: unknown[]) => alertTwoFactorChangeMock(...args),
  requireStepUpState: vi.fn(),
}));
vi.mock("@/lib/auth/passkeys", () => ({ completeFactorWithCode: vi.fn() }));
vi.mock("@/lib/auth/challenge", () => ({ afterChallenge: (v: unknown) => String(v ?? "/"), syncAccountLocale: vi.fn() }));
const alertSecurityEventMock = vi.fn();
vi.mock("@/lib/security/events", () => ({
  alertSecurityEvent: (...args: unknown[]) => alertSecurityEventMock(...args),
  recordSecurityEvent: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: new Proxy({}, { get: () => ({ max: 10, windowSeconds: 60 }) }),
  clientKey: async () => "client",
  rateLimit: async () => true,
  rateLimitKey: async () => true,
}));

const { decideSignInApproval } = await import("@/lib/auth/sign-in-approval-actions");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);
const NOW = Math.floor(Date.now() / 1000);

function signedIn() {
  return {
    kind: "signed_in",
    user: { id: USER_ID, email: "owner@example.com", factors: [] },
    assurance: { enrolled: true, level: "aal2", secondFactorAt: NOW - 60, factors: [], sessionId: "s1" },
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: USER_ID,
    open: true,
    decided: null,
    browser: "Chrome",
    os: "Windows",
    country: null,
    createdAt: new Date().toISOString(),
    matchCode: 42,
    ...overrides,
  };
}

function tap(fields: Record<string, string>) {
  const data = new FormData();
  data.set("token", TOKEN);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return decideSignInApproval({}, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStateMock.mockResolvedValue(signedIn());
  approval.approvalsEnabled.mockResolvedValue(true);
  approval.approvalsConfigured.mockResolvedValue(true);
  approval.prepareApprovalFactor.mockResolvedValue({ factorId: "f1", code: "123456" });
  approval.decideApprovalRequest.mockResolvedValue(true);
});

describe("decideSignInApproval: the same tap again", () => {
  it("approves an open request on the right number", async () => {
    approval.findApprovalRequest.mockResolvedValue(request());
    expect(await tap({ number: "42" })).toEqual({ decided: "approve" });
    expect(approval.decideApprovalRequest).toHaveBeenCalledTimes(1);
  });

  it("reads an approval it already gave as approved, and decides nothing again", async () => {
    approval.findApprovalRequest.mockResolvedValue(request({ open: false, decided: "approved" }));
    expect(await tap({ number: "42" })).toEqual({ decided: "approve" });
    expect(approval.decideApprovalRequest).not.toHaveBeenCalled();
    expect(approval.prepareApprovalFactor).not.toHaveBeenCalled();
    expect(alertTwoFactorChangeMock).not.toHaveBeenCalled();
  });

  it("reads a refusal it already gave as refused, without a second alert", async () => {
    approval.findApprovalRequest.mockResolvedValue(request({ open: false, decided: "denied" }));
    expect(await tap({ decision: "deny" })).toEqual({ decided: "deny" });
    expect(await tap({ number: "17" })).toEqual({ decided: "mismatch" });
    expect(approval.decideApprovalRequest).not.toHaveBeenCalled();
    expect(alertSecurityEventMock).not.toHaveBeenCalled();
  });

  it("never reads a refused request as approved, whatever number is tapped", async () => {
    approval.findApprovalRequest.mockResolvedValue(request({ open: false, decided: "denied" }));
    const answer = await tap({ number: "42" });
    expect(answer.decided).toBeUndefined();
    expect(answer.error?.message).toMatchObject({ key: "Errors.approval.expired" });
  });

  it("never reads an approved request as approved on the wrong number", async () => {
    approval.findApprovalRequest.mockResolvedValue(request({ open: false, decided: "approved" }));
    const answer = await tap({ number: "17" });
    expect(answer.decided).toBeUndefined();
    expect(answer.error?.message).toMatchObject({ key: "Errors.approval.expired" });
  });

  it("says nothing about another account's request", async () => {
    approval.findApprovalRequest.mockResolvedValue(
      request({ open: false, decided: "approved", userId: "33333333-3333-4333-8333-333333333333" }),
    );
    const answer = await tap({ number: "42" });
    expect(answer.decided).toBeUndefined();
    expect(answer.error?.message).toMatchObject({ key: "Errors.approval.expired" });
  });

  it("still reads a request that simply ran out as expired", async () => {
    approval.findApprovalRequest.mockResolvedValue(request({ open: false, decided: null }));
    const answer = await tap({ number: "42" });
    expect(answer.error?.message).toMatchObject({ key: "Errors.approval.expired" });
  });
});
