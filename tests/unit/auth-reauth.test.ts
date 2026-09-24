// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * checkPassword: the throwaway-client password check. The rule under test is
 * the one that shipped wrong: ONLY GoTrue's `invalid_credentials` is a wrong
 * password. Every other refusal (network, throttle, unconfirmed email, a
 * CAPTCHA switched on) must not tell a person their correct password is wrong.
 */

const signInMock = vi.fn();
const signOutMock = vi.fn(async () => ({ error: null }));
const createClientMock = vi.fn(() => ({
  auth: { signInWithPassword: signInMock, signOut: signOutMock },
}));

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

import { checkPassword } from "@/lib/auth/reauth";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("checkPassword", () => {
  it("a right password is correct, and the throwaway session is revoked at once", async () => {
    signInMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await checkPassword("a@b.co", "pw")).toBe("correct");
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });

  it("uses a client that stores nothing (never the caller's session)", async () => {
    signInMock.mockResolvedValue({ data: { session: null }, error: null });
    await checkPassword("a@b.co", "pw");
    const options = (createClientMock.mock.calls[0] as unknown[])[2] as { auth: Record<string, unknown> };
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });

  it("invalid_credentials, and only that, is incorrect", async () => {
    signInMock.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    expect(await checkPassword("a@b.co", "wrong")).toBe("incorrect");
  });

  it("every other refusal is 'unavailable', never 'incorrect'", async () => {
    for (const error of [
      new AuthRetryableFetchError("fetch failed", 0),
      new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
      new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
      new AuthApiError("captcha protection: request disallowed", 400, "captcha_failed"),
      new AuthApiError("boom", 500, "unexpected_failure"),
      new AuthApiError("no code", 400, undefined),
    ]) {
      signInMock.mockResolvedValueOnce({ data: { session: null }, error });
      expect(await checkPassword("a@b.co", "pw"), error.message).toBe("unavailable");
    }
  });

  it("a thrown error is 'unavailable'", async () => {
    signInMock.mockRejectedValue(new Error("socket hang up"));
    expect(await checkPassword("a@b.co", "pw")).toBe("unavailable");
  });

  it("refuses to ask with nothing to ask about", async () => {
    expect(await checkPassword("", "pw")).toBe("unavailable");
    expect(await checkPassword("a@b.co", "")).toBe("unavailable");
    expect(signInMock).not.toHaveBeenCalled();
  });
});
