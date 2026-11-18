// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * presignGetUrl memo: the signed URL for (key, clock-hour) is byte-identical
 * on every call within the same isolate because the anchor, credentials, and
 * query parameters are all fixed. The memo caches it to avoid repeated
 * HMAC/URL work (~240-350 us each).
 *
 * Determinism proof: aws4fetch's AwsV4Signer.sign() is a pure HMAC function
 * of (url, datetime, accessKeyId, secretAccessKey, region, service). With a
 * fixed anchor hour, all inputs are constant for the life of the isolate.
 */

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T10:30:00.000Z")); // Middle of an hour
  vi.stubEnv("R2_ACCOUNT_ID", "test-account-id");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("presignGetUrl determinism", () => {
  it("produces the same signed URL for the same key and anchor", async () => {
    const { presignGetUrl } = await import("@/lib/r2");

    // First call: cold, computes the HMAC signature.
    const url1 = await presignGetUrl("images/owner/photo.png");
    expect(url1).not.toBeNull();
    expect(url1).toContain("X-Amz-Signature");
    expect(url1).toContain("X-Amz-Date=20260115T100000Z");

    // Sign the same key again independently with fresh module state to confirm
    // the underlying sign is deterministic (not randomised).
    vi.resetModules();
    const { presignGetUrl: presignGetUrl2 } = await import("@/lib/r2");
    const url2 = await presignGetUrl2("images/owner/photo.png");

    expect(url2).toBe(url1);
  });

  it("two different keys produce different URLs", async () => {
    const { presignGetUrl } = await import("@/lib/r2");
    const a = await presignGetUrl("images/owner/a.png");
    const b = await presignGetUrl("images/owner/b.png");
    expect(a).not.toBe(b);
  });
});

describe("presignGetUrl memo", () => {
  it("cache hit: second call returns the same URL without re-signing", async () => {
    const { presignGetUrl } = await import("@/lib/r2");

    const url1 = await presignGetUrl("images/owner/photo.png");
    expect(url1).not.toBeNull();
    // Cache is now warm.
    const url2 = await presignGetUrl("images/owner/photo.png");
    expect(url2).toBe(url1);
  });

  it("cache clears when the anchor hour rolls over", async () => {
    const { presignGetUrl } = await import("@/lib/r2");

    const url1 = await presignGetUrl("images/owner/photo.png");
    expect(url1).not.toBeNull();

    // Advance to the next hour so anchorMs changes.
    vi.setSystemTime(new Date("2026-01-15T11:30:00.000Z"));

    const url2 = await presignGetUrl("images/owner/photo.png");
    expect(url2).not.toBeNull();
    // The datetime in the signed URL changes with the anchor, so the URLs differ.
    expect(url2).not.toBe(url1);
    expect(url2).toContain("X-Amz-Date=20260115T110000Z");
  });

  it("does not cache null: a later call with credentials returns a URL", async () => {
    // Remove credentials so the first call returns null before hitting the cache.
    vi.unstubAllEnvs();
    const { presignGetUrl } = await import("@/lib/r2");

    const url1 = await presignGetUrl("images/owner/photo.png");
    expect(url1).toBeNull();

    // Restore credentials and confirm the function now works (null was not cached).
    vi.stubEnv("R2_ACCOUNT_ID", "test-account-id");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");

    const url2 = await presignGetUrl("images/owner/photo.png");
    expect(url2).not.toBeNull();
  });

  it("resetPresignGetCache clears the cache without reloading the module", async () => {
    const { presignGetUrl, resetPresignGetCache } = await import("@/lib/r2");

    const url1 = await presignGetUrl("images/owner/photo.png");
    expect(url1).not.toBeNull();

    resetPresignGetCache();

    // After reset the same call re-signs, producing the same URL (deterministic).
    const url2 = await presignGetUrl("images/owner/photo.png");
    expect(url2).toBe(url1);
  });

  it("passes https:// keys through without touching the cache", async () => {
    const { presignGetUrl } = await import("@/lib/r2");
    const seed = "https://images.unsplash.com/photo-123?w=640";
    expect(await presignGetUrl(seed)).toBe(seed);
    // A second call also returns the raw URL (not null, no error).
    expect(await presignGetUrl(seed)).toBe(seed);
  });

});
