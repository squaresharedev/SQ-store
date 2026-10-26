// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SellerReviewFilters } from "@/lib/reviews/seller-filters";
import { ilikeAny } from "@/lib/supabase/ilike";

/**
 * What the seller's filters ask of the database. The query builder is
 * recorded rather than run: each case pins the conditions and the ordering a
 * view turns into, which is where a filter silently doing nothing would hide.
 */

type Call = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as Call[][],
  data: [] as unknown[],
}));

/** A stand-in query: records each call, and resolves like PostgREST when awaited. */
function recorder(table: string) {
  const calls: Call[] = [["from", table]];
  state.calls.push(calls);
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "range"]) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (value: unknown) => void) =>
    resolve({ data: table === "reviews" ? [] : state.data, count: 0, error: null });
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => recorder(table) }),
}));

const { getSellerReviewOverview, getSellerReviews } = await import("@/lib/reviews/seller-queries");

beforeEach(() => {
  state.calls = [];
  state.data = [];
});

const BASE: SellerReviewFilters = { status: "all", sort: "newest" };

/** The calls made on the list query (the first of the two reads). */
async function listCalls(filters: SellerReviewFilters, page = 1): Promise<Call[]> {
  await getSellerReviews("seller-1", filters, page);
  return state.calls[0]!;
}

describe("getSellerReviews", () => {
  it("reads only this store's reviews, newest first", async () => {
    const calls = await listCalls(BASE);
    expect(calls).toContainEqual(["eq", "seller_id", "seller-1"]);
    expect(calls.filter(([method]) => method === "order")).toEqual([
      ["order", "reviewed_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });

  it("searches the title, the text and the author, through the shared escaping", async () => {
    const calls = await listCalls({ ...BASE, search: "50%_off" });
    // ilikeAny escapes % and _ so they match themselves, not as wildcards.
    expect(calls).toContainEqual(["or", ilikeAny(["title", "body", "author_name"], "50%_off")]);
  });

  it.each([
    ["a rating", { rating: 2 }, ["eq", "rating", 2]],
    ["a product", { productId: "p-1" }, ["eq", "product_id", "p-1"]],
    ["verified buyers", { origin: "verified" as const }, ["eq", "is_verified_buyer", true]],
    ["imported reviews", { origin: "imported" as const }, ["eq", "is_imported", true]],
    ["the held tab", { status: "held" as const }, ["eq", "moderation_status", "held"]],
    ["the hidden tab", { status: "hidden" as const }, ["eq", "is_approved", false]],
  ])("narrows to %s", async (_name, patch, expected) => {
    expect(await listCalls({ ...BASE, ...patch })).toContainEqual(expected);
  });

  it("orders the lowest ratings first, newest among equals", async () => {
    const calls = await listCalls({ ...BASE, sort: "lowest" });
    expect(calls.filter(([method]) => method === "order").slice(0, 2)).toEqual([
      ["order", "rating", { ascending: true }],
      ["order", "reviewed_at", { ascending: false }],
    ]);
  });

  it("reads the page asked for", async () => {
    const calls = await listCalls(BASE, 3);
    expect(calls).toContainEqual(["range", 40, 59]);
  });
});

describe("getSellerReviewOverview", () => {
  it("sums the products' public numbers into the store's, and lists the products by title", async () => {
    state.data = [
      { product_id: "b", review_count: 2, rating_sum: 9, rating_1: 0, rating_2: 0, rating_3: 0, rating_4: 1, rating_5: 1, products: { title: "Sofa" } },
      { product_id: "a", review_count: 2, rating_sum: 4, rating_1: 1, rating_2: 0, rating_3: 1, rating_4: 0, rating_5: 0, products: { title: "Lamp" } },
      // Every review held or hidden: no numbers, but its reviews can still be found.
      { product_id: "c", review_count: 0, rating_sum: 0, rating_1: 0, rating_2: 0, rating_3: 0, rating_4: 0, rating_5: 0, products: { title: "Chair" } },
    ];
    const overview = await getSellerReviewOverview("seller-1");
    expect(state.calls[0]).toContainEqual(["eq", "seller_id", "seller-1"]);
    expect(overview).toEqual({
      summary: { count: 4, average: 3.25, breakdown: [1, 0, 1, 1, 1] },
      products: [
        { id: "c", title: "Chair" },
        { id: "a", title: "Lamp" },
        { id: "b", title: "Sofa" },
      ],
    });
  });

  it("has no average before the first public review", async () => {
    const overview = await getSellerReviewOverview("seller-1");
    expect(overview?.summary).toEqual({ count: 0, average: null, breakdown: [0, 0, 0, 0, 0] });
  });
});
