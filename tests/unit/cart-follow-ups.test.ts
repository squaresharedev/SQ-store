import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cart's follow-ups, as rules:
 *
 *   - quickAddFor: a card adds straight to the cart only what needs no choice
 *     and what the quote would sell as one item now;
 *   - lineStatesOf / orderReviewItems: each product of an order is reviewed on
 *     its own, a product refunded on every one of its lines is not, and two
 *     versions of one product share one review;
 *   - cartSuggestions: the seller's add-on picks, in the cart's order, never
 *     what is in the cart, never another currency, at most three, and none
 *     when switched off.
 */

const store = vi.hoisted(() => ({ items: new Map<string, unknown>(), fail: false }));
vi.mock("@/lib/products/purchasable", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/products/purchasable")>()),
  loadStoreItems: vi.fn(async (_store: unknown, ids: readonly string[]) =>
    store.fail ? null : new Map([...store.items].filter(([id]) => ids.includes(id))),
  ),
}));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://r2.test/${key}`) }));

const { quickAddFor } = await import("@/lib/cart/quick-add");
const { lineStatesOf } = await import("@/lib/orders/line-states");
const { orderReviewItems, orderReviewSummary } = await import("@/lib/reviews/eligibility");
const { cartSuggestions } = await import("@/lib/cart/suggestions");

const ID = (n: number) => `5a000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const option = (n: number) => ({ id: ID(80 + n), name: `Option ${n}`, available: true });

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: ID(n),
    title: `Product ${n}`,
    price_cents: 1000 + n,
    currency: "EUR",
    image_key: `images/${n}.webp`,
    gallery: [],
    purchase_url: null,
    option_groups: [],
    digital_file_key: `files/${n}.pdf`,
    max_per_order: 10,
    track_stock: false,
    stock_quantity: null,
    low_stock_threshold: 0,
    add_on_ids: [],
    moderation_status: null,
    ...extra,
  };
}

const shippingPolicy = {};

describe("quickAddFor", () => {
  it("adds a product with no versions, or one option per group", () => {
    expect(quickAddFor(row(1), null, { shippingPolicy })).toEqual({ optionIds: [] });
    const groups = [
      { id: ID(70), name: "Size", display: "chip", options: [option(1)] },
      { id: ID(71), name: "Colour", display: "chip", options: [option(2)] },
    ];
    expect(quickAddFor(row(2, { option_groups: groups }), null, { shippingPolicy })).toEqual({
      optionIds: [ID(81), ID(82)],
    });
  });

  it("opens the page for a choice to make, or a line the quote would refuse", () => {
    const choice = [{ id: ID(70), name: "Size", display: "chip", options: [option(1), option(2)] }];
    expect(quickAddFor(row(3, { option_groups: choice }), null, { shippingPolicy })).toBeNull();
    // The seller's own purchase link: their site sells it.
    expect(quickAddFor(row(4, { purchase_url: "https://seller.example/buy" }), null, { shippingPolicy })).toBeNull();
    // None left, or the tile marked sold out.
    expect(quickAddFor(row(5, { track_stock: true, stock_quantity: 0 }), null, { shippingPolicy })).toBeNull();
    expect(quickAddFor(row(6), { soldOut: true }, { shippingPolicy })).toBeNull();
    // The one option of its only group is not offered right now.
    const unavailable = [{ id: ID(70), name: "Size", display: "chip", options: [{ ...option(1), available: false }] }];
    expect(quickAddFor(row(8, { option_groups: unavailable }), null, { shippingPolicy })).toBeNull();
    // A parcel whose delivery cannot be priced in its currency.
    expect(quickAddFor(row(7, { digital_file_key: null }), null, { shippingPolicy })).toBeNull();
  });
});

describe("reviews per product", () => {
  const paid = { status: "paid", refunded_at: null };
  const live = new Map([
    [ID(1), { status: "active", moderation_status: "ok" }],
    [ID(2), { status: "active", moderation_status: "ok" }],
    [ID(3), { status: "draft", moderation_status: "ok" }],
  ]);

  it("lists each product once, in line order, from the order and its lines", () => {
    const states = lineStatesOf(
      [{ id: "o1", product_id: ID(1) }],
      [
        { id: "l2", order_id: "o1", product_id: ID(2), position: 1 },
        { id: "l1", order_id: "o1", product_id: ID(1), position: 0 },
        { id: "lx", order_id: "other", product_id: ID(3), position: 0 },
      ],
      [{ order_id: "o1", line_id: null }],
    ).get("o1")!;
    expect(states).toEqual([
      { lineId: null, productId: ID(1), refunded: true },
      { lineId: "l1", productId: ID(1), refunded: false },
      { lineId: "l2", productId: ID(2), refunded: false },
    ]);
    // The first line refunded, its second version not: still reviewable.
    expect(orderReviewItems(paid, states, live, new Set())).toEqual([
      { productId: ID(1), state: "open" },
      { productId: ID(2), state: "open" },
    ]);
  });

  it("closes a product refunded on every line, or no longer live, and sums the order up", () => {
    const states = [
      { lineId: null, productId: ID(1), refunded: true },
      { lineId: "l2", productId: ID(2), refunded: false },
      { lineId: "l3", productId: ID(3), refunded: false },
    ];
    const items = orderReviewItems(paid, states, live, new Set([ID(2)]));
    expect(items).toEqual([
      { productId: ID(1), state: "closed" },
      { productId: ID(2), state: "done" },
      { productId: ID(3), state: "closed" },
    ]);
    expect(orderReviewSummary(items)).toBe("done");
    expect(orderReviewSummary([{ state: "closed" }, { state: "open" }])).toBe("open");
    expect(orderReviewSummary([])).toBe("closed");
    // A refunded order closes everything.
    expect(orderReviewItems({ status: "refunded", refunded_at: "x" }, states, live, new Set()).map((i) => i.state)).toEqual([
      "closed",
      "closed",
      "closed",
    ]);
  });
});

describe("cartSuggestions", () => {
  const productPage = { sections: undefined } as never;
  function gate(cartRows: ReturnType<typeof row>[], config: Record<string, unknown> = {}) {
    return {
      store: {
        ownerId: ID(90),
        storefront: { id: ID(91), name: "Shop" },
        config: { blocks: [], cartPage: config },
        productPage,
        storeSales: [],
        shippingPolicy: {},
        seller: {},
        now: new Date(),
      },
      items: new Map(cartRows.map((entry) => [entry.id, { block: null, row: entry, sales: [] }])),
    } as never;
  }
  const cart = (ids: string[]) => ({
    closed: false,
    lines: ids.map((productId) => ({ productId, optionIds: [], quantity: 1, source: "cart" as const, addedAt: "" })),
  });

  beforeEach(() => {
    store.fail = false;
    store.items = new Map(
      [row(10), row(11, { currency: "USD" }), row(12), row(13), row(14), row(2)].map((entry) => [
        entry.id,
        { block: null, row: entry, sales: [] },
      ]),
    );
  });

  it("suggests the seller's picks in the cart's order, never one in the cart or in another currency, at most three", async () => {
    const picks = await cartSuggestions(
      gate([row(1, { add_on_ids: [ID(2), ID(10), ID(11)] }), row(2, { add_on_ids: [ID(12), ID(13), ID(14)] })]),
      cart([ID(1), ID(2)]),
      "EUR",
    );
    expect(picks.map((pick) => pick.productId)).toEqual([ID(10), ID(12), ID(13)]);
    expect(picks[0]).toMatchObject({ unitCents: 1010, regularUnitCents: null, quickAdd: { optionIds: [] } });
    expect(picks[0]!.href).toContain(ID(10));
  });

  it("suggests nothing when switched off, for a paid cart, or when the read fails", async () => {
    const withPicks = gate([row(1, { add_on_ids: [ID(10)] })], { suggestions: false });
    expect(await cartSuggestions(withPicks, cart([ID(1)]), "EUR")).toEqual([]);
    const open = gate([row(1, { add_on_ids: [ID(10)] })]);
    expect(await cartSuggestions(open, { ...cart([ID(1)]), closed: true }, "EUR")).toEqual([]);
    store.fail = true;
    expect(await cartSuggestions(open, cart([ID(1)]), "EUR")).toEqual([]);
  });
});

describe("sampleCartView", () => {
  const product = (n: number, extra: Partial<{ priceCents: number; regularPriceCents: number; currency: "EUR" | "USD" }> = {}) => ({
    id: ID(n),
    title: `Product ${n}`,
    priceCents: 1000,
    currency: "EUR" as const,
    image: null,
    ...extra,
  });
  const products = [product(1), product(2, { priceCents: 500, regularPriceCents: 800 }), product(3, { currency: "USD" }), product(4), product(5), product(6)];

  it("fills a cart from the seller's own products, the one on screen first, in its currency", async () => {
    const { sampleCartView } = await import("@/lib/cart/sample");
    const full = sampleCartView(products, { state: "full", freeOverCents: 5000 });
    expect(full.lines.map((line) => [line.productId, line.quantity])).toEqual([
      [ID(1), 1],
      [ID(2), 2],
      [ID(4), 1],
    ]);
    expect(full.lines[1]).toMatchObject({ unitCents: 500, regularUnitCents: 800, amountCents: 1000 });
    expect(full).toMatchObject({ count: 4, itemsCents: 3000, freeDeliveryGapCents: 2000, canCheckout: true });
    expect(full.suggestions.map((item) => item.productId)).toEqual([ID(5), ID(6)]);
  });

  it("offers the seller's own picks as Goes well with, never a line or another currency, at most three", async () => {
    const { sampleCartView } = await import("@/lib/cart/sample");
    const picks = [product(2), product(7), product(3, { currency: "USD" }), product(8), product(9), product(10)];
    const view = sampleCartView([product(1), product(2)], { state: "full", suggestions: picks });
    expect(view.suggestions.map((item) => item.productId)).toEqual([ID(7), ID(8), ID(9)]);
  });

  it("makes the designer's cart of the page on screen, then the board's products a card adds", async () => {
    const { sampleCartProducts } = await import("@/lib/cart/sample");
    const board = [
      { ...product(1), addable: true },
      { ...product(4), addable: false },
      { ...product(5, { currency: "USD" }), addable: true },
      { ...product(6), addable: true },
      { ...product(6), addable: true },
      { ...product(11), addable: true },
      { ...product(12), addable: true },
    ];
    const { lines, suggestions } = sampleCartProducts(product(1), board, [product(6), product(13)]);
    expect(lines.map((line) => line.id)).toEqual([ID(1), ID(6), ID(11)]);
    expect(suggestions.map((pick) => pick.id)).toEqual([ID(13)]);
    // Nothing else on the board: the page's own product alone.
    expect(sampleCartProducts(product(1), [], []).lines.map((line) => line.id)).toEqual([ID(1)]);
  });

  it("reads a catalogue product's sale as what one costs now", async () => {
    const { sampleFromProduct } = await import("@/lib/cart/sample");
    const sale = { price: 8, offerPercent: 20 };
    expect(
      sampleFromProduct({ id: ID(1), title: "Mug", price: 10, currency: "EUR", imageUrl: "https://r2.test/m.webp", sale }),
    ).toEqual({
      id: ID(1),
      title: "Mug",
      priceCents: 800,
      regularPriceCents: 1000,
      currency: "EUR",
      image: { url: "https://r2.test/m.webp", alt: "Mug" },
    });
  });

  it("steps and removes lines on the canvas, working the figures out again", async () => {
    const { sampleCartView, withSampleEdits, NO_SAMPLE_CART_EDITS } = await import("@/lib/cart/sample");
    const full = sampleCartView(products, { state: "full", freeOverCents: 5000 });
    expect(withSampleEdits(full, NO_SAMPLE_CART_EDITS)).toBe(full);
    const stepped = withSampleEdits(full, { quantities: { [ID(1)]: 3 }, removed: [ID(4)] });
    expect(stepped.lines.map((line) => [line.productId, line.quantity, line.amountCents])).toEqual([
      [ID(1), 3, 3000],
      [ID(2), 2, 1000],
    ]);
    expect(stepped).toMatchObject({ count: 5, itemsCents: 4000, freeDeliveryGapCents: 1000, canCheckout: true });
    const emptied = withSampleEdits(full, { quantities: {}, removed: [ID(1), ID(2), ID(4)] });
    expect(emptied).toMatchObject({ lines: [], count: 0, suggestions: [], canCheckout: false, delivery: { kind: "none" } });
  });

  it("shows the empty cart and a line that cannot be bought on request", async () => {
    const { sampleCartView } = await import("@/lib/cart/sample");
    const empty = sampleCartView(products, { state: "empty" });
    expect(empty).toMatchObject({ lines: [], count: 0, suggestions: [], canCheckout: false, delivery: { kind: "none" } });
    const problem = sampleCartView(products, { state: "problem" });
    expect(problem.lines.at(-1)).toMatchObject({ problem: "sold_out", amountCents: null });
    expect(problem.canCheckout).toBe(false);
  });
});
