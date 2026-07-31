import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

/**
 * The distinction this file guards: "Supabase said you're signed out" vs
 * "Supabase never answered". Conflating them made a network blip redirect a
 * signed-in seller to /login, which reads as a spontaneous logout.
 *
 * auth-js RETURNS its errors instead of throwing them, so the signal is the
 * error's *type*, not whether the call rejected — that subtlety is the whole
 * reason the original try/catch never fired.
 */

const getUserMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...(args as [])),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

// React's `cache` memoizes per request; in a plain test there is no request
// scope, so make it a pass-through and reset mocks between cases instead.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: (fn: unknown) => fn };
});

const loadSession = async () => await import("@/lib/auth/session");

beforeEach(() => {
  vi.resetModules();
  getUserMock.mockReset();
  redirectMock.mockClear();
});

const user = { id: "user-1", email: "seller@example.com" };

describe("requireUser reachability", () => {
  it("returns the user when Supabase answers with a session", async () => {
    getUserMock.mockResolvedValue({ data: { user }, error: null });
    const { requireUser } = await loadSession();

    await expect(requireUser("/")).resolves.toMatchObject({ id: "user-1" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when Supabase answers 'no session'", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    const { requireUser } = await loadSession();

    await expect(requireUser("/settings")).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login?next=%2Fsettings");
  });

  it("throws AuthUnreachableError — never redirects — on a returned network error", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const { requireUser, AuthUnreachableError } = await loadSession();

    await expect(requireUser("/")).rejects.toBeInstanceOf(AuthUnreachableError);
    // The critical assertion: the seller keeps their session.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("throws AuthUnreachableError on a thrown network error too", async () => {
    getUserMock.mockRejectedValue(new TypeError("fetch failed"));
    const { requireUser, AuthUnreachableError } = await loadSession();

    await expect(requireUser("/")).rejects.toBeInstanceOf(AuthUnreachableError);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("bounds the wait instead of inheriting auth-js's 30s retry window", async () => {
    vi.useFakeTimers();
    getUserMock.mockReturnValue(new Promise(() => {})); // never settles
    const { requireUser, AuthUnreachableError } = await loadSession();

    const pending = requireUser("/");
    const assertion = expect(pending).rejects.toBeInstanceOf(AuthUnreachableError);
    await vi.advanceTimersByTimeAsync(6_000);
    await assertion;

    expect(redirectMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("getUser() stays null-on-failure, so optional callers (login page) still render", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const { getUser } = await loadSession();

    await expect(getUser()).resolves.toBeNull();
  });
});
