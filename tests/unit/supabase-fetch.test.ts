import { afterEach, describe, expect, it, vi } from "vitest";
import { resilientFetch } from "@/lib/supabase/fetch";

/**
 * Guards the fix for the intermittent `AuthRetryableFetchError: fetch failed`
 * on server renders: a dead keep-alive socket surfaces as a bare TypeError and
 * must be replayed, while everything else must pass straight through.
 */

const response = (status = 200) => new Response("{}", { status });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resilientFetch", () => {
  it("returns the response without retrying when the request succeeds", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());

    await expect(resilientFetch("https://example.test")).resolves.toBeInstanceOf(
      Response,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("replays a transport failure once and returns the eventual response", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(response());

    const result = await resilientFetch("https://example.test", {
      method: "POST",
      body: "{}",
    });

    expect(result.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("gives up after exactly two attempts and rethrows the transport error", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(resilientFetch("https://example.test")).rejects.toThrow(
      "fetch failed",
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // Regression guard. This wrapper runs inside auth-js's own refresh retry
  // loop (up to 30s of exponential backoff), so any delay added here is
  // multiplied by it. The replay must stay immediate.
  it("replays immediately, with no backoff", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(response());

    const started = performance.now();
    await resilientFetch("https://example.test");

    expect(performance.now() - started).toBeLessThan(50);
  });

  it("passes HTTP errors through untouched — Supabase owns those", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(500));

    const result = await resilientFetch("https://example.test");

    expect(result.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never replays an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      resilientFetch("https://example.test", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-transport errors", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("boom"));

    await expect(resilientFetch("https://example.test")).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
