// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";

/**
 * Mirrors the shape pinned for lib/moderation and the rate limiter: OFF unless
 * explicitly configured, and FAILS CLOSED once it is. The one thing that must
 * never happen is a signup sailing through because Cloudflare (or our own
 * fetch to it) had a bad day.
 */

const originalFetch = global.fetch;

beforeEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
});

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("turnstileEnabled", () => {
  it("is off with no secret configured", () => {
    expect(turnstileEnabled()).toBe(false);
  });

  it("is on once a secret is set", () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    expect(turnstileEnabled()).toBe(true);
  });
});

describe("verifyTurnstile", () => {
  it("passes everything when unconfigured, even an empty token", async () => {
    global.fetch = vi.fn();
    expect(await verifyTurnstile("")).toBe(true);
    expect(await verifyTurnstile("anything")).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an empty token once configured, without calling Cloudflare", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn();
    expect(await verifyTurnstile("")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes only on an explicit success:true from siteverify", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    expect(await verifyTurnstile("good-token")).toBe(true);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("secret")).toBe("test-secret");
    expect(body.get("response")).toBe("good-token");
  });

  it("includes the caller's IP for Cloudflare's own risk scoring when given one", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    await verifyTurnstile("good-token", "203.0.113.9");
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("denies on an explicit success:false", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    expect(await verifyTurnstile("bad-token")).toBe(false);
  });

  it("fails closed on a non-OK HTTP response", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await verifyTurnstile("token")).toBe(false);
  });

  it("fails closed when the request throws (Cloudflare unreachable)", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await verifyTurnstile("token")).toBe(false);
  });

  it("fails closed on a malformed/non-JSON response", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });
    expect(await verifyTurnstile("token")).toBe(false);
  });
});
