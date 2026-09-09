/**
 * THE BOUNDARY. resolveOrderQuantity is what a checkout has to pass, and every
 * test here is about the same claim: nothing the caller sends is used as a
 * fact except the product id and the number being asked for.
 *
 * The fake client below records the filters it was given, so the tests can
 * assert not only what came back but that the function went and READ the row
 * rather than believing anything handed to it.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { resolveOrderQuantity } from "@/lib/products/order-quantity";

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Row = {
  id: string;
  status: string;
  price_cents: number;
  currency: string;
  track_stock: boolean;
  stock_quantity: number | null;
  max_per_order: number | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: PRODUCT_ID,
    status: "active",
    price_cents: 1299,
    currency: "EUR",
    track_stock: false,
    stock_quantity: null,
    max_per_order: 5,
    ...overrides,
  };
}

/** A Supabase client that returns one row and remembers how it was queried. */
function fakeClient(result: { data: Row | null; error?: unknown }) {
  const filters: [string, unknown][] = [];
  const select = vi.fn();
  const builder = {
    select: (columns: string) => {
      select(columns);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: result.data, error: result.error ?? null }),
  };
  const client = { from: vi.fn(() => builder) };
  return {
    client: client as unknown as SupabaseClient<Database>,
    filters,
    select,
  };
}

describe("resolveOrderQuantity", () => {
  it("allows a quantity inside the product's own ceiling, priced from the row", async () => {
    const { client, filters, select } = fakeClient({ data: row() });
    const result = await resolveOrderQuantity(client, PRODUCT_ID, 3);

    expect(result).toEqual({
      ok: true,
      quantity: 3,
      unitPriceCents: 1299,
      currency: "EUR",
      totalCents: 3897,
      maxPerOrder: 5,
    });
    // It read the row for itself, scoped to the id AND to an active product.
    expect(filters).toEqual([
      ["id", PRODUCT_ID],
      ["status", "active"],
    ]);
    // And it asked for the columns it decides from, never `*`.
    expect(select.mock.calls[0]?.[0]).not.toContain("*");
    expect(select.mock.calls[0]?.[0]).toContain("max_per_order");
  });

  it("REFUSES an over-limit quantity rather than quietly lowering it", async () => {
    const { client } = fakeClient({ data: row({ max_per_order: 3 }) });
    // The buyer pressed 10. Coming back with a silent 3 would be charging them
    // for an order they did not place.
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 10)).toEqual({
      ok: false,
      reason: "over_limit",
    });
  });

  it("measures against the STORED ceiling, corrected, not a believable-looking one", async () => {
    // A row carrying an impossible ceiling is held to the platform's, not to
    // its own. 200 would otherwise be sellable here.
    const { client } = fakeClient({ data: row({ max_per_order: 10_000 }) });
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 200)).toMatchObject({
      ok: false,
      reason: "invalid_request",
    });
    const second = fakeClient({ data: row({ max_per_order: 10_000 }) });
    expect(await resolveOrderQuantity(second.client, PRODUCT_ID, 100)).toMatchObject({
      ok: true,
      maxPerOrder: 100,
    });
  });

  it("catches the oversell the public picker deliberately does not", async () => {
    // 7 units on hand, above the low-stock threshold, so the page's ceiling was
    // the seller's 5 and a buyer could ask for more than the shelf holds.
    const { client } = fakeClient({
      data: row({ track_stock: true, stock_quantity: 2, max_per_order: 5 }),
    });
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 4)).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("treats a tracked product with no quantity as having none", async () => {
    const { client } = fakeClient({
      data: row({ track_stock: true, stock_quantity: null }),
    });
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 1)).toEqual({
      ok: false,
      reason: "insufficient_stock",
    });
  });

  it("ignores the shelf entirely when the product does not track it", async () => {
    const { client } = fakeClient({ data: row({ track_stock: false, stock_quantity: 0 }) });
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 5)).toMatchObject({ ok: true });
  });

  it("refuses a malformed request WITHOUT touching the database", async () => {
    for (const forged of [0, -1, 2.5, "3", "1e9", null, undefined, {}, Number.NaN, 1_000_000]) {
      const { client } = fakeClient({ data: row() });
      expect(await resolveOrderQuantity(client, PRODUCT_ID, forged)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
      // A scan must not be able to make this function do a read.
      expect(client.from).not.toHaveBeenCalled();
    }
  });

  it("refuses a product id that is not one", async () => {
    const { client } = fakeClient({ data: row() });
    expect(await resolveOrderQuantity(client, "not-a-uuid", 1)).toEqual({
      ok: false,
      reason: "invalid_request",
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("gives one answer for a missing product and a draft one", async () => {
    // The status filter is in the query, so a draft comes back as no row.
    const missing = fakeClient({ data: null });
    expect(await resolveOrderQuantity(missing.client, PRODUCT_ID, 1)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("fails closed when the read errors", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 1)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    spy.mockRestore();
  });

  it("prices from the row's currency, not from anything a caller could set", async () => {
    const { client } = fakeClient({ data: row({ currency: "USD", price_cents: 500 }) });
    expect(await resolveOrderQuantity(client, PRODUCT_ID, 2)).toMatchObject({
      ok: true,
      currency: "USD",
      unitPriceCents: 500,
      totalCents: 1000,
    });
  });
});
