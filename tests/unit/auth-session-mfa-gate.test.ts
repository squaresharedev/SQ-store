import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE APP GATE for two-factor authentication: a session that has passed its
 * password but not its second factor must read as "nobody" to everything in
 * the app except the challenge page. lib/auth/session.ts is the one place that
 * decides that, so it is pinned here against a faked Supabase client whose
 * user and token can be set per case.
 */

const getUserMock = vi.fn();
const getSessionMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock, getSession: getSessionMock } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error;
  },
}));

// No request scope in a plain test: make React's cache a pass-through.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: (fn: unknown) => fn };
});

const loadSession = async () => await import("@/lib/auth/session");

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(payload)}.sig`;
const now = () => Math.floor(Date.now() / 1000);

const FACTOR = {
  id: "a0000000-0000-4000-8000-00000000000a",
  friendly_name: "Phone",
  factor_type: "totp",
  status: "verified",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const plainUser = { id: "user-1", email: "seller@example.com" };
const enrolledUser = { ...plainUser, factors: [FACTOR] };

function signedInAs(user: object, claims: Record<string, unknown>) {
  getUserMock.mockResolvedValue({ data: { user }, error: null });
  getSessionMock.mockResolvedValue({ data: { session: { access_token: jwt(claims) } } });
}

beforeEach(() => {
  vi.resetModules();
  getUserMock.mockReset();
  getSessionMock.mockReset();
  redirectMock.mockClear();
});

describe("getSessionState", () => {
  it("an account without 2FA is signed in at aal1, exactly as before", async () => {
    signedInAs(plainUser, { aal: "aal1", amr: [{ method: "password", timestamp: now() }] });
    const { getSessionState } = await loadSession();
    expect((await getSessionState()).kind).toBe("signed_in");
  });

  it("an enrolled account at aal1 still owes its second factor", async () => {
    signedInAs(enrolledUser, { aal: "aal1", amr: [{ method: "password", timestamp: now() }] });
    const { getSessionState } = await loadSession();
    expect((await getSessionState()).kind).toBe("needs_mfa");
  });

  it("an enrolled account at aal2 is signed in, with its second-factor time", async () => {
    const t = now() - 30;
    signedInAs(enrolledUser, { aal: "aal2", amr: [{ method: "totp", timestamp: t }] });
    const { getSessionState } = await loadSession();
    const state = await getSessionState();
    expect(state.kind).toBe("signed_in");
    expect(state.kind === "signed_in" && state.assurance.secondFactorAt).toBe(t);
  });

  it("FAILS CLOSED when the token cannot be read: enrolled means 'owes a code'", async () => {
    getUserMock.mockResolvedValue({ data: { user: enrolledUser }, error: null });
    getSessionMock.mockRejectedValue(new Error("storage exploded"));
    const { getSessionState } = await loadSession();
    expect((await getSessionState()).kind).toBe("needs_mfa");
  });

  it("an unverified (abandoned) factor does not turn 2FA on", async () => {
    signedInAs(
      { ...plainUser, factors: [{ ...FACTOR, status: "unverified" }] },
      { aal: "aal1" },
    );
    const { getSessionState } = await loadSession();
    expect((await getSessionState()).kind).toBe("signed_in");
  });
});

describe("the helpers every page and action use", () => {
  it("getUser is NULL for a session that owes its second factor", async () => {
    signedInAs(enrolledUser, { aal: "aal1" });
    const { getUser } = await loadSession();
    expect(await getUser()).toBeNull();
  });

  it("actionUser reports the same session as signed out, not unreachable", async () => {
    signedInAs(enrolledUser, { aal: "aal1" });
    const { actionUser } = await loadSession();
    expect(await actionUser()).toEqual({ user: null, unreachable: false });
  });

  it("getAssurance is null until the second factor is passed", async () => {
    signedInAs(enrolledUser, { aal: "aal1" });
    const { getAssurance } = await loadSession();
    expect(await getAssurance()).toBeNull();
  });

  it("requireUser sends a half-signed-in session to the challenge, carrying where it was going", async () => {
    signedInAs(enrolledUser, { aal: "aal1" });
    const { requireUser } = await loadSession();
    await expect(requireUser("/settings/team")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login/two-factor?next=%2Fsettings%2Fteam");
  });

  it("requireUser still sends a signed-out visitor to /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError", message: "x" } });
    const { requireUser } = await loadSession();
    await expect(requireUser("/")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=%2F");
  });

  it("requireUser returns the user once the second factor is passed", async () => {
    signedInAs(enrolledUser, { aal: "aal2", amr: [{ method: "totp", timestamp: now() }] });
    const { requireUser } = await loadSession();
    await expect(requireUser("/")).resolves.toMatchObject({ id: "user-1" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("a forged-looking aal claim in the payload is only trusted AFTER GoTrue accepted the token", async () => {
    // GoTrue refused the token: whatever its payload says is irrelevant.
    getUserMock.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", message: "bad jwt", status: 403 } });
    getSessionMock.mockResolvedValue({ data: { session: { access_token: jwt({ aal: "aal2" }) } } });
    const { getSessionState } = await loadSession();
    expect((await getSessionState()).kind).toBe("signed_out");
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
