// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter's fail-closed contract, exercised rather than grepped for.
 *
 * Every auth entry point (sign-in, sign-up, magic link, password reset) asks
 * this module for permission BEFORE it touches a credential or sends mail. If
 * a broken limiter answered "yes", every one of those budgets would quietly
 * stop existing at exactly the moment something is already going wrong.
 */

const adminRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: adminRpc }),
}));

const sessionRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: sessionRpc }),
}));

import { RATE_LIMITS, clientKey, rateLimit, rateLimitKey } from "@/lib/rate-limit";

const BUDGET = RATE_LIMITS.authSignInPerClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rateLimitKey - the anonymous-surface limiter", () => {
  it("allows only on an explicit true", async () => {
    adminRpc.mockResolvedValue({ data: true, error: null });
    expect(await rateLimitKey("1.2.3.4", "auth_signin_client", BUDGET)).toBe(true);
  });

  it("denies when the RPC returns an error", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await rateLimitKey("1.2.3.4", "auth_signin_client", BUDGET)).toBe(false);
  });

  it("denies when the call throws outright", async () => {
    adminRpc.mockRejectedValue(new Error("connection refused"));
    expect(await rateLimitKey("1.2.3.4", "auth_signin_client", BUDGET)).toBe(false);
  });

  it("denies a null/undefined answer rather than reading it as allowed", async () => {
    for (const data of [null, undefined, 0, ""]) {
      adminRpc.mockResolvedValue({ data, error: null });
      expect(await rateLimitKey("1.2.3.4", "a", BUDGET), String(data)).toBe(false);
    }
  });

  it("denies an empty key instead of sharing one bucket for everyone", async () => {
    expect(await rateLimitKey("", "auth_signin_client", BUDGET)).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("never sends the raw identifier to the database", async () => {
    // The limiter must not become a log of who tried to sign in from where.
    adminRpc.mockResolvedValue({ data: true, error: null });
    await rateLimitKey("someone@example.com", "auth_email_address", BUDGET);

    const [, args] = adminRpc.mock.calls[0];
    expect(args.p_key).not.toContain("someone@example.com");
    expect(args.p_key).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });
});

describe("rateLimit - the signed-in limiter", () => {
  it("allows only on an explicit true", async () => {
    sessionRpc.mockResolvedValue({ data: true, error: null });
    expect(await rateLimit("settings_write", RATE_LIMITS.settingsWrite)).toBe(true);
  });

  it("denies on error and on throw", async () => {
    sessionRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await rateLimit("settings_write", RATE_LIMITS.settingsWrite)).toBe(false);

    sessionRpc.mockRejectedValue(new Error("down"));
    expect(await rateLimit("settings_write", RATE_LIMITS.settingsWrite)).toBe(false);
  });

  it("never passes a caller-supplied identity", async () => {
    // Identity comes from auth.uid() inside Postgres, so one user can neither
    // spend nor inspect another's budget.
    sessionRpc.mockResolvedValue({ data: true, error: null });
    await rateLimit("settings_write", RATE_LIMITS.settingsWrite);

    const [, args] = sessionRpc.mock.calls[0];
    expect(Object.keys(args)).toEqual(["p_action", "p_max", "p_window_seconds"]);
  });
});

describe("the budgets themselves", () => {
  it("bounds every credential-bearing auth surface", async () => {
    // Named explicitly so deleting one fails here rather than silently.
    for (const key of [
      "authSignInPerClient",
      "authSignUpPerClient",
      "authEmailPerAddress",
      "authEmailPerClient",
      "usernameResolvePerClient",
      "passwordReauth",
      "passwordReset",
    ] as const) {
      expect(RATE_LIMITS[key], key).toBeDefined();
      expect(RATE_LIMITS[key].max, key).toBeGreaterThan(0);
      expect(RATE_LIMITS[key].windowSeconds, key).toBeGreaterThan(0);
    }
  });

  it("keeps the sign-in brake tight enough to matter", async () => {
    // A brute-force brake is only one if the ceiling is low. 10 tries per
    // 15 minutes is ~40/hour, far under any useful guessing rate.
    expect(RATE_LIMITS.authSignInPerClient.max).toBeLessThanOrEqual(15);
    expect(RATE_LIMITS.authSignInPerClient.windowSeconds).toBeGreaterThanOrEqual(600);
  });

  it("keeps reset mail to an address scarcer than sign-in attempts", async () => {
    // Reset mail lands in someone else's inbox, so it is the more abusable of
    // the two and must not be the looser budget.
    expect(RATE_LIMITS.authEmailPerAddress.max).toBeLessThan(
      RATE_LIMITS.authSignInPerClient.max,
    );
  });
});

describe("clientKey", () => {
  it("prefers the header the edge sets over the one a client can forge", async () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(await clientKey(headers)).toBe("203.0.113.9");
  });

  it("falls back to a constant when no header is present", async () => {
    // Documented consequence: on localhost every caller shares one bucket.
    expect(await clientKey(new Headers())).toBe("unknown-client");
  });
});
