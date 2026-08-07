// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: (name: string) =>
    name === "cf-connecting-ip" ? "203.0.113.9" : null,
  }),
  // A SUCCESSFUL sign-in records which method was used before redirecting, so
  // the cookie jar has to exist for any test that gets that far. Built inside
  // the factory: vi.mock is hoisted above every top-level binding.
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
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

/** The service-role client, which is the ONLY way to reach email_by_username
 *  and username_taken: neither is granted to anon or authenticated. */
const adminRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: adminRpc }),
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

function signInForm(identifier: string, password = "correct-horse") {
  return form({ intent: "signin", identifier, password });
}

/** Satisfies the strength rule, so these tests exercise what they claim to. */
const STRONG = "Kettle-Boat-99";

function signUpForm(fields: Record<string, string> = {}) {
  return form({
    intent: "signup",
    identifier: "new@user.com",
    username: "builderboy",
    password: STRONG,
    confirm_password: STRONG,
    ...fields,
  });
}

/** Deny only the named rate-limit action, so the budgets can be told apart. */
function denyOnly(action: string) {
  rateLimitKeyMock.mockImplementation(async (_key: string, taken: string) =>
    taken !== action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitKeyMock.mockResolvedValue(true);
  adminRpc.mockResolvedValue({ data: null, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  auth.signOut.mockResolvedValue({ error: null });
});

// ==========================================================================
// Signing in with a username
// ==========================================================================

describe("username sign-in - resolution", () => {
  it("resolves the handle to an account email and signs in with that", async () => {
    adminRpc.mockResolvedValue({ data: "real@user.com", error: null });

    await expect(
      authenticate({}, signInForm("builderboy")),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(adminRpc).toHaveBeenCalledWith("email_by_username", {
      p_username: "builderboy",
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "real@user.com",
      password: "correct-horse",
    });
  });

  it("normalizes case before resolving, matching the DB's lower() index", async () => {
    adminRpc.mockResolvedValue({ data: "real@user.com", error: null });

    await expect(
      authenticate({}, signInForm("  BuilderBoy  ")),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(adminRpc).toHaveBeenCalledWith("email_by_username", {
      p_username: "builderboy",
    });
  });

  it("treats anything with an @ as an email and never resolves it", async () => {
    await expect(
      authenticate({}, signInForm("someone@example.com")),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(adminRpc).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "someone@example.com",
      password: "correct-horse",
    });
  });

  it("still signs in by email when the identifier arrives under the old name", async () => {
    // PasswordResetModal and any cached form markup still post `email`.
    await expect(
      authenticate({}, form({ intent: "signin", email: "old@field.com", password: "x" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "old@field.com",
      password: "x",
    });
  });
});

describe("username sign-in - handle enumeration", () => {
  it("answers an unknown handle with the SAME string as a wrong password", async () => {
    // The whole point: a handle is public, so "no such handle" must be
    // indistinguishable from "wrong password" or the login box becomes a
    // free oracle for which handles are real.
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "nope" },
    });
    const wrongPassword = await authenticate({}, signInForm("someone@example.com"));

    adminRpc.mockResolvedValue({ data: null, error: null });
    const unknownHandle = await authenticate({}, signInForm("nobodyhasthis"));

    expect(unknownHandle.error).toBe(wrongPassword.error);
    expect(unknownHandle.error).toBe("Incorrect email or password.");
  });

  it("answers a failed LOOKUP the same way too, so an outage is not a signal", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await authenticate({}, signInForm("builderboy"));

    expect(result.error).toBe("Incorrect email or password.");
  });

  it("still spends a full password round trip on a handle nobody holds", async () => {
    // Returning early would make the miss measurably faster than a wrong
    // password, handing back by the clock what the message refuses to say.
    adminRpc.mockResolvedValue({ data: null, error: null });

    await authenticate({}, signInForm("nobodyhasthis"));

    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    const { email } = auth.signInWithPassword.mock.calls[0][0];
    expect(email).not.toContain("nobodyhasthis");
    expect(email).toMatch(/\.invalid$/);
  });

  it("uses a fresh probe address every time", async () => {
    // A constant one would eventually trip Supabase's own per-address
    // throttle and start answering "too many attempts" instead, which is the
    // oracle back again in a different costume.
    adminRpc.mockResolvedValue({ data: null, error: null });

    await authenticate({}, signInForm("nobodyhasthis"));
    await authenticate({}, signInForm("norhasanyonethis"));

    const [first, second] = auth.signInWithPassword.mock.calls.map((c) => c[0].email);
    expect(first).not.toBe(second);
  });

  it("never sends an impossible handle to the database", async () => {
    // Two characters cannot be a handle, so it cannot match a row. Rejecting
    // it here leaks nothing: the shape rule is public.
    const result = await authenticate({}, signInForm("ab"));

    expect(adminRpc).not.toHaveBeenCalled();
    expect(result.error).toBe("Incorrect email or password.");
  });
});

describe("username sign-in - rate limiting", () => {
  it("spends the resolve budget ON TOP of the sign-in budget", async () => {
    adminRpc.mockResolvedValue({ data: "real@user.com", error: null });

    await expect(
      authenticate({}, signInForm("builderboy")),
    ).rejects.toBeInstanceOf(RedirectSignal);

    const actions = rateLimitKeyMock.mock.calls.map((call) => call[1]);
    expect(actions).toContain("auth_signin_client");
    expect(actions).toContain("auth_username_resolve");
  });

  it("does not spend the resolve budget when an email was typed", async () => {
    await expect(
      authenticate({}, signInForm("someone@example.com")),
    ).rejects.toBeInstanceOf(RedirectSignal);

    const actions = rateLimitKeyMock.mock.calls.map((call) => call[1]);
    expect(actions).toContain("auth_signin_client");
    expect(actions).not.toContain("auth_username_resolve");
  });

  it("stops at the resolve budget without touching the auth service", async () => {
    denyOnly("auth_username_resolve");

    const result = await authenticate({}, signInForm("builderboy"));

    expect(result.error).toMatch(/too many attempts/i);
    expect(adminRpc).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("charges the resolve budget even for an unusable handle", async () => {
    // Otherwise a flood of nonsense probes the endpoint for free.
    await authenticate({}, signInForm("ab"));

    const actions = rateLimitKeyMock.mock.calls.map((call) => call[1]);
    expect(actions).toContain("auth_username_resolve");
  });
});

// ==========================================================================
// Claiming a username at sign-up
// ==========================================================================

describe("username sign-up - claiming the handle", () => {
  it("carries the handle as metadata so the trigger claims it in one transaction", async () => {
    // Never a follow-up UPDATE: when the address already belongs to someone,
    // GoTrue does not insert, so metadata is discarded rather than stapling a
    // handle onto an account this signer-up does not control.
    await authenticate({}, signUpForm({ username: "BuilderBoy" }));

    const [args] = auth.signUp.mock.calls[0];
    expect(args.options.data).toEqual({ username: "builderboy" });
  });

  it("refuses a handle someone already holds, before creating anything", async () => {
    adminRpc.mockResolvedValue({ data: true, error: null });

    const result = await authenticate({}, signUpForm());

    expect(result.error).toMatch(/taken/i);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("goes ahead when the availability check itself fails", async () => {
    // The check is a nicety; profiles_username_lower_idx is the real guard, so
    // a broken check must not block a legitimate signup.
    adminRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await authenticate({}, signUpForm());

    expect(auth.signUp).toHaveBeenCalled();
  });

  it("rejects reserved handles", async () => {
    for (const reserved of ["admin", "support", "squareshare"]) {
      const result = await authenticate({}, signUpForm({ username: reserved }));
      expect(result.error, reserved).toMatch(/reserved/i);
    }
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("refuses a weak password before creating anything", async () => {
    for (const weak of ["password123", "short1!", "kettleboat", "P@ssw0rd"]) {
      const result = await authenticate(
        {},
        signUpForm({ password: weak, confirm_password: weak }),
      );
      expect(result.error, weak).toBeTruthy();
    }
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("refuses a password that is just the handle being claimed", async () => {
    // The handle is public, so this would be an attacker's first free guess.
    const result = await authenticate(
      {},
      signUpForm({ password: "Builderboy-1", confirm_password: "Builderboy-1" }),
    );
    expect(result.error).toMatch(/must not contain your email address or username/i);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects a badly shaped handle before spending any budget", async () => {
    for (const bad of ["ab", "has spaces", "Bad-Hyphen", "x".repeat(31), "héllo"]) {
      const result = await authenticate({}, signUpForm({ username: bad }));
      expect(result.error, bad).toBeTruthy();
    }
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(rateLimitKeyMock).not.toHaveBeenCalled();
  });

  it("never prints the raw database error when the index rejects a late collision", async () => {
    // A trigger exception arrives as unexpected_failure carrying the Postgres
    // text, index name included. That must not reach the user.
    auth.signUp.mockResolvedValue({
      error: {
        code: "unexpected_failure",
        message:
          'duplicate key value violates unique constraint "profiles_username_lower_idx"',
      },
    });

    const result = await authenticate({}, signUpForm());

    expect(result.error).not.toMatch(/profiles_username_lower_idx/);
    expect(result.error).toMatch(/different username/i);
  });
});

describe("username sign-up - the email is still the account", () => {
  it("refuses a handle where an address is required", async () => {
    for (const intent of ["signup", "magic", "reset"]) {
      const result = await authenticate(
        {},
        form({
          intent,
          identifier: "builderboy",
          username: "builderboy",
          password: "correct-horse",
          confirm_password: "correct-horse",
        }),
      );
      expect(result.error, intent).toMatch(/valid email address/i);
    }
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Rate limiting: every credential-bearing entry point is bounded
// ==========================================================================

describe("auth rate limits", () => {
  it("bounds SIGN-IN before the password is ever checked", async () => {
    denyOnly("auth_signin_client");

    const result = await authenticate({}, signInForm("someone@example.com"));

    expect(result.error).toMatch(/too many attempts/i);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("bounds SIGN-UP per client as well as per address", async () => {
    denyOnly("auth_signup_client");
    expect((await authenticate({}, signUpForm())).error).toMatch(/too many attempts/i);
    expect(auth.signUp).not.toHaveBeenCalled();

    vi.clearAllMocks();
    adminRpc.mockResolvedValue({ data: null, error: null });
    denyOnly("auth_email_address");
    expect((await authenticate({}, signUpForm())).error).toMatch(/too many attempts/i);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("bounds the RESET mail on the target address, not just the sender", async () => {
    // The address budget is the one that matters: an attacker aiming reset mail
    // at someone else's inbox cannot dodge it by changing IP or clearing
    // cookies, the way a client-keyed limit alone could be dodged.
    denyOnly("auth_email_address");
    const result = await authenticate({}, form({ intent: "reset", email: "a@b.com" }));

    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    // Still the success copy — see the enumeration test below.
    expect(result.message).toBe(RESET_REPLY);
  });

  it("bounds the MAGIC link on both budgets too", async () => {
    for (const action of ["auth_email_address", "auth_email_client"]) {
      vi.clearAllMocks();
      denyOnly(action);
      const result = await authenticate({}, form({ intent: "magic", email: "a@b.com" }));
      expect(result.error, action).toMatch(/too many attempts/i);
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
    }
  });

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
