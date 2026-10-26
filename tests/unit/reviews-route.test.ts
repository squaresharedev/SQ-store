// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/products/[id]/reviews: a buyer's review, proven by the order link.
 *
 * The database half (one review per order, the summary, the refund trigger)
 * is proven in tests/integration/42-reviews.test.ts. What this file pins is
 * the route's own gates, in order: same origin, shape, budget, an order OF
 * THIS PRODUCT, a paid and unrefunded order, a live product, and what is
 * written when all of that holds (verified, never anything the caller chose).
 */

const PRODUCT = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";
const OTHER_PRODUCT = "9a1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";
const ORDER = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const SELLER = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

const state = vi.hoisted(() => ({
  allow: true,
  order: null as Record<string, unknown> | null,
  reviewable: true as boolean | null,
  insertError: null as { code: string; message: string } | null,
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.7" }) }));
const scheduled = vi.hoisted(() => ({ tasks: [] as (() => unknown)[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((task: () => unknown) => scheduled.tasks.push(task)),
}));
const moderation = vi.hoisted(() => ({ checked: [] as string[] }));
vi.mock("@/lib/reviews/moderation", () => ({
  moderateReview: vi.fn(async (id: string) => {
    moderation.checked.push(id);
    return "clean";
  }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: vi.fn(async () => state.allow),
}));
vi.mock("@/lib/orders/order-page", () => ({ readOrderByRef: vi.fn(async () => state.order) }));
vi.mock("@/lib/reviews/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reviews/queries")>()),
  isReviewableProduct: vi.fn(async () => state.reviewable),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return {
          select: () => ({
            single: async () =>
              state.insertError
                ? { data: null, error: state.insertError }
                : { data: { id: "r1" }, error: null },
          }),
        };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/products/[id]/reviews/route");

const paidOrder = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER,
  seller_id: SELLER,
  product_id: PRODUCT,
  status: "paid",
  refunded_at: null,
  ...overrides,
});

function post(body: unknown, { productId = PRODUCT, sameOrigin = true } = {}) {
  return POST(
    new Request(`https://store.squareshare.to/api/products/${productId}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sameOrigin ? { "sec-fetch-site": "same-origin" } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: productId }) },
  );
}

const review = { orderRef: `${ORDER}.${"a".repeat(43)}`, rating: 5, title: "", body: "Lovely lamp", authorName: "Aoife" };

beforeEach(() => {
  state.allow = true;
  state.order = paidOrder();
  state.reviewable = true;
  state.insertError = null;
  state.inserts = [];
  scheduled.tasks = [];
  moderation.checked = [];
});

describe("POST /api/products/[id]/reviews", () => {
  it("writes a verified review from a paid order of this product, pending its check", async () => {
    const response = await post({ ...review, authorName: "  Aoife  " });
    expect(response.status).toBe(201);
    expect(state.inserts).toEqual([
      {
        product_id: PRODUCT,
        seller_id: SELLER,
        order_id: ORDER,
        rating: 5,
        title: null,
        body: "Lovely lamp",
        author_name: "Aoife",
        is_verified_buyer: true,
      },
    ]);
    // Nothing a buyer types is public before the automatic check reads it:
    // the row is written with the table's default (pending) and the check
    // runs after the response.
    expect(state.inserts[0]).not.toHaveProperty("moderation_status");
    expect(await response.json()).toEqual({ ok: true, status: "pending" });
    expect(moderation.checked).toEqual([]);
    await Promise.all(scheduled.tasks.map((task) => task()));
    expect(moderation.checked).toEqual(["r1"]);
  });

  it("refuses a request from another site's page", async () => {
    expect((await post(review, { sameOrigin: false })).status).toBe(403);
    expect(state.inserts).toEqual([]);
  });

  it("refuses a rating outside 1..5 and an empty review before any read", async () => {
    expect((await post({ ...review, rating: 6 })).status).toBe(400);
    expect((await post({ ...review, rating: 4.5 })).status).toBe(400);
    expect((await post({ ...review, body: "   " })).status).toBe(400);
    expect((await post({ ...review, isVerifiedBuyer: false })).status).toBe(400);
    expect(state.inserts).toEqual([]);
  });

  it("spends the budget before reading the order", async () => {
    state.allow = false;
    expect((await post(review)).status).toBe(429);
  });

  it("answers a link that proves nothing, or another product's order, with the same 404", async () => {
    state.order = null;
    expect((await post(review)).status).toBe(404);
    state.order = paidOrder({ product_id: OTHER_PRODUCT });
    expect((await post(review)).status).toBe(404);
    expect(state.inserts).toEqual([]);
  });

  it("refuses an order that is pending or refunded", async () => {
    state.order = paidOrder({ status: "pending" });
    expect((await post(review)).status).toBe(409);
    state.order = paidOrder({ status: "refunded", refunded_at: "2026-10-01T00:00:00Z" });
    expect((await post(review)).status).toBe(409);
    expect(state.inserts).toEqual([]);
  });

  it("refuses a product that is no longer live", async () => {
    state.reviewable = false;
    expect((await post(review)).status).toBe(409);
  });

  it("says so when the order already has its review", async () => {
    state.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const response = await post(review);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "already_reviewed" });
  });
});
