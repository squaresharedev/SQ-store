import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the og-image redirect route: api/og/p/[productId].
 *
 * Covers the gate order (UUID check → rate limit → product lookup → presign)
 * and verifies the 302 redirect carries a Cache-Control: no-store header.
 */

// --- module mocks (must be declared before any dynamic import) ---------------

const presignGetUrl = vi.fn(async () => null as string | null);
const rateLimitKey = vi.fn(async () => true);
const clientKey = vi.fn(async () => "127.0.0.1");

/** Mutable row the admin mock returns for the products query. */
const state: { row: { image_key: string } | null } = { row: null };

function builder() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    maybeSingle: async () => ({ data: state.row, error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => builder() }),
}));

vi.mock("@/lib/r2", () => ({ presignGetUrl }));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { ogImage: { max: 600, windowSeconds: 3600 } },
  clientKey,
  rateLimitKey: (...args: unknown[]) => rateLimitKey(...(args as [])),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

// ---------------------------------------------------------------------------

const VALID_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeContext(productId: string) {
  return { params: Promise.resolve({ productId }) };
}

const { GET } = await import("@/app/api/og/p/[productId]/route");

describe("/api/og/p/[productId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to permissive defaults; individual tests tighten as needed.
    rateLimitKey.mockResolvedValue(true);
    clientKey.mockResolvedValue("127.0.0.1");
    presignGetUrl.mockResolvedValue("https://r2.test/signed-image.jpg");
    state.row = { image_key: "products/hero.jpg" };
  });

  it("returns 404 for a non-UUID productId — no database work done", async () => {
    const res = await GET(new Request("http://localhost"), makeContext("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(rateLimitKey).not.toHaveBeenCalled();
  });

  it("returns 404 when the rate limit is exhausted", async () => {
    rateLimitKey.mockResolvedValue(false);
    const res = await GET(new Request("http://localhost"), makeContext(VALID_UUID));
    expect(res.status).toBe(404);
    // Should NOT have reached the database.
    expect(presignGetUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the product is not found or inactive (no row returned)", async () => {
    state.row = null;
    const res = await GET(new Request("http://localhost"), makeContext(VALID_UUID));
    expect(res.status).toBe(404);
    expect(presignGetUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the presign fails", async () => {
    presignGetUrl.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), makeContext(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("redirects to the signed URL with 302 and Cache-Control: no-store", async () => {
    const res = await GET(new Request("http://localhost"), makeContext(VALID_UUID));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://r2.test/signed-image.jpg");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
