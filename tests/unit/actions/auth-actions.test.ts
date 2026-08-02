// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: (name: string) =>
    name === "cf-connecting-ip" ? "203.0.113.9" : null,
  }),
}));

/** redirect() throws in Next; mimic that so control flow matches production. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const rateLimitKeyMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: (...args: unknown[]) => rateLimitKeyMock(...args),
  clientKey: async () => "test-client",
}));

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));

// ---- imports -------------------------------------------------------------

import { authenticate, resetPassword } from "@/lib/auth/actions";

// ---- helpers -------------------------------------------------------------

const RESET_REPLY = "If that email has an account, a reset link is on its way.";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function resetForm(password: string, confirm = password) {
  return form({ password, confirm_password: confirm });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitKeyMock.mockResolvedValue(true);
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  auth.signOut.mockResolvedValue({ error: null });
});

// ==========================================================================
// Requesting a reset link
// ==========================================================================

describe("password reset request - account enumeration", () => {
  it("gives the same reply whether or not Supabase accepted the address", async () => {
    const sent = await authenticate({}, form({ intent: "reset", email: "a@b.com" }));
    expect(sent.message).toBe(RESET_REPLY);

    // Supabase's errors are address-specific (unknown user, per-address send
    // throttle), so surfacing them would let someone tell real addresses apart.
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { code: "user_not_found", message: "not found" },
    });
    const unknown = await authenticate({}, form({ intent: "reset", email: "a@b.com" }));
    expect(unknown.message).toBe(RESET_REPLY);
    expect(unknown.error).toBeUndefined();

    // Same for its per-address rate limit, which only trips on real accounts.
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "too soon" },
    });
    const throttled = await authenticate({}, form({ intent: "reset", email: "a@b.com" }));
    expect(throttled.message).toBe(RESET_REPLY);
    expect(throttled.error).toBeUndefined();
  });

  it("gives the SAME reply when rate limited, so throttling is not an oracle", async () => {
    // A distinct "slow down" reply would let someone probe addresses by
    // watching which ones start throttling.
    rateLimitKeyMock.mockResolvedValue(false);

    const result = await authenticate({}, form({ intent: "reset", email: "a@b.com" }));

    expect(result.message).toBe(RESET_REPLY);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("requires an email before spending any budget", async () => {
    const result = await authenticate({}, form({ intent: "reset", email: "" }));
    expect(result.error).toMatch(/enter your email/i);
    expect(rateLimitKeyMock).not.toHaveBeenCalled();
  });
});

describe("password reset request - link target", () => {
  it("always lands on /reset-password, ignoring any caller-supplied next", async () => {
    // Otherwise a recovery link could be aimed at another in-app destination.
    await authenticate(
      {},
      form({ intent: "reset", email: "a@b.com", next: "/settings/danger" }),
    );

    const [, options] = auth.resetPasswordForEmail.mock.calls[0];
    expect(options.redirectTo).toContain("/auth/callback");
    expect(options.redirectTo).toContain(encodeURIComponent("/reset-password"));
    expect(options.redirectTo).not.toContain("danger");
  });

  it("cannot be pointed off-origin through next", async () => {
    await authenticate(
      {},
      form({ intent: "reset", email: "a@b.com", next: "https://evil.example" }),
    );
    const [, options] = auth.resetPasswordForEmail.mock.calls[0];
    expect(options.redirectTo).not.toContain("evil.example");
  });
});

// ==========================================================================
// Setting the new password
// ==========================================================================

describe("resetPassword - session requirement", () => {
  it("refuses when the recovery link left no session", async () => {
    // An expired or already-used link must not silently no-op.
    auth.getUser.mockResolvedValue({ data: { user: null } });

    const result = await resetPassword({}, resetForm("new-password-1"));

    expect(result.error).toMatch(/expired/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("resetPassword - validation", () => {
  it("rejects a short password before touching the session", async () => {
    const result = await resetPassword({}, resetForm("short"));
    expect(result.error).toMatch(/8 characters/i);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects a password beyond the bcrypt input limit", async () => {
    const result = await resetPassword({}, resetForm("x".repeat(73)));
    expect(result.error).toMatch(/72 characters/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation", async () => {
    const result = await resetPassword({}, resetForm("new-password-1", "different-1"));
    expect(result.error).toMatch(/do not match/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("resetPassword - session revocation", () => {
  it("revokes OTHER sessions after a successful reset", async () => {
    // Recovery is the flow people use when they think someone else is in
    // their account, so the old credential's sessions must not survive it.
    await expect(resetPassword({}, resetForm("new-password-1"))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("keeps the recovery session alive, so the redirect lands signed in", async () => {
    await expect(resetPassword({}, resetForm("new-password-1"))).rejects.toBeInstanceOf(
      RedirectSignal,
    );
    const scopes = auth.signOut.mock.calls.map((call) => call[0]?.scope);
    expect(scopes).toEqual(["others"]);
  });

  it("does not revoke anything when the update fails", async () => {
    auth.updateUser.mockResolvedValue({
      error: { code: "weak_password", message: "too weak" },
    });

    const result = await resetPassword({}, resetForm("new-password-1"));

    expect(result.error).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("still completes the reset if revocation itself fails", async () => {
    // The credential has already changed by then; a revoke failure must not
    // present as "your reset did not work".
    auth.signOut.mockResolvedValue({ error: { message: "network" } });

    await expect(resetPassword({}, resetForm("new-password-1"))).rejects.toBeInstanceOf(
      RedirectSignal,
    );
  });
});
