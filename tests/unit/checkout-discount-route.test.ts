// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/checkout/[storefrontId]/[productId]/discount: the one door to a
 * store's codes. Pinned here: the order of the gates (origin, body, budget,
 * product), that every failure reads the same, and that a good code answers
 * with its terms and nothing else.
 */

const STOREFRONT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CODE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  allow: true,
  gate: true as boolean,
  available: true,
  code: null as null | { id: string; code: string; value: unknown },
  calls: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.7" }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: vi.fn(async (_key: string, action: string) => {
    state.calls.push(`limit:${action}`);
    return state.allow;
  }),
}));
vi.mock("@/lib/products/purchasable", () => ({
  loadPurchasable: vi.fn(async () => {
    state.calls.push("gate");
    return state.gate
      ? { ownerId: OWNER, row: { id: PRODUCT, currency: "EUR" }, now: new Date("2026-10-03T12:00:00Z") }
      : null;
  }),
}));
vi.mock("@/lib/checkout/availability", () => ({
  checkoutAvailableFor: () => state.available,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/discounts/public", () => ({
  findCodeFor: vi.fn(async (_admin: unknown, input: { ownerId: string; productId: string; code: string }) => {
    state.calls.push(`find:${input.ownerId}:${input.productId}:${input.code}`);
    return state.code;
  }),
}));

const { POST } = await import("@/app/api/checkout/[storefrontId]/[productId]/discount/route");

function post(body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return POST(
    new Request(`http://localhost/api/checkout/${STOREFRONT}/${PRODUCT}/discount`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ storefrontId: STOREFRONT, productId: PRODUCT }) },
  );
}

beforeEach(() => {
  state.allow = true;
  state.gate = true;
  state.available = true;
  state.code = { id: CODE_ID, code: "SUMMER10", value: { type: "percent", percentOff: 10 } };
  state.calls = [];
});

describe("discount check route", () => {
  it("answers a good code with its terms, normalised, and never its id", async () => {
    const response = await post({ code: " summer10 " });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, terms: { code: "SUMMER10", value: { type: "percent", percentOff: 10 } } });
    expect(JSON.stringify(body)).not.toContain(CODE_ID);
    expect(state.calls).toEqual(["limit:discount_check", "gate", `find:${OWNER}:${PRODUCT}:SUMMER10`]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses another site's page before reading anything", async () => {
    const response = await post({ code: "SUMMER10" }, { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("refuses a body that is not one code in the code shape, before spending the budget", async () => {
    for (const body of ["not json", { code: "a b" }, { code: "SUMMER10", productId: PRODUCT }, []]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "discount_invalid" });
    }
    expect(state.calls).toEqual([]);
  });

  it("stops at the per-client budget before the gate", async () => {
    state.allow = false;
    const response = await post({ code: "SUMMER10" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(state.calls).toEqual(["limit:discount_check"]);
  });

  it("answers a product that is not for sale, or a closed checkout, as unavailable", async () => {
    state.gate = false;
    expect((await post({ code: "SUMMER10" })).status).toBe(404);
    state.gate = true;
    state.available = false;
    expect(await (await post({ code: "SUMMER10" })).json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("answers every unusable code the same way", async () => {
    state.code = null;
    const response = await post({ code: "NOPE10" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "discount_invalid" });
  });
});
