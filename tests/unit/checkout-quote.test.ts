/**
 * THE QUOTE decides what an order costs, and refuses rather than adjusts.
 * These tests hold it to that: every price comes from the (fake) database
 * row, never from the request; a version must be chosen exactly; the tile's
 * manual sold-out flag counts; delivery is priced from the seller's own rates.
 * An order of many lines (a cart) is priced by the same rules: stock and the
 * per-order limit are counted over every line of a product, one currency per
 * order, a code covers the lines it names, a parcel and a download share one
 * order.
 *
 * quoteFromLines is exercised directly with a hand-built gate, so nothing here
 * spends a rate-limit token or needs the product page's loader.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { quoteFromLines, assessLines } = await import("@/lib/checkout/quote");
import type { Purchasable, PurchasableItem } from "@/lib/products/purchasable";
import type { ResolvedLinesCode } from "@/lib/discounts/public";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type { ActiveSale, ResolvedCode } from "@/types/discount";

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SMALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LARGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MUG = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ZINE = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";

const POLICY: SellerShippingPolicy = {
  ratesCurrency: "EUR",
  freeOverCents: 10_000,
  destinations: [
    { area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 },
    { area: "Europe", time: "3-5 days", countries: ["DE", "FR"], rateCents: 1200 },
  ],
};

type RowOverrides = Partial<{
  price_cents: number;
  currency: string;
  track_stock: boolean;
  stock_quantity: number | null;
  max_per_order: number | null;
  digital_file_key: string | null;
  purchase_url: string | null;
}>;

function gate(
  options: { soldOut?: boolean; row?: RowOverrides; policy?: SellerShippingPolicy; sales?: ActiveSale[] } = {},
): Purchasable {
  return {
    ownerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    storefront: { id: "99999999-9999-4999-8999-999999999999", name: "Studio" },
    config: DEFAULT_STOREFRONT_CONFIG,
    productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
    block: { type: "product", productId: PRODUCT, x: 0, y: 0, w: 2, h: 2, soldOut: options.soldOut ?? false },
    row: {
      id: PRODUCT,
      title: "Vase",
      description: null,
      price_cents: 2400,
      currency: "EUR",
      image_key: null,
      digital_file_key: null,
      gallery: [],
      option_groups: [
        {
          id: GROUP,
          name: "Size",
          display: "chip",
          options: [
            { id: SMALL, name: "Small", available: true },
            { id: LARGE, name: "Large", available: true },
            { id: GONE, name: "Giant", available: false },
          ],
        },
      ],
      details: {},
      documents: [],
      purchase_url: null,
      shipping_profile_id: null,
      max_per_order: 5,
      created_at: null,
      moderation_status: "ok",
      track_stock: false,
      stock_quantity: null,
      low_stock_threshold: 5,
      ...options.row,
    },
    seller: { businessName: "Studio" },
    shippingPolicy: options.policy ?? POLICY,
    sales: options.sales ?? [],
    storeSales: [],
    now: new Date("2026-10-03T12:00:00Z"),
  } as Purchasable;
}

/** Another product of the same store, as the gate would hand it over. */
function extra(id: string, row: RowOverrides & { title?: string } = {}, sales: ActiveSale[] = []): PurchasableItem {
  return {
    block: { type: "product", productId: id, x: 2, y: 0, w: 2, h: 2 },
    row: {
      ...gate().row,
      id,
      title: row.title ?? "Mug",
      price_cents: 1200,
      option_groups: [],
      ...row,
    },
    sales,
  } as PurchasableItem;
}

/** The gate of one product, as quoteFromLines takes it (plus any others). */
function linesGate(g: Purchasable, others: PurchasableItem[] = []) {
  const { block, row, sales, ...store } = g;
  return {
    store,
    items: new Map<string, PurchasableItem>([[row.id, { block, row, sales }], ...others.map((item) => [item.row.id, item] as const)]),
  };
}

async function quote(
  g: Purchasable,
  request: { optionIds?: string[]; quantity?: unknown; country?: string | null; code?: ResolvedCode },
) {
  return quoteFromLines(
    linesGate(g),
    {
      lines: [{ productId: PRODUCT, optionIds: request.optionIds ?? [SMALL], quantity: request.quantity ?? 1 }],
      country: "country" in request ? (request.country ?? null) : "IE",
    },
    request.code ? { ...request.code, covers: [PRODUCT] } : null,
  );
}

const SALE_ID = "11111111-1111-4111-8111-111111111111";
const CODE_ID = "22222222-2222-4222-8222-222222222222";
const sale = (percentOff: number): ActiveSale => ({
  id: SALE_ID,
  value: { type: "percent", percentOff },
  startsAt: "2026-09-01T00:00:00Z",
  endsAt: null,
});
const code = (value: ResolvedCode["value"]): ResolvedCode => ({ id: CODE_ID, code: "SUMMER10", value });

describe("quoteFromLines, one product", () => {
  it("prices from the row and the seller's rates: 2 × €24 + €4.50 to Ireland", async () => {
    const result = await quote(gate(), { quantity: 2 });
    expect(result).toMatchObject({
      ok: true,
      quote: {
        lines: [
          {
            unitPriceCents: 2400,
            quantity: 2,
            subtotalCents: 4800,
            selection: [{ label: "Size", value: "Small" }],
            isDigital: false,
          },
        ],
        subtotalCents: 4800,
        shippingCents: 450,
        totalCents: 5250,
        currency: "EUR",
        ships: true,
        hasDownloads: false,
      },
    });
  });

  it("prices delivery by the buyer's country, and frees it over the seller's threshold", async () => {
    const germany = await quote(gate(), { country: "de" });
    expect(germany.ok && germany.quote.shippingCents).toBe(1200);
    const bigOrder = await quote(gate({ row: { price_cents: 5000 } }), { quantity: 2 });
    expect(bigOrder.ok && bigOrder.quote.shippingCents).toBe(0);
  });

  it("refuses a version that is missing, unavailable, doubled or from another product", async () => {
    for (const optionIds of [[], [GONE], [SMALL, LARGE], ["12345678-1234-4234-8234-123456789012"]]) {
      expect(await quote(gate(), { optionIds })).toEqual({ ok: false, reason: "options", line: 0 });
    }
  });

  it("refuses the tile's manual sold-out flag, which the product row cannot see", async () => {
    expect(await quote(gate({ soldOut: true }), {})).toEqual({ ok: false, reason: "sold_out", line: 0 });
  });

  it("refuses rather than clamps a quantity, and tells sold out from too few", async () => {
    expect(await quote(gate(), { quantity: 6 })).toEqual({ ok: false, reason: "quantity", line: 0 });
    expect(await quote(gate(), { quantity: "2" })).toEqual({ ok: false, reason: "quantity", line: 0 });
    const few = gate({ row: { track_stock: true, stock_quantity: 1 } });
    expect(await quote(few, { quantity: 2 })).toEqual({ ok: false, reason: "insufficient_stock", line: 0 });
    const none = gate({ row: { track_stock: true, stock_quantity: 0 } });
    expect(await quote(none, { quantity: 1 })).toEqual({ ok: false, reason: "sold_out", line: 0 });
  });

  it("refuses delivery the seller has not priced or does not make", async () => {
    expect(await quote(gate(), { country: "US" })).toEqual({ ok: false, reason: "not_shipped_here" });
    expect(await quote(gate(), { country: null })).toEqual({ ok: false, reason: "not_shipped_here" });
    expect(await quote(gate({ policy: {} }), {})).toEqual({ ok: false, reason: "no_shipping_rates", line: 0 });
    // Rates in euro cannot price a product sold in dollars.
    expect(await quote(gate({ row: { currency: "USD" } }), {})).toEqual({
      ok: false,
      reason: "no_shipping_rates",
      line: 0,
    });
  });

  it("asks nothing about delivery for a download", async () => {
    const digital = gate({ row: { digital_file_key: "files/x/y-z.pdf" }, policy: {} });
    const result = await quote(digital, { country: null });
    expect(result).toMatchObject({
      ok: true,
      quote: { lines: [{ isDigital: true }], ships: false, hasDownloads: true, shippingCents: null, totalCents: 2400 },
    });
  });

  it("does not sell what the seller sells through their own link", async () => {
    const own = gate({ row: { purchase_url: "https://shop.example/vase" } });
    expect(await quote(own, {})).toEqual({ ok: false, reason: "not_found", line: 0 });
  });
});

describe("quoteFromLines with discounts", () => {
  it("prices a running sale per item, records it, and charges the fee base on what is paid", async () => {
    const result = await quote(gate({ sales: [sale(25)] }), { quantity: 2 });
    expect(result).toMatchObject({
      ok: true,
      quote: {
        lines: [{ regularUnitCents: 2400, unitPriceCents: 1800, subtotalCents: 3600, discount: { id: SALE_ID, cents: 1200 } }],
        itemsCents: 3600,
        credit: null,
        shippingCents: 450,
        totalCents: 4050,
      },
    });
  });

  it("lets a code that does better replace the sale, taken off the regular price", async () => {
    const result = await quote(gate({ sales: [sale(10)] }), {
      quantity: 2,
      code: code({ type: "percent", percentOff: 30 }),
    });
    expect(result).toMatchObject({
      ok: true,
      quote: {
        lines: [{ unitPriceCents: 2400, subtotalCents: 4800, amountCents: 3360, discount: { id: CODE_ID, cents: 1440 } }],
        codeCents: 1440,
        itemsCents: 3360,
        credit: { id: CODE_ID, code: "SUMMER10" },
        totalCents: 3810,
      },
    });
  });

  it("keeps the better sale but still credits the code the buyer came with", async () => {
    const result = await quote(gate({ sales: [sale(30)] }), { code: code({ type: "percent", percentOff: 10 }) });
    expect(result).toMatchObject({
      ok: true,
      quote: { lines: [{ unitPriceCents: 1680, discount: { id: SALE_ID, cents: 720 } }], codeCents: 0, credit: { id: CODE_ID } },
    });
  });

  it("measures free delivery on the items after discounts", async () => {
    // 2 x 50.00 = 100.00 earns free delivery; 10% off brings it under the threshold.
    const full = await quote(gate({ row: { price_cents: 5000 } }), { quantity: 2 });
    expect(full.ok && full.quote.shippingCents).toBe(0);
    const discounted = await quote(gate({ row: { price_cents: 5000 }, sales: [sale(10)] }), { quantity: 2 });
    expect(discounted.ok && discounted.quote.shippingCents).toBe(450);
  });

  it("never discounts the items below the smallest card payment", async () => {
    const result = await quote(gate({ row: { price_cents: 60 } }), {
      code: code({ type: "amount", amountOffCents: 500, currency: "EUR" }),
    });
    expect(result.ok && result.quote.itemsCents).toBe(50);
  });

  it("ignores an amount off in another currency", async () => {
    const result = await quote(gate(), { code: code({ type: "amount", amountOffCents: 500, currency: "USD" }) });
    expect(result).toMatchObject({ ok: true, quote: { itemsCents: 2400, lines: [{ discount: null }] } });
  });
});

describe("quoteFromLines, an order of many lines (a cart)", () => {
  const VASE = { productId: PRODUCT, optionIds: [SMALL], quantity: 1 };

  it("prices every line and charges delivery once, at the highest rate", () => {
    const result = quoteFromLines(
      linesGate(gate(), [extra(MUG)]),
      { lines: [VASE, { productId: MUG, optionIds: [], quantity: 3 }], country: "IE" },
    );
    expect(result).toMatchObject({
      ok: true,
      quote: {
        lines: [{ productId: PRODUCT, amountCents: 2400 }, { productId: MUG, quantity: 3, amountCents: 3600 }],
        itemsCents: 6000,
        shippingCents: 450,
        totalCents: 6450,
      },
    });
  });

  it("puts a parcel and a download in one order: delivery for the parcel, consent for the download", () => {
    const zine = extra(ZINE, { digital_file_key: "files/a/b-zine.pdf", price_cents: 800, title: "Zine" });
    const result = quoteFromLines(linesGate(gate(), [zine]), {
      lines: [VASE, { productId: ZINE, optionIds: [], quantity: 1 }],
      country: "IE",
    });
    expect(result).toMatchObject({ ok: true, quote: { ships: true, hasDownloads: true, itemsCents: 3200, shippingCents: 450 } });
  });

  it("measures free delivery on what ships, not on the downloads", () => {
    // 95.00 of parcels + 20.00 of download: still under the 100.00 threshold.
    const zine = extra(ZINE, { digital_file_key: "files/a/b-zine.pdf", price_cents: 2000, title: "Zine" });
    const result = quoteFromLines(linesGate(gate({ row: { price_cents: 9500 } }), [zine]), {
      lines: [VASE, { productId: ZINE, optionIds: [], quantity: 1 }],
      country: "IE",
    });
    expect(result.ok && result.quote.shippingCents).toBe(450);
  });

  it("counts stock and the per-order limit over every line of one product", () => {
    const shelf = gate({ row: { track_stock: true, stock_quantity: 3 } });
    const twoVersions = [
      { productId: PRODUCT, optionIds: [SMALL], quantity: 2 },
      { productId: PRODUCT, optionIds: [LARGE], quantity: 2 },
    ];
    expect(quoteFromLines(linesGate(shelf), { lines: twoVersions, country: "IE" })).toEqual({
      ok: false,
      reason: "insufficient_stock",
      line: 0,
    });
    // Each line alone is within the limit of 5; together they are not.
    const many = [
      { productId: PRODUCT, optionIds: [SMALL], quantity: 3 },
      { productId: PRODUCT, optionIds: [LARGE], quantity: 3 },
    ];
    expect(quoteFromLines(linesGate(gate()), { lines: many, country: "IE" })).toEqual({
      ok: false,
      reason: "quantity",
      line: 0,
    });
  });

  it("keeps one currency per order, refusing the line that differs", () => {
    const dollars = extra(MUG, { currency: "USD", digital_file_key: "files/a/b-mug.pdf" });
    expect(
      quoteFromLines(linesGate(gate(), [dollars]), {
        lines: [VASE, { productId: MUG, optionIds: [], quantity: 1 }],
        country: "IE",
      }),
    ).toEqual({ ok: false, reason: "currency", line: 1 });
  });

  it("says a line that is not for sale here is not found, by its own index", () => {
    expect(
      quoteFromLines(linesGate(gate()), {
        lines: [VASE, { productId: MUG, optionIds: [], quantity: 1 }],
        country: "IE",
      }),
    ).toEqual({ ok: false, reason: "not_found", line: 1 });
  });

  it("applies a code to the lines it covers, against those lines' sales, and leaves the rest on their sale", () => {
    const mug = extra(MUG, {}, [sale(50)]);
    const covers: ResolvedLinesCode = { id: CODE_ID, code: "SUMMER10", value: { type: "percent", percentOff: 20 }, covers: [PRODUCT] };
    const result = quoteFromLines(
      linesGate(gate(), [mug]),
      { lines: [VASE, { productId: MUG, optionIds: [], quantity: 1 }], country: "IE" },
      covers,
    );
    expect(result).toMatchObject({
      ok: true,
      quote: {
        lines: [
          { productId: PRODUCT, amountCents: 1920, discount: { id: CODE_ID, cents: 480 } },
          { productId: MUG, amountCents: 600, discount: { id: SALE_ID, cents: 600 } },
        ],
        codeCents: 480,
        itemsCents: 2520,
      },
    });
  });

  it("spreads an amount off over the covered lines so the lines add up exactly", () => {
    const covers: ResolvedLinesCode = {
      id: CODE_ID,
      code: "TENOFF",
      value: { type: "amount", amountOffCents: 1000, currency: "EUR" },
      covers: [PRODUCT, MUG],
    };
    const result = quoteFromLines(
      linesGate(gate(), [extra(MUG)]),
      { lines: [VASE, { productId: MUG, optionIds: [], quantity: 1 }], country: "IE" },
      covers,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 24.00 and 12.00 share 10.00 in proportion: 6.67 and 3.33.
    expect(result.quote.lines.map((line) => line.amountCents)).toEqual([1733, 867]);
    expect(result.quote.itemsCents).toBe(3600 - 1000);
  });

  it("tells each line's own problem without refusing the rest (what the cart shows)", () => {
    const assessed = assessLines(linesGate(gate({ row: { track_stock: true, stock_quantity: 0 } }), [extra(MUG)]), [
      VASE,
      { productId: MUG, optionIds: [], quantity: 2 },
      { productId: ZINE, optionIds: [], quantity: 1 },
    ]);
    expect(assessed.map((line) => (line.ok ? "ok" : line.problem))).toEqual(["sold_out", "ok", "not_found"]);
  });
});
