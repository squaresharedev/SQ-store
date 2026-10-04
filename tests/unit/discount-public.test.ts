import { describe, expect, it } from "vitest";
import { findCodeFor, loadProductSale, readActiveSales } from "@/lib/discounts/public";

// The checkout's discount reads. A code is good only if everything about it
// is; whatever is wrong, the answer is the same null, so nobody can tell an
// unknown code from an expired one.

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CODE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-10-03T12:00:00Z");

function codeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CODE_ID,
    kind: "code",
    code: "SUMMER10",
    share_channel: "Instagram",
    value_type: "percent",
    percent_off: 10,
    amount_off_cents: null,
    currency: null,
    applies_to: "all",
    product_ids: [],
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: null,
    usage_limit: null,
    enabled: true,
    archived_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

/** A chainable stand-in that records filters and answers per table. */
function fakeAdmin(answers: { discounts?: unknown; ordersCount?: number | null; history?: unknown[] }) {
  const filters: [string, string, unknown][] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const record = (op: string) => (column: string, value?: unknown) => {
        filters.push([table, `${op}:${column}`, value]);
        return chain;
      };
      for (const op of ["eq", "neq", "is", "lte", "lt", "in"]) chain[op] = record(op);
      chain.select = () => chain;
      chain.or = (expression: string) => {
        filters.push([table, "or", expression]);
        return chain;
      };
      chain.order = () => chain;
      chain.limit = async () =>
        table === "product_price_history"
          ? { data: answers.history ?? [], error: null }
          : { data: answers.discounts ?? [], error: null };
      chain.maybeSingle = async () => ({ data: answers.discounts ?? null, error: null });
      chain.then = undefined;
      if (table === "orders") {
        // head count
        chain.select = () => chain;
        chain.eq = (column: string, value: unknown) => {
          filters.push([table, `eq:${column}`, value]);
          return Object.assign(Promise.resolve({ count: answers.ordersCount ?? 0, error: null }), chain);
        };
      }
      return chain;
    },
  };
  return { admin: admin as never, filters };
}

const find = (answers: Parameters<typeof fakeAdmin>[0], input: Partial<Parameters<typeof findCodeFor>[1]> = {}) => {
  const fake = fakeAdmin(answers);
  return {
    result: findCodeFor(fake.admin, { ownerId: OWNER, productId: PRODUCT, currency: "EUR", code: "SUMMER10", now: NOW, ...input }),
    filters: fake.filters,
  };
};

describe("findCodeFor", () => {
  it("finds a live code in this store only, with no id leaking past the terms", async () => {
    const { result, filters } = find({ discounts: codeRow() });
    expect(await result).toEqual({ id: CODE_ID, code: "SUMMER10", value: { type: "percent", percentOff: 10 } });
    expect(filters).toEqual(
      expect.arrayContaining([
        ["discounts", "eq:owner_id", OWNER],
        ["discounts", "eq:code", "SUMMER10"],
        ["discounts", "is:archived_at", null],
      ]),
    );
  });

  it.each([
    ["switched off", { enabled: false }],
    ["not started", { starts_at: "2026-10-04T00:00:00Z" }],
    ["ended", { ends_at: "2026-10-03T11:59:59Z" }],
    ["for other products", { applies_to: "products", product_ids: [OTHER] }],
    ["in another currency", { value_type: "amount", percent_off: null, amount_off_cents: 500, currency: "USD" }],
  ])("is null when the code is %s", async (_why, overrides) => {
    expect(await find({ discounts: codeRow(overrides) }).result).toBeNull();
  });

  it("is null for no such code", async () => {
    expect(await find({ discounts: null }).result).toBeNull();
  });

  it("counts a usage limit from this store's orders, and stops at it", async () => {
    expect(await find({ discounts: codeRow({ usage_limit: 3 }), ordersCount: 2 }).result).not.toBeNull();
    const { result, filters } = find({ discounts: codeRow({ usage_limit: 3 }), ordersCount: 3 });
    expect(await result).toBeNull();
    expect(filters).toEqual(
      expect.arrayContaining([
        ["orders", "eq:seller_id", OWNER],
        ["orders", "eq:discount_code_id", CODE_ID],
      ]),
    );
  });
});

describe("readActiveSales", () => {
  it("keeps the store's running sales that cover the product", async () => {
    const sale = (id: string, extra: Record<string, unknown> = {}) =>
      codeRow({ id, kind: "automatic", code: null, share_channel: null, ...extra });
    const { admin, filters } = fakeAdmin({
      discounts: [sale("covers"), sale("elsewhere", { applies_to: "products", product_ids: [OTHER] })],
    });
    const sales = await readActiveSales(admin, OWNER, PRODUCT, NOW);
    expect(sales.map((one) => one.id)).toEqual(["covers"]);
    expect(filters).toEqual(
      expect.arrayContaining([
        ["discounts", "eq:owner_id", OWNER],
        ["discounts", "eq:kind", "automatic"],
        ["discounts", "is:archived_at", null],
      ]),
    );
  });
});

describe("loadProductSale", () => {
  const SALE = { id: CODE_ID, value: { type: "percent" as const, percentOff: 20 }, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-08T00:00:00Z" };

  it("is the regular price without a sale", async () => {
    const { admin } = fakeAdmin({});
    expect(await loadProductSale(admin, { ownerId: OWNER, productId: PRODUCT, regularPriceCents: 2400, currency: "EUR", sales: [] })).toEqual({
      priceCents: 2400,
      sale: null,
    });
  });

  it("announces the reduction when 30 days of history prove the price", async () => {
    const { admin } = fakeAdmin({ history: [{ price_cents: 2400, currency: "EUR", valid_from: "2026-06-01T00:00:00Z" }] });
    expect(
      await loadProductSale(admin, { ownerId: OWNER, productId: PRODUCT, regularPriceCents: 2400, currency: "EUR", sales: [SALE] }),
    ).toEqual({
      priceCents: 1920,
      sale: { regularPriceCents: 2400, priorPriceCents: 2400, percentOff: 20, endsAt: SALE.endsAt },
    });
  });

  it("shows the sale price plainly when the history is too short to prove anything", async () => {
    const { admin } = fakeAdmin({ history: [{ price_cents: 2400, currency: "EUR", valid_from: "2026-09-25T00:00:00Z" }] });
    const result = await loadProductSale(admin, {
      ownerId: OWNER,
      productId: PRODUCT,
      regularPriceCents: 2400,
      currency: "EUR",
      sales: [SALE],
    });
    expect(result.priceCents).toBe(1920);
    expect(result.sale).toMatchObject({ priorPriceCents: null, percentOff: null });
  });
});
