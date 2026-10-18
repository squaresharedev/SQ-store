import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findCodeFor,
  loadProductSale,
  loadProductSales,
  msUntilSaleEnds,
  readActiveSales,
  readStoreSales,
  salesCovering,
  type PricedProduct,
} from "@/lib/discounts/public";
import { createFakeAdmin } from "../setup/fake-admin";

// The buyer pages' discount reads. A code is good only if everything about it
// is; whatever is wrong, the answer is the same null, so nobody can tell an
// unknown code from an expired one. A store's running sales set what its
// products cost, so sales that cannot be read are "not known" (null), never
// "none"; what a sale may ANNOUNCE fails the other way, to the plain price.

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CODE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-10-03T12:00:00Z");

function codeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CODE_ID,
    owner_id: OWNER,
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

/** A sale row: a discount every buyer gets. */
function saleRow(id: string, overrides: Record<string, unknown> = {}) {
  return codeRow({ id, kind: "automatic", code: null, share_channel: null, percent_off: 20, ...overrides });
}

const historyRow = (productId: string, priceCents: number, validFrom: string, currency = "EUR") => ({
  product_id: productId,
  price_cents: priceCents,
  currency,
  valid_from: validFrom,
});

afterEach(() => vi.restoreAllMocks());
/** The readers log what went wrong; a test that makes them fail expects that. */
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("findCodeFor", () => {
  const find = (
    tables: Parameters<typeof createFakeAdmin>[0],
    input: Partial<Parameters<typeof findCodeFor>[1]> = {},
  ) => {
    const fake = createFakeAdmin(tables);
    return {
      result: findCodeFor(fake.admin, {
        ownerId: OWNER,
        productId: PRODUCT,
        currency: "EUR",
        code: "SUMMER10",
        now: NOW,
        ...input,
      }),
      filters: fake.state.filters,
    };
  };

  it("finds a live code in this store only, with no id leaking past the terms", async () => {
    const { result, filters } = find({ discounts: [codeRow()] });
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
    ["another store's", { owner_id: STRANGER }],
    ["deleted", { archived_at: "2026-10-02T00:00:00Z" }],
  ])("is null when the code is %s", async (_why, overrides) => {
    expect(await find({ discounts: [codeRow(overrides)] }).result).toBeNull();
  });

  it("is null for no such code", async () => {
    expect(await find({ discounts: [] }).result).toBeNull();
  });

  it("counts a usage limit from this store's orders, and stops at it", async () => {
    const order = (n: number, status = "paid") => ({ id: `o${n}`, seller_id: OWNER, discount_code_id: CODE_ID, status });
    const limited = [codeRow({ usage_limit: 3 })];
    expect(await find({ discounts: limited, orders: [order(1), order(2)] }).result).not.toBeNull();
    // An order that was taken back gives its use back.
    expect(await find({ discounts: limited, orders: [order(1), order(2), order(3, "refunded")] }).result).not.toBeNull();
    const { result, filters } = find({ discounts: limited, orders: [order(1), order(2), order(3)] });
    expect(await result).toBeNull();
    expect(filters).toEqual(
      expect.arrayContaining([
        ["orders", "eq:seller_id", OWNER],
        ["orders", "eq:discount_code_id", CODE_ID],
        ["orders", "neq:status", "refunded"],
      ]),
    );
  });
});

describe("readStoreSales: which sales are running", () => {
  it("is the store's own sales that have started and not ended, oldest first", async () => {
    const { admin } = createFakeAdmin({
      discounts: [
        saleRow("newer", { created_at: "2026-10-02T00:00:00Z" }),
        saleRow("older", { created_at: "2026-09-01T00:00:00Z" }),
        saleRow("scheduled", { starts_at: "2026-10-03T12:00:00.001Z" }),
        saleRow("ended", { ends_at: "2026-10-03T12:00:00Z" }),
        saleRow("deleted", { archived_at: "2026-10-02T00:00:00Z" }),
        saleRow("elsewhere", { owner_id: STRANGER }),
        codeRow({ id: "a-code" }),
      ],
    });
    const sales = await readStoreSales(admin, OWNER, NOW);
    expect(sales?.map((sale) => sale.id)).toEqual(["older", "newer"]);
  });

  it("runs from the instant it starts up to, not including, the instant it ends", async () => {
    const { admin } = createFakeAdmin({
      discounts: [saleRow("window", { starts_at: "2026-10-03T12:00:00Z", ends_at: "2026-10-03T13:00:00Z" })],
    });
    const runningAt = async (iso: string) => ((await readStoreSales(admin, OWNER, new Date(iso))) ?? []).length === 1;
    expect(await runningAt("2026-10-03T11:59:59.999Z")).toBe(false);
    expect(await runningAt("2026-10-03T12:00:00.000Z")).toBe(true);
    expect(await runningAt("2026-10-03T12:59:59.999Z")).toBe(true);
    expect(await runningAt("2026-10-03T13:00:00.000Z")).toBe(false);
  });

  it("reads an instant the way the database spells it (+00:00, microseconds)", async () => {
    const { admin } = createFakeAdmin({
      discounts: [saleRow("pg", { starts_at: "2026-10-03T11:59:59.123456+00:00", ends_at: "2026-10-03T14:00:00+02:00" })],
    });
    expect(await readStoreSales(admin, OWNER, new Date("2026-10-03T11:59:59.999Z"))).toHaveLength(1);
    // 14:00 at +02:00 is 12:00 UTC: over.
    expect(await readStoreSales(admin, OWNER, NOW)).toHaveLength(0);
  });

  it("is NULL, not empty, when the sales cannot be read: no sale and unknown are different answers", async () => {
    quiet();
    const fake = createFakeAdmin({ discounts: [saleRow("sale")] });
    fake.state.fault = () => "error";
    expect(await readStoreSales(fake.admin, OWNER, NOW)).toBeNull();
    fake.state.fault = () => "throw";
    expect(await readStoreSales(fake.admin, OWNER, NOW)).toBeNull();
  });

  it("asks once more before giving up, so one blip does not cost a buyer the page", async () => {
    quiet();
    const fake = createFakeAdmin({ discounts: [saleRow("sale")] });
    let failures = 1;
    fake.state.fault = () => (failures-- > 0 ? "error" : null);
    expect((await readStoreSales(fake.admin, OWNER, NOW))?.map((sale) => sale.id)).toEqual(["sale"]);
    expect(fake.state.reads).toEqual(["discounts", "discounts"]);
  });

  it("is NULL when more sales are running than one read returns: a partial list would overprice", async () => {
    quiet();
    const fake = createFakeAdmin({ discounts: [saleRow("a"), saleRow("b"), saleRow("c")] });
    fake.state.maxRows = 2;
    expect(await readStoreSales(fake.admin, OWNER, NOW)).toBeNull();
  });

  it("leaves out a row whose terms do not make a discount, rather than failing the store", async () => {
    const { admin } = createFakeAdmin({
      discounts: [saleRow("broken", { percent_off: null }), saleRow("fine")],
    });
    expect((await readStoreSales(admin, OWNER, NOW))?.map((sale) => sale.id)).toEqual(["fine"]);
  });
});

describe("readActiveSales and salesCovering: which of them cover a product", () => {
  it("keeps the store's running sales that cover the product", async () => {
    const { admin, state } = createFakeAdmin({
      discounts: [saleRow("covers"), saleRow("elsewhere", { applies_to: "products", product_ids: [OTHER] })],
    });
    const sales = await readActiveSales(admin, OWNER, PRODUCT, NOW);
    expect(sales?.map((one) => one.id)).toEqual(["covers"]);
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["discounts", "eq:owner_id", OWNER],
        ["discounts", "eq:kind", "automatic"],
        ["discounts", "is:archived_at", null],
      ]),
    );
  });

  it("is null when the store's sales cannot be read", async () => {
    quiet();
    const fake = createFakeAdmin({ discounts: [saleRow("covers")] });
    fake.state.fault = () => "error";
    expect(await readActiveSales(fake.admin, OWNER, PRODUCT, NOW)).toBeNull();
  });

  it("matches a named product exactly, and carries no scope on to the caller", () => {
    const sale = { id: "s", value: { type: "percent" as const, percentOff: 10 }, startsAt: "2026-10-01T00:00:00Z", endsAt: null };
    const sales = [
      { ...sale, id: "all", appliesTo: "all" as const, productIds: [] },
      { ...sale, id: "named", appliesTo: "products" as const, productIds: [PRODUCT] },
      { ...sale, id: "other", appliesTo: "products" as const, productIds: [OTHER] },
    ];
    expect(salesCovering(sales, PRODUCT)).toEqual([
      { ...sale, id: "all" },
      { ...sale, id: "named" },
    ]);
  });
});

describe("loadProductSale: one product's price and what its sale may announce", () => {
  const SALE = { id: CODE_ID, value: { type: "percent" as const, percentOff: 20 }, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-08T00:00:00Z" };
  const input = { ownerId: OWNER, productId: PRODUCT, regularPriceCents: 2400, currency: "EUR" as const, listedAt: null };

  it("is the regular price without a sale, and reads nothing to say so", async () => {
    const { admin, state } = createFakeAdmin({});
    expect(await loadProductSale(admin, { ...input, sales: [] })).toEqual({ priceCents: 2400, sale: null });
    expect(state.reads).toEqual([]);
  });

  it("announces the reduction when 30 days of history prove the price", async () => {
    const { admin } = createFakeAdmin({
      product_price_history: [historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z")],
    });
    expect(await loadProductSale(admin, { ...input, sales: [SALE] })).toEqual({
      priceCents: 1920,
      sale: { regularPriceCents: 2400, priorPriceCents: 2400, percentOff: 20, offerPercent: 20, endsAt: SALE.endsAt },
    });
  });

  it("measures a product younger than 30 days from the day it was listed", async () => {
    const { admin } = createFakeAdmin({
      product_price_history: [historyRow(PRODUCT, 2400, "2026-09-25T00:00:00Z")],
    });
    // The records begin where the product does, so every price it has had is known.
    expect(
      (await loadProductSale(admin, { ...input, sales: [SALE], listedAt: "2026-09-25T00:00:00Z" })).sale,
    ).toMatchObject({ priorPriceCents: 2400, percentOff: 20 });
    // Listed long before its first record: what it cost in between is not known.
    expect(
      (await loadProductSale(admin, { ...input, sales: [SALE], listedAt: "2026-08-01T00:00:00Z" })).sale,
    ).toMatchObject({ priorPriceCents: null, percentOff: null });
  });

  it("claims no percentage when the history is too short to prove anything", async () => {
    const { admin } = createFakeAdmin({
      product_price_history: [historyRow(PRODUCT, 2400, "2026-09-25T00:00:00Z")],
    });
    const result = await loadProductSale(admin, { ...input, sales: [SALE] });
    expect(result.priceCents).toBe(1920);
    expect(result.sale).toMatchObject({ priorPriceCents: null, percentOff: null });
  });

  it("measures against the LOWEST price of the 30 days before, an earlier sale's included", async () => {
    const { admin } = createFakeAdmin({
      product_price_history: [historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z")],
      discounts: [
        // 25% off for a week inside the window: 18.00 was charged then.
        saleRow("earlier", { percent_off: 25, starts_at: "2026-09-10T00:00:00Z", ends_at: "2026-09-17T00:00:00Z" }),
      ],
    });
    const result = await loadProductSale(admin, { ...input, sales: [SALE] });
    // 19.20 now against 18.00 then is not a reduction: no percentage. The
    // lower price is handed on, so the page can say it beside the struck one.
    // The tile's chip still says what this sale takes off the struck price.
    expect(result).toEqual({
      priceCents: 1920,
      sale: { regularPriceCents: 2400, priorPriceCents: 1800, percentOff: null, offerPercent: 20, endsAt: SALE.endsAt },
    });
  });

  it("counts a deleted sale that ran, and not one deleted before it began", async () => {
    const history = [historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z")];
    const ran = saleRow("ran", {
      percent_off: 10,
      starts_at: "2026-09-10T00:00:00Z",
      ends_at: "2026-09-12T00:00:00Z",
      archived_at: "2026-09-12T00:00:00Z",
    });
    const neverRan = saleRow("never", {
      percent_off: 50,
      starts_at: "2026-09-20T00:00:00Z",
      ends_at: null,
      archived_at: "2026-09-19T00:00:00Z",
    });
    const { admin } = createFakeAdmin({ product_price_history: history, discounts: [ran, neverRan] });
    // 21.60 was the lowest (the 10% sale that ran); the 50% one never set a price.
    expect((await loadProductSale(admin, { ...input, sales: [SALE] })).sale).toMatchObject({
      priorPriceCents: 2160,
      percentOff: 11,
    });
  });

  it("ignores another store's sales and another product's history", async () => {
    const { admin } = createFakeAdmin({
      product_price_history: [
        historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z"),
        historyRow(OTHER, 100, "2026-09-15T00:00:00Z"),
      ],
      discounts: [
        saleRow("theirs", { owner_id: STRANGER, percent_off: 90, starts_at: "2026-09-10T00:00:00Z", ends_at: "2026-09-17T00:00:00Z" }),
      ],
    });
    expect((await loadProductSale(admin, { ...input, sales: [SALE] })).sale?.priorPriceCents).toBe(2400);
  });

  it.each(["product_price_history", "discounts"])(
    "keeps the PRICE and drops only the announcement when %s cannot be read",
    async (table) => {
      quiet();
      for (const fault of ["error", "throw"] as const) {
        const fake = createFakeAdmin({ product_price_history: [historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z")] });
        fake.state.fault = (read) => (read === table ? fault : null);
        expect(await loadProductSale(fake.admin, { ...input, sales: [SALE] })).toEqual({
          priceCents: 1920,
          sale: { regularPriceCents: 2400, priorPriceCents: null, percentOff: null, offerPercent: 20, endsAt: SALE.endsAt },
        });
      }
    },
  );

  it("announces nothing when the store's earlier sales come back short: a missing one would overstate the was price", async () => {
    quiet();
    const fake = createFakeAdmin({
      product_price_history: [historyRow(PRODUCT, 2400, "2026-06-01T00:00:00Z")],
      discounts: [1, 2, 3].map((n) =>
        saleRow(`earlier-${n}`, { percent_off: 5 * n, starts_at: `2026-09-0${n}T00:00:00Z`, ends_at: `2026-09-0${n}T12:00:00Z` }),
      ),
    });
    fake.state.maxRows = 2;
    expect((await loadProductSale(fake.admin, { ...input, sales: [SALE] })).sale).toMatchObject({
      priorPriceCents: null,
      percentOff: null,
    });
  });
});

describe("loadProductSales: a whole board at once", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const sale = (name: string, percentOff: number, startsAt: string, endsAt: string | null = null) => ({
    id: name,
    value: { type: "percent" as const, percentOff },
    startsAt,
    endsAt,
  });

  it("gives every product an answer, and reads the records once for all of them", async () => {
    const autumn = sale("autumn", 20, "2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z");
    const flash = sale("flash", 50, "2026-10-03T06:00:00Z");
    const products: PricedProduct[] = [
      { productId: id(1), regularPriceCents: 2400, currency: "EUR", sales: [autumn], listedAt: null },
      { productId: id(2), regularPriceCents: 10000, currency: "EUR", sales: [autumn, flash], listedAt: null },
      { productId: id(3), regularPriceCents: 500, currency: "USD", sales: [], listedAt: null },
    ];
    const { admin, state } = createFakeAdmin({
      product_price_history: [
        historyRow(id(1), 2400, "2026-06-01T00:00:00Z"),
        historyRow(id(2), 10000, "2026-06-01T00:00:00Z"),
      ],
    });
    const pricing = await loadProductSales(admin, { ownerId: OWNER, products });
    expect(Object.fromEntries(pricing)).toEqual({
      [id(1)]: { priceCents: 1920, sale: { regularPriceCents: 2400, priorPriceCents: 2400, percentOff: 20, offerPercent: 20, endsAt: autumn.endsAt } },
      // The better sale wins; the other one (running before it) set the earlier price.
      [id(2)]: { priceCents: 5000, sale: { regularPriceCents: 10000, priorPriceCents: 10000, percentOff: 50, offerPercent: 50, endsAt: null } },
      [id(3)]: { priceCents: 500, sale: null },
    });
    // One history read and one read of the store's other sales, however many tiles.
    expect(state.reads.sort()).toEqual(["discounts", "product_price_history"]);
  });

  it("answers for a board exactly what it answers for each product on its own", async () => {
    const tables = {
      product_price_history: [
        historyRow(id(1), 3000, "2026-05-01T00:00:00Z"),
        historyRow(id(1), 2400, "2026-09-20T00:00:00Z"),
        historyRow(id(2), 10000, "2026-09-28T00:00:00Z"),
        historyRow(id(3), 900, "2026-01-01T00:00:00Z", "USD"),
        historyRow(id(3), 900, "2026-09-15T00:00:00Z"),
        historyRow(id(4), 4000, "2026-02-01T00:00:00Z"),
      ],
      discounts: [
        saleRow("spring", { percent_off: 15, starts_at: "2026-09-05T00:00:00Z", ends_at: "2026-09-09T00:00:00Z" }),
        saleRow("named", { percent_off: 30, applies_to: "products", product_ids: [id(4)], starts_at: "2026-09-25T00:00:00Z", ends_at: "2026-09-26T00:00:00Z" }),
      ],
    };
    const autumn = sale("autumn", 20, "2026-10-01T00:00:00Z");
    const flash = sale("flash", 35, "2026-10-02T00:00:00Z", "2026-10-05T00:00:00Z");
    const products: PricedProduct[] = [
      { productId: id(1), regularPriceCents: 2400, currency: "EUR", sales: [autumn], listedAt: null },
      { productId: id(2), regularPriceCents: 10000, currency: "EUR", sales: [autumn, flash], listedAt: null },
      { productId: id(3), regularPriceCents: 900, currency: "EUR", sales: [flash], listedAt: null },
      { productId: id(4), regularPriceCents: 4000, currency: "EUR", sales: [autumn], listedAt: null },
      { productId: id(5), regularPriceCents: 60, currency: "EUR", sales: [flash], listedAt: null },
    ];
    const board = await loadProductSales(createFakeAdmin(tables).admin, { ownerId: OWNER, products });
    for (const product of products) {
      const alone = await loadProductSale(createFakeAdmin(tables).admin, { ownerId: OWNER, ...product });
      expect(board.get(product.productId), product.productId).toEqual(alone);
    }
    // And the answers are not all the same thing, so the comparison means something.
    expect(board.get(id(1))?.sale?.priorPriceCents).toBe(2400);
    expect(board.get(id(2))?.sale?.priorPriceCents).toBeNull();
    expect(board.get(id(3))?.sale?.priorPriceCents).toBeNull();
    // 32.00 now, but 28.00 was charged in the window (the 30% sale on this
    // product alone): no percentage, and 28.00 is what the page states.
    expect(board.get(id(4))).toMatchObject({ priceCents: 3200, sale: { priorPriceCents: 2800, percentOff: null } });
    expect(board.get(id(5))).toMatchObject({ priceCents: 50 });
  });

  it("asks again one product at a time when a shared history read comes back short", async () => {
    const autumn = sale("autumn", 20, "2026-10-01T00:00:00Z");
    const products: PricedProduct[] = [1, 2, 3].map((n) => ({
      productId: id(n),
      regularPriceCents: 1000 * n,
      currency: "EUR",
      sales: [autumn],
      listedAt: null,
    }));
    const fake = createFakeAdmin({
      // Two rows each, six in all, where one read returns four: the OLDEST are
      // cut off, which are the ones that prove a price 30 days back.
      product_price_history: products.flatMap((product) => [
        historyRow(product.productId, product.regularPriceCents, "2026-03-01T00:00:00Z"),
        historyRow(product.productId, product.regularPriceCents, "2026-09-10T00:00:00Z"),
      ]),
    });
    fake.state.maxRows = 4;
    const pricing = await loadProductSales(fake.admin, { ownerId: OWNER, products });
    for (const product of products) {
      expect(pricing.get(product.productId)?.sale, product.productId).toMatchObject({
        priorPriceCents: product.regularPriceCents,
        percentOff: 20,
      });
    }
  });

  it("never throws: a client that cannot be reached leaves prices standing and announces nothing", async () => {
    quiet();
    const autumn = sale("autumn", 20, "2026-10-01T00:00:00Z");
    const fake = createFakeAdmin({ product_price_history: [historyRow(id(1), 2400, "2026-06-01T00:00:00Z")] });
    fake.state.fault = () => "throw";
    const pricing = await loadProductSales(fake.admin, {
      ownerId: OWNER,
      products: [{ productId: id(1), regularPriceCents: 2400, currency: "EUR", sales: [autumn], listedAt: null }],
    });
    expect(pricing.get(id(1))).toEqual({
      priceCents: 1920,
      sale: { regularPriceCents: 2400, priorPriceCents: null, percentOff: null, offerPercent: 20, endsAt: null },
    });
  });
});

describe("msUntilSaleEnds", () => {
  const priced = (endsAt: string | null) => ({
    priceCents: 100,
    sale: { regularPriceCents: 200, priorPriceCents: null, percentOff: null, offerPercent: 50, endsAt },
  });

  it("is the time to the earliest end among the sales behind the prices", () => {
    expect(
      msUntilSaleEnds([priced("2026-10-03T13:00:00Z"), priced("2026-10-03T12:00:05Z"), priced(null)], NOW),
    ).toBe(5000);
  });

  it("is null when nothing on sale has an end, and when nothing is on sale", () => {
    expect(msUntilSaleEnds([priced(null), { priceCents: 100, sale: null }], NOW)).toBeNull();
    expect(msUntilSaleEnds([], NOW)).toBeNull();
  });

  it("is never negative", () => {
    expect(msUntilSaleEnds([priced("2026-10-03T11:00:00Z")], NOW)).toBe(0);
  });
});
