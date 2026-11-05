/**
 * "ADD TO YOUR ORDER": the pure pieces (pricing, delivery once per parcel, the
 * `?a=` link, the version a tap takes, the stored list) and the quote that
 * prices an order with add-ons. The quote runs against the filter-applying
 * fake database, so a reader that forgot to scope by owner, kind or status
 * would hand back the wrong product and fail here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin } from "../setup/fake-admin";

vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

let fake = createFakeAdmin();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));

const { quoteFromGate, paidAddOns } = await import("@/lib/checkout/quote");
const { loadAddOns } = await import("@/lib/products/add-ons");
const { offeredByATile } = await import("@/lib/products/purchasable");
import {
  addOnHiddenReason,
  chosenAddOns,
  hiddenAddOns,
  offeredAddOnCards,
} from "@/lib/products/add-on-visibility";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { priceAddOn } from "@/lib/discounts/pricing";
import { priceBasket } from "@/lib/checkout/basket";
import { quoteOrderShipping } from "@/lib/shipping/rates";
import { addOnSelectionIds } from "@/lib/checkout/selection";
import { parseAddOnIds } from "@/lib/products/detail";
import { addOnsParam, checkoutPath, requestedAddOns } from "@/lib/storefront/product-page-url";
import { productWriteSchema } from "@/lib/validation/product";
import { placeOrderSchema } from "@/lib/validation/checkout";
import { productPageSchema } from "@/lib/validation/storefront";
import { PAGE_BUSY } from "@/lib/public/busy";
import type { Purchasable } from "@/lib/products/purchasable";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import type { ResolvedCode } from "@/types/discount";

const OWNER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OTHER_OWNER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MAIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MUG = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COASTERS = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const ZINE = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const FOREIGN = "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4";
const SET = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const TWO = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const FOUR = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const SOLD = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const HEAVY = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const SALE_ID = "11111111-1111-4111-8111-111111111111";
const CODE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-28T12:00:00Z");

const POLICY: SellerShippingPolicy = {
  ratesCurrency: "EUR",
  freeOverCents: 10_000,
  destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
  profiles: [{ id: HEAVY, name: "Heavy", body: "", rateCents: 900 }],
};

/** A products row as the buyer path selects it. */
function productRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    owner_id: OWNER,
    status: "active",
    title: id === MUG ? "Mug" : id === COASTERS ? "Coasters" : id === ZINE ? "Zine" : "Thing",
    description: null,
    price_cents: 1200,
    currency: "EUR",
    image_key: null,
    digital_file_key: null,
    gallery: [],
    option_groups: [],
    details: {},
    documents: [],
    purchase_url: null,
    shipping_profile_id: null,
    max_per_order: 10,
    created_at: "2026-01-01T00:00:00Z",
    add_on_ids: [],
    moderation_status: "ok",
    track_stock: false,
    stock_quantity: null,
    low_stock_threshold: 5,
    ...overrides,
  };
}

const COASTER_GROUPS = [
  {
    id: SET,
    name: "Set",
    display: "chip",
    options: [
      { id: TWO, name: "Two", available: true },
      { id: FOUR, name: "Four", available: true },
      { id: SOLD, name: "Eight", available: false },
    ],
  },
];

function seed(extra: Record<string, unknown[]> = {}) {
  fake = createFakeAdmin({
    products: [
      productRow(MAIN, { price_cents: 2400, add_on_ids: [MUG, COASTERS, ZINE, FOREIGN] }),
      productRow(MUG),
      productRow(COASTERS, { price_cents: 1800, option_groups: COASTER_GROUPS }),
      productRow(ZINE, { digital_file_key: "files/x/zine.pdf" }),
      productRow(FOREIGN, { owner_id: OTHER_OWNER }),
    ],
    discounts: [],
    ...extra,
  });
}

function gate(overrides: Partial<Purchasable> = {}): Purchasable {
  const main = (fake.state.tables.products as Record<string, unknown>[]).find((row) => row.id === MAIN)!;
  return {
    ownerId: OWNER,
    storefront: { id: "99999999-9999-4999-8999-999999999999", name: "Studio" },
    config: DEFAULT_STOREFRONT_CONFIG,
    productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
    block: { type: "product", productId: MAIN, x: 0, y: 0, w: 2, h: 2 },
    row: main,
    seller: { businessName: "Studio" },
    shippingPolicy: POLICY,
    sales: [],
    now: NOW,
    ...overrides,
  } as Purchasable;
}

function quote(addOns: { productId: string; optionIds?: string[] }[], options: { code?: ResolvedCode; g?: Purchasable } = {}) {
  return quoteFromGate(
    options.g ?? gate(),
    {
      optionIds: [],
      quantity: 1,
      country: "IE",
      addOns: addOns.map((pick) => ({ productId: pick.productId, optionIds: pick.optionIds ?? [] })),
    },
    fake.admin,
    options.code ?? null,
  );
}

beforeEach(() => seed());

describe("pricing an add-on line", () => {
  it("takes its own sale, never below what the sale leaves", () => {
    expect(priceAddOn({ regularUnitCents: 1200, saleUnitCents: 900, quantity: 1 })).toEqual({
      unitPriceCents: 900,
      amountCents: 900,
      discountCents: 300,
      applied: "sale",
    });
    // A "sale" that does not lower the price is no sale.
    expect(priceAddOn({ regularUnitCents: 1200, saleUnitCents: 1500, quantity: 2 })).toEqual({
      unitPriceCents: 1200,
      amountCents: 2400,
      discountCents: 0,
      applied: null,
    });
  });

  it("adds the lines to the main product, and the code stays on the main product", () => {
    const basket = priceBasket({
      main: {
        regularUnitCents: 2400,
        currency: "EUR",
        quantity: 1,
        saleUnitCents: null,
        code: { type: "percent", percentOff: 10 },
      },
      addOns: [{ productId: MUG, regularUnitCents: 1200, saleUnitCents: null, quantity: 1 }],
    });
    expect(basket.main.itemsCents).toBe(2160);
    expect(basket.addOns[0]?.amountCents).toBe(1200);
    expect(basket.itemsCents).toBe(3360);
  });
});

describe("delivering one parcel", () => {
  it("charges the highest rate among its products, once", () => {
    const quoteFor = (profileIds: (string | null)[]) =>
      quoteOrderShipping(POLICY, { profileIds, country: "IE", subtotalCents: 3000, currency: "EUR" });
    expect(quoteFor([null])).toMatchObject({ ok: true, rateCents: 450 });
    expect(quoteFor([null, HEAVY, null])).toMatchObject({ ok: true, rateCents: 900 });
  });

  it("is free once the whole order reaches the threshold, and refuses where any product cannot go", () => {
    expect(
      quoteOrderShipping(POLICY, { profileIds: [null, HEAVY], country: "IE", subtotalCents: 10_000, currency: "EUR" }),
    ).toMatchObject({ ok: true, rateCents: 0, free: true });
    expect(
      quoteOrderShipping(POLICY, { profileIds: [null], country: "US", subtotalCents: 3000, currency: "EUR" }),
    ).toMatchObject({ ok: false, reason: "not_shipped_here" });
  });
});

describe("the ?a= link", () => {
  it("round-trips picks and keeps only the product's own add-ons, once each, capped", () => {
    const picks = [
      { productId: COASTERS, optionIds: [FOUR] },
      { productId: MUG, optionIds: [] },
    ];
    const path = checkoutPath("s", "p", { addOns: picks });
    const a = new URL(path, "https://x.test").searchParams.get("a");
    expect(a).toBe(addOnsParam(picks));
    expect(requestedAddOns({ a: a! }, [MUG, COASTERS])).toEqual(picks);
    // Not on the list, repeated, or not a uuid: dropped.
    expect(requestedAddOns({ a: `${FOREIGN},${MUG},${MUG},nope` }, [MUG])).toEqual([
      { productId: MUG, optionIds: [] },
    ]);
    expect(requestedAddOns({ a: `${COASTERS}.not-an-id.${TWO}` }, [COASTERS])).toEqual([
      { productId: COASTERS, optionIds: [TWO] },
    ]);
  });
});

describe("the version a tap takes", () => {
  it("is the one asked for when available, else the first available, else none", () => {
    const groups = COASTER_GROUPS as never;
    expect(addOnSelectionIds(groups, [FOUR])).toEqual([FOUR]);
    expect(addOnSelectionIds(groups, [SOLD])).toEqual([TWO]);
    expect(addOnSelectionIds(groups, [])).toEqual([TWO]);
    expect(
      addOnSelectionIds([{ ...COASTER_GROUPS[0], options: [{ id: SOLD, name: "Eight", available: false }] }] as never, []),
    ).toBeNull();
  });
});

describe("the stored list", () => {
  it("reads back uuids only, each once, at most four", () => {
    expect(parseAddOnIds(null)).toEqual([]);
    expect(parseAddOnIds([MUG, MUG, "x", COASTERS, ZINE, FOREIGN, MAIN])).toEqual([MUG, COASTERS, ZINE, FOREIGN]);
  });

  it("is written as at most four distinct product ids", () => {
    const base = {
      title: "Vase",
      description: "",
      priceCents: 2400,
      currency: "EUR",
      status: "draft",
    };
    expect(productWriteSchema.safeParse({ ...base, addOnIds: [MUG, COASTERS] }).success).toBe(true);
    expect(productWriteSchema.safeParse({ ...base, addOnIds: [MUG, MUG] }).success).toBe(false);
    expect(productWriteSchema.safeParse({ ...base, addOnIds: [MUG, COASTERS, ZINE, FOREIGN, MAIN] }).success).toBe(
      false,
    );
  });

  it("is carried by an order request as ids and versions only", () => {
    const order = {
      attemptId: "12345678-1234-4234-8234-123456789012",
      optionIds: [],
      quantity: 1,
      email: "a@example.com",
      locale: "en",
    };
    expect(placeOrderSchema.safeParse({ ...order, addOns: [{ productId: MUG, optionIds: [] }] }).success).toBe(true);
    // A price is never a field.
    expect(
      placeOrderSchema.safeParse({ ...order, addOns: [{ productId: MUG, optionIds: [], amountCents: 1 }] }).success,
    ).toBe(false);
  });
});

describe("offering add-ons", () => {
  it("offers only the store's own active products of the same kind and currency, in the seller's order", async () => {
    seed({});
    (fake.state.tables.products as Record<string, unknown>[]).push(
      productRow("a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5", { status: "draft" }),
      productRow("a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6", { currency: "USD" }),
    );
    const lines = await loadAddOns(fake.admin, {
      ownerId: OWNER,
      ids: [COASTERS, ZINE, FOREIGN, MUG, "a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5", "a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6"],
      isDigital: false,
      currency: "EUR",
      now: NOW,
      unreadableSales: "busy",
    });
    expect(lines === PAGE_BUSY ? lines : lines.map((line) => line.card.id)).toEqual([COASTERS, MUG]);
  });

  it("links an add-on to its own page where the caller says it has one, and nowhere without pages", async () => {
    const lines = await loadAddOns(fake.admin, {
      ownerId: OWNER,
      ids: [MUG, COASTERS],
      isDigital: false,
      currency: "EUR",
      now: NOW,
      unreadableSales: "busy",
      pages: { storefrontId: "store", linked: (id) => id === MUG },
    });
    expect(lines === PAGE_BUSY ? lines : lines.map((line) => line.card.pagePath)).toEqual([
      `/s/store/p/${MUG}`,
      null,
    ]);
    const noLinks = await loadAddOns(fake.admin, {
      ownerId: OWNER,
      ids: [MUG],
      isDigital: false,
      currency: "EUR",
      now: NOW,
      unreadableSales: "busy",
    });
    expect(noLinks === PAGE_BUSY ? noLinks : noLinks.map((line) => line.card.pagePath)).toEqual([null]);
  });

  it("reads each add-on's stars only when asked, and none for one without reviews", async () => {
    seed({
      product_rating_summaries: [
        { product_id: MUG, review_count: 12, average: "4.58" },
        { product_id: COASTERS, review_count: 0, average: null },
      ],
    });
    const input = {
      ownerId: OWNER,
      ids: [MUG, COASTERS],
      isDigital: false,
      currency: "EUR" as const,
      now: NOW,
      unreadableSales: "busy" as const,
    };
    const rated = await loadAddOns(fake.admin, { ...input, withRatings: true });
    expect(rated === PAGE_BUSY ? rated : rated.map((line) => line.card.rating)).toEqual([
      { average: 4.58, count: 12 },
      null,
    ]);
    fake.state.reads.length = 0;
    const plain = await loadAddOns(fake.admin, input);
    expect(plain === PAGE_BUSY ? plain : plain.map((line) => line.card.rating)).toEqual([null, null]);
    expect(fake.state.reads).not.toContain("product_rating_summaries");
    // A failed read costs the stars, never the page.
    fake.state.fault = (table) => (table === "product_rating_summaries" ? "error" : null);
    const failed = await loadAddOns(fake.admin, { ...input, withRatings: true });
    expect(failed === PAGE_BUSY ? failed : failed.map((line) => line.card.rating)).toEqual([null, null]);
  });

  it("leaves out a sold-out one, and says 'not right now' when the sales cannot be read", async () => {
    seed();
    const mug = (fake.state.tables.products as Record<string, unknown>[]).find((row) => row.id === MUG)!;
    mug.track_stock = true;
    mug.stock_quantity = 0;
    const input = { ownerId: OWNER, ids: [MUG], isDigital: false, currency: "EUR" as const, now: NOW };
    expect(await loadAddOns(fake.admin, { ...input, unreadableSales: "busy" })).toEqual([]);
    fake.state.fault = (table) => (table === "discounts" ? "error" : null);
    mug.track_stock = false;
    expect(await loadAddOns(fake.admin, { ...input, unreadableSales: "busy" })).toBe(PAGE_BUSY);
    const regular = await loadAddOns(fake.admin, { ...input, unreadableSales: "regular" });
    expect(regular === PAGE_BUSY ? regular : regular.map((line) => line.card.priceCents)).toEqual([1200]);
  });
});

describe("what is offered, and why not", () => {
  const host = { isDigital: false, currency: "EUR" as const };
  const facts = (extra: Partial<AddOnChoice> = {}): AddOnChoice => ({
    id: MUG,
    title: "Mug",
    priceCents: 1200,
    sale: null,
    currency: "EUR",
    imageUrl: null,
    status: "active",
    isDigital: false,
    soldOut: false,
    takenDown: false,
    ...extra,
  });

  it("names the most final reason first", () => {
    expect(addOnHiddenReason(facts(), host)).toBeNull();
    expect(addOnHiddenReason(facts({ status: "draft" }), host)).toBe("draft");
    expect(addOnHiddenReason(facts({ soldOut: true }), host)).toBe("soldOut");
    expect(addOnHiddenReason(facts({ isDigital: true }), host)).toBe("otherKind");
    expect(addOnHiddenReason(facts({ currency: "USD" }), host)).toBe("otherCurrency");
    expect(addOnHiddenReason(facts({ takenDown: true, status: "draft", soldOut: true }), host)).toBe("takenDown");
    expect(addOnHiddenReason(facts({ status: "draft", soldOut: true }), host)).toBe("draft");
  });

  it("splits four chosen into what buyers get and what the seller sees faded, in the seller's order", () => {
    const choices = [
      facts({ id: MUG, title: "Mug" }),
      facts({ id: COASTERS, title: "Coasters", status: "draft" }),
      facts({ id: ZINE, title: "Zine" }),
      facts({ id: FOREIGN, title: "Lamp", soldOut: true }),
    ];
    const chosen = chosenAddOns(choices, [COASTERS, MUG, FOREIGN, ZINE, "gone"]);
    expect(offeredAddOnCards(chosen, host).map((card) => card.id)).toEqual([MUG, ZINE]);
    expect(hiddenAddOns(chosen, host).map((entry) => [entry.title, entry.reason])).toEqual([
      ["Coasters", "draft"],
      ["Lamp", "soldOut"],
    ]);
  });
});

describe("an add-on's own page", () => {
  const STORE_PAGE = { ...DEFAULT_PRODUCT_PAGE_CONFIG };
  const here = (tileProductIds: string[], productPage = STORE_PAGE) => ({ tileProductIds, productPage });

  it("exists where a live product on this storefront offers it", async () => {
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([MAIN]))).toBe(true);
    // Not offered by any tile here.
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([COASTERS]))).toBe(false);
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([]))).toBe(false);
    // Another seller's product offering it does not count.
    expect(await offeredByATile(fake.admin, OTHER_OWNER, MUG, here([MAIN]))).toBe(false);
  });

  it("does not exist while the offering product is a draft or taken down, or the section is off", async () => {
    const main = (fake.state.tables.products as Record<string, unknown>[]).find((row) => row.id === MAIN)!;
    main.status = "draft";
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([MAIN]))).toBe(false);
    main.status = "active";
    main.moderation_status = "removed";
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([MAIN]))).toBe(false);
    main.moderation_status = "ok";
    const off = {
      ...STORE_PAGE,
      sections: STORE_PAGE.sections.map((entry) => (entry.id === "addOns" ? { ...entry, show: false } : entry)),
    };
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([MAIN], off))).toBe(false);
  });

  it("says 'not right now' when the database does not answer", async () => {
    fake.state.fault = (table) => (table === "products" ? "error" : null);
    expect(await offeredByATile(fake.admin, OWNER, MUG, here([MAIN]))).toBeNull();
  });
});

describe("how a storefront draws the section", () => {
  const page = (design: Record<string, unknown>) =>
    productPageSchema.safeParse({ ...DEFAULT_PRODUCT_PAGE_CONFIG, ...design }).success;

  it("takes a heading, a look and a place, all optional", () => {
    expect(page({})).toBe(true);
    expect(page({ addOnsTitle: "Goes well with", addOnsLayout: "tiles", addOnsPlacement: "afterButton" })).toBe(true);
  });

  it("refuses anything outside the closed lists, and a heading that is too long or carries a link", () => {
    expect(page({ addOnsLayout: "carousel" })).toBe(false);
    expect(page({ addOnsPlacement: "sidebar" })).toBe(false);
    expect(page({ addOnsTitle: "x".repeat(41) })).toBe(false);
    expect(page({ addOnsTitle: "Cheaper at my-other-site.shop" })).toBe(false);
  });
});

describe("the quote with add-ons", () => {
  it("charges the main product, each add-on and one delivery", async () => {
    const result = await quote([{ productId: MUG }, { productId: COASTERS, optionIds: [FOUR] }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.itemsCents).toBe(2400);
    expect(result.quote.addOnsCents).toBe(3000);
    expect(result.quote.shippingCents).toBe(450);
    expect(result.quote.totalCents).toBe(5850);
    expect(result.quote.addOns.map((line) => [line.title, line.amountCents, line.selection])).toEqual([
      ["Mug", 1200, []],
      ["Coasters", 1800, [{ label: "Set", value: "Four" }]],
    ]);
    expect(paidAddOns(result.quote)).toEqual([
      { productId: MUG, selection: [], unitPriceCents: 1200, quantity: 1, amountCents: 1200, discountId: null },
      {
        productId: COASTERS,
        selection: [{ label: "Set", value: "Four" }],
        unitPriceCents: 1800,
        quantity: 1,
        amountCents: 1800,
        discountId: null,
      },
    ]);
  });

  it("refuses anything the page would not have offered", async () => {
    for (const pick of [
      // Not on this product's list at all.
      { productId: "a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9" },
      // On the list, but another store's.
      { productId: FOREIGN },
      // On the list, but a download beside a parcel.
      { productId: ZINE },
      // A version it does not have in stock, or no version for a product with versions.
      { productId: COASTERS, optionIds: [SOLD] },
      { productId: COASTERS },
    ]) {
      expect(await quote([pick]), pick.productId).toEqual({ ok: false, reason: "add_on_unavailable" });
    }
    expect(await quote([{ productId: MUG }, { productId: MUG }])).toEqual({ ok: false, reason: "add_on_unavailable" });
  });

  it("refuses a sold-out add-on, and add-ons on a storefront that hides the section", async () => {
    const mug = (fake.state.tables.products as Record<string, unknown>[]).find((row) => row.id === MUG)!;
    mug.track_stock = true;
    mug.stock_quantity = 0;
    expect(await quote([{ productId: MUG }])).toEqual({ ok: false, reason: "add_on_unavailable" });
    mug.track_stock = false;
    const hidden = gate({
      productPage: {
        ...DEFAULT_PRODUCT_PAGE_CONFIG,
        sections: DEFAULT_PRODUCT_PAGE_CONFIG.sections.map((entry) =>
          entry.id === "addOns" ? { ...entry, show: false } : entry,
        ),
      },
    });
    expect(await quote([{ productId: MUG }], { g: hidden })).toEqual({ ok: false, reason: "add_on_unavailable" });
  });

  it("prices an add-on by its own sale, credits the sale, and keeps a code on the main product", async () => {
    seed({
      discounts: [
        {
          id: SALE_ID,
          owner_id: OWNER,
          kind: "automatic",
          code: null,
          share_channel: null,
          value_type: "percent",
          percent_off: 25,
          amount_off_cents: null,
          currency: null,
          applies_to: "products",
          product_ids: [MUG],
          starts_at: "2026-10-01T00:00:00Z",
          ends_at: null,
          usage_limit: null,
          enabled: true,
          archived_at: null,
          created_at: "2026-10-01T00:00:00Z",
        },
      ],
    });
    const result = await quote([{ productId: MUG }], {
      code: { id: CODE_ID, code: "TEN", value: { type: "percent", percentOff: 10 } } as ResolvedCode,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.itemsCents).toBe(2160);
    expect(result.quote.addOns[0]).toMatchObject({ unitPriceCents: 900, amountCents: 900, discount: { id: SALE_ID, cents: 300 } });
    expect(result.quote.totalCents).toBe(2160 + 900 + 450);
  });

  it("charges the heaviest parcel rate once when an add-on ships under its own terms", async () => {
    const mug = (fake.state.tables.products as Record<string, unknown>[]).find((row) => row.id === MUG)!;
    mug.shipping_profile_id = HEAVY;
    const result = await quote([{ productId: MUG }]);
    expect(result.ok && result.quote.shippingCents).toBe(900);
  });

  it("is the same quote as before for an order without add-ons", async () => {
    const result = await quote([]);
    expect(result.ok && [result.quote.totalCents, result.quote.addOns, result.quote.addOnsCents]).toEqual([2850, [], 0]);
  });
});
