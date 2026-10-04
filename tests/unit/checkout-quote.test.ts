/**
 * THE QUOTE decides what an order costs, and refuses rather than adjusts.
 * These tests hold it to that: every price comes from the (fake) database
 * row, never from the request; a version must be chosen exactly; the tile's
 * manual sold-out flag counts; delivery is priced from the seller's own rates.
 *
 * quoteFromGate is exercised directly with a hand-built gate, so nothing here
 * spends a rate-limit token or needs the product page's loader.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { quoteFromGate } = await import("@/lib/checkout/quote");
import type { Purchasable } from "@/lib/products/purchasable";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type { ActiveSale, ResolvedCode } from "@/types/discount";

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SMALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LARGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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
      moderation_status: "ok",
      track_stock: false,
      stock_quantity: null,
      low_stock_threshold: 5,
      ...options.row,
    },
    seller: { businessName: "Studio" },
    shippingPolicy: options.policy ?? POLICY,
    sales: options.sales ?? [],
    now: new Date("2026-10-03T12:00:00Z"),
  } as Purchasable;
}

/** The fake database the quantity authority reads: the gate's own row. */
function admin(g: Purchasable) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { ...g.row, status: "active" }, error: null }),
  };
  return { from: () => chain } as never;
}

async function quote(
  g: Purchasable,
  request: { optionIds?: string[]; quantity?: unknown; country?: string | null; code?: ResolvedCode },
) {
  return quoteFromGate(
    g,
    {
      optionIds: request.optionIds ?? [SMALL],
      quantity: request.quantity ?? 1,
      country: "country" in request ? (request.country ?? null) : "IE",
    },
    admin(g),
    request.code ?? null,
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

describe("quoteFromGate", () => {
  it("prices from the row and the seller's rates: 2 × €24 + €4.50 to Ireland", async () => {
    const result = await quote(gate(), { quantity: 2 });
    expect(result).toMatchObject({
      ok: true,
      quote: {
        unitPriceCents: 2400,
        quantity: 2,
        subtotalCents: 4800,
        shippingCents: 450,
        totalCents: 5250,
        currency: "EUR",
        selection: [{ label: "Size", value: "Small" }],
        isDigital: false,
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
      expect(await quote(gate(), { optionIds })).toEqual({ ok: false, reason: "options" });
    }
  });

  it("refuses the tile's manual sold-out flag, which the product row cannot see", async () => {
    expect(await quote(gate({ soldOut: true }), {})).toEqual({ ok: false, reason: "sold_out" });
  });

  it("refuses rather than clamps a quantity, and tells sold out from too few", async () => {
    expect(await quote(gate(), { quantity: 6 })).toEqual({ ok: false, reason: "quantity" });
    expect(await quote(gate(), { quantity: "2" })).toEqual({ ok: false, reason: "quantity" });
    const few = gate({ row: { track_stock: true, stock_quantity: 1 } });
    expect(await quote(few, { quantity: 2 })).toEqual({ ok: false, reason: "insufficient_stock" });
    const none = gate({ row: { track_stock: true, stock_quantity: 0 } });
    expect(await quote(none, { quantity: 1 })).toEqual({ ok: false, reason: "sold_out" });
  });

  it("refuses delivery the seller has not priced or does not make", async () => {
    expect(await quote(gate(), { country: "US" })).toEqual({ ok: false, reason: "not_shipped_here" });
    expect(await quote(gate(), { country: null })).toEqual({ ok: false, reason: "not_shipped_here" });
    expect(await quote(gate({ policy: {} }), {})).toEqual({ ok: false, reason: "no_shipping_rates" });
    // Rates in euro cannot price a product sold in dollars.
    expect(await quote(gate({ row: { currency: "USD" } }), {})).toEqual({
      ok: false,
      reason: "no_shipping_rates",
    });
  });

  it("asks nothing about delivery for a download", async () => {
    const digital = gate({ row: { digital_file_key: "files/x/y-z.pdf" }, policy: {} });
    const result = await quote(digital, { country: null });
    expect(result).toMatchObject({ ok: true, quote: { isDigital: true, shippingCents: null, totalCents: 2400 } });
  });
});

describe("quoteFromGate with discounts", () => {
  it("prices a running sale per item, records it, and charges the fee base on what is paid", async () => {
    const result = await quote(gate({ sales: [sale(25)] }), { quantity: 2 });
    expect(result).toMatchObject({
      ok: true,
      quote: {
        regularUnitCents: 2400,
        unitPriceCents: 1800,
        subtotalCents: 3600,
        itemsCents: 3600,
        discount: { id: SALE_ID, cents: 1200 },
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
        unitPriceCents: 2400,
        subtotalCents: 4800,
        itemsCents: 3360,
        discount: { id: CODE_ID, cents: 1440 },
        credit: { id: CODE_ID, code: "SUMMER10" },
        totalCents: 3810,
      },
    });
  });

  it("keeps the better sale but still credits the code the buyer came with", async () => {
    const result = await quote(gate({ sales: [sale(30)] }), { code: code({ type: "percent", percentOff: 10 }) });
    expect(result).toMatchObject({
      ok: true,
      quote: { unitPriceCents: 1680, discount: { id: SALE_ID, cents: 720 }, credit: { id: CODE_ID } },
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
    expect(result).toMatchObject({ ok: true, quote: { itemsCents: 2400, discount: null } });
  });
});
