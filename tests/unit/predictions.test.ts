import { describe, expect, it } from "vitest";
import { agreed } from "@/lib/suggestions/rules";
import {
  addOnHabits,
  carrierFor,
  carrierHabits,
  carryOverDesign,
  embedDomainsElsewhere,
  firstPlaceable,
  forecastRestocks,
  homeCurrency,
  NO_ADD_ON_HABITS,
  predictDiscountDefaults,
  predictProductDefaults,
  predictShippingDefaults,
  rankProductsToPlace,
  suggestAddOns,
  withCarrier,
  type RecentProduct,
} from "@/lib/predictions";
import { copyOptionGroups } from "@/lib/products/option-presets";
import type { DiscountView } from "@/types/discount";
import type { Product, ProductOptionGroup } from "@/types/product";
import {
  DEFAULT_CHECKOUT_PAGE_CONFIG,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";

const NOW = new Date("2026-10-31T12:00:00Z");

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    title: id,
    description: "",
    price: 10,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
    maxPerOrder: 10,
    ...overrides,
  } as Product;
}

const sold = (unitsSold: number) => ({ unitsSold, revenueCents: 0, currency: "EUR" as const });

function recent(overrides: Partial<RecentProduct> = {}): RecentProduct {
  return {
    title: "Mug",
    currency: "EUR",
    shippingProfileId: null,
    details: {},
    optionGroups: [],
    lowStockThreshold: 5,
    maxPerOrder: 10,
    ...overrides,
  };
}

function discount(percentOff: number | null, days: number | null, shareChannel: string | null = null): DiscountView {
  const startsAt = "2026-10-01T10:00:00.000Z";
  return {
    value: percentOff === null ? { type: "amount", amountOffCents: 500, currency: "EUR" } : { type: "percent", percentOff },
    startsAt,
    // A few seconds off the whole day, as a preset pressed before saving is.
    endsAt: days === null ? null : new Date(Date.parse(startsAt) + days * 86_400_000 - 5_000).toISOString(),
    shareChannel,
  } as DiscountView;
}

const SIZES: ProductOptionGroup = {
  id: "g1",
  name: "Size",
  display: "chip",
  options: [
    { id: "o1", name: "S", available: false, details: { weight: { value: 1, unit: "kg" } } },
    { id: "o2", name: "M", available: true },
  ],
};

describe("agreed", () => {
  it("answers only when the newest records all match", () => {
    expect(agreed(["a", "a", "a"])).toBe("a");
    expect(agreed(["a", "b", "a"])).toBeNull();
  });

  it("looks no further back than the newest three", () => {
    expect(agreed(["a", "a", "a", "b"])).toBe("a");
  });

  it("wants the minimum number of records", () => {
    expect(agreed([], 1)).toBeNull();
    expect(agreed(["a"], 2)).toBeNull();
    expect(agreed(["a", "a"], 2)).toBe("a");
  });
});

describe("rankProductsToPlace", () => {
  const catalogue = [product("newest"), product("seller"), product("edited")];

  it("puts what was touched this week first, then what sells, then newest", () => {
    const ranked = rankProductsToPlace(
      catalogue,
      { seller: sold(5) },
      { id: "edited", at: "2026-10-30T12:00:00Z" },
      NOW,
    );
    expect(ranked.map(({ id }) => id)).toEqual(["edited", "seller", "newest"]);
  });

  it("ignores a touch older than a week", () => {
    const ranked = rankProductsToPlace(
      catalogue,
      { seller: sold(5) },
      { id: "edited", at: "2026-10-20T12:00:00Z" },
      NOW,
    );
    expect(ranked.map(({ id }) => id)).toEqual(["seller", "newest", "edited"]);
  });

  it("keeps the catalogue's order with no signals, and leaves the input alone", () => {
    expect(rankProductsToPlace(catalogue, {}, null, NOW).map(({ id }) => id)).toEqual(["newest", "seller", "edited"]);
    expect(catalogue[0]?.id).toBe("newest");
  });
});

describe("firstPlaceable", () => {
  it("skips drafts, takedowns and sold-out products", () => {
    const placeable = firstPlaceable([
      product("draft", { status: "draft" }),
      product("removed", { removal: {} as Product["removal"] }),
      product("gone", { trackStock: true, stockQuantity: 0 }),
      product("fine", { trackStock: true, stockQuantity: 2 }),
    ]);
    expect(placeable?.id).toBe("fine");
  });

  it("has no answer when nothing qualifies", () => {
    expect(firstPlaceable([])).toBeNull();
    expect(firstPlaceable([product("draft", { status: "draft" })])).toBeNull();
  });
});

describe("forecastRestocks", () => {
  const stock = (id: string, stockQuantity: number, lowStockThreshold = 5) => ({
    id,
    title: id,
    stockQuantity,
    lowStockThreshold,
  });

  it("warns of what sells out within a week at its four-week pace, soonest first", () => {
    // 28 sold in 28 days is one a day.
    const forecast = forecastRestocks([stock("slow", 40), stock("week", 6), stock("soon", 2)], {
      slow: 28,
      week: 28,
      soon: 28,
    });
    expect(forecast).toEqual([
      { id: "soon", title: "soon", daysLeft: 2 },
      { id: "week", title: "week", daysLeft: 6 },
    ]);
  });

  it("calls a sale a day with one left a day, never zero", () => {
    expect(forecastRestocks([stock("last", 1)], { last: 56 })).toEqual([{ id: "last", title: "last", daysLeft: 1 }]);
  });

  it("forecasts nothing from one sale, or for what is already gone", () => {
    expect(forecastRestocks([stock("once", 1)], { once: 1 })).toEqual([]);
    expect(forecastRestocks([stock("gone", 0)], { gone: 50 })).toEqual([]);
    expect(forecastRestocks([stock("unsold", 1)], {})).toEqual([]);
  });

  it("stays quiet about a product whose low-stock alert is off", () => {
    expect(forecastRestocks([stock("last batch", 2, 0)], { "last batch": 28 })).toEqual([]);
  });
});

describe("predictProductDefaults", () => {
  it("suggests nothing for a store's first product", () => {
    expect(predictProductDefaults([], [])).toEqual({});
  });

  it("follows the currency most of the newest three use, the newest winning a tie", () => {
    const usd = recent({ currency: "USD" });
    expect(predictProductDefaults([usd], []).currency).toBe("USD");
    // Moving to dollars: one odd product does not move it, the second does.
    expect(predictProductDefaults([usd, recent(), recent()], []).currency).toBe("EUR");
    expect(predictProductDefaults([usd, usd, recent()], []).currency).toBe("USD");
    expect(predictProductDefaults([usd, recent()], []).currency).toBe("USD");
    // Nothing older than the newest three counts.
    expect(predictProductDefaults([usd, usd, recent(), recent(), recent()], []).currency).toBe("USD");
  });

  it("prices a first product in the business country's currency, and a store's own wins after that", () => {
    expect(predictProductDefaults([], [], "US").currency).toBe("USD");
    expect(predictProductDefaults([], [], "CA").currency).toBe("USD");
    expect(predictProductDefaults([], [], "FR").currency).toBe("EUR");
    expect(predictProductDefaults([], [], undefined)).toEqual({});
    expect(predictProductDefaults([recent()], [], "US").currency).toBe("EUR");
    expect(homeCurrency("IE")).toBe("EUR");
    expect(homeCurrency(undefined)).toBeNull();
  });

  it("wants two products on a shipping profile that still exists", () => {
    const onProfile = recent({ shippingProfileId: "p1" });
    expect(predictProductDefaults([onProfile], ["p1"]).shippingProfileId).toBeUndefined();
    expect(predictProductDefaults([onProfile, onProfile], ["p1"]).shippingProfileId).toBe("p1");
    expect(predictProductDefaults([onProfile, onProfile], []).shippingProfileId).toBeUndefined();
    expect(predictProductDefaults([onProfile, recent()], ["p1"]).shippingProfileId).toBeUndefined();
  });

  it("reads units only from products that state them", () => {
    const measured = recent({
      details: { dimensions: { length: 1, width: 1, height: 1, unit: "in" }, weight: { value: 1, unit: "lb" } },
    });
    expect(predictProductDefaults([recent(), measured], [])).toMatchObject({ dimensionUnit: "in", weightUnit: "lb" });
  });

  it("wants two products that agree on the stock numbers", () => {
    const tuned = recent({ lowStockThreshold: 2, maxPerOrder: 1 });
    expect(predictProductDefaults([tuned], [])).not.toHaveProperty("maxPerOrder");
    expect(predictProductDefaults([tuned, tuned], [])).toMatchObject({ lowStockThreshold: 2, maxPerOrder: 1 });
    expect(predictProductDefaults([tuned, recent()], [])).not.toHaveProperty("lowStockThreshold");
  });

  it("offers ONE product to copy from: its options, specifications and maker, not its own item facts", () => {
    const made = recent({
      title: "Bowl",
      optionGroups: [SIZES],
      details: {
        materials: "Stoneware",
        origin: "Portugal",
        safety: {
          manufacturerName: "Kiln Co",
          manufacturerAddress: "1 Clay Road",
          manufacturerEmail: "hi@kiln.example",
          responsibleName: "EU Rep",
          identifier: "BWL-1",
          warnings: "Hot",
        },
      },
    });
    expect(predictProductDefaults([recent(), made], []).sameAs).toEqual({
      from: "Bowl",
      value: {
        optionGroups: [SIZES],
        facts: { materials: "Stoneware", origin: "Portugal" },
        safety: {
          manufacturerName: "Kiln Co",
          manufacturerAddress: "1 Clay Road",
          manufacturerEmail: "hi@kiln.example",
          responsibleName: "EU Rep",
        },
      },
    });
  });

  it("never mixes two products: the newest with anything is the one", () => {
    const vase = recent({ title: "Vase", details: { materials: "Glass" } });
    const shirt = recent({ title: "Shirt", optionGroups: [SIZES] });
    expect(predictProductDefaults([vase, shirt], []).sameAs).toEqual({
      from: "Vase",
      value: { facts: { materials: "Glass" } },
    });
  });

  it("does not offer a maker with half its details, or a product with nothing to copy", () => {
    const partial = recent({
      details: { safety: { manufacturerName: "Half", manufacturerAddress: "", manufacturerEmail: "" } },
    });
    expect(predictProductDefaults([partial, recent()], []).sameAs).toBeUndefined();
  });

  it("offers the seller's own badges, most used first, without where they sat", () => {
    const handmade = { icon: "hand-heart", label: "Handmade", placement: "photo-top-left" } as const;
    const local = { icon: "map-pin", label: "Made in Porto", color: "blue" } as const;
    const suggested = predictProductDefaults(
      [
        recent({ details: { badges: [local] } }),
        recent({ details: { badges: [handmade, local] } }),
        recent({ details: { badges: [{ ...handmade, label: "handmade " }] } }),
      ],
      [],
    );
    expect(suggested.badges).toEqual([
      { icon: "map-pin", label: "Made in Porto", color: "blue" },
      { icon: "hand-heart", label: "Handmade" },
    ]);
  });
});

describe("copyOptionGroups", () => {
  it("copies the axes and choices under fresh ids, all on sale, without per-version facts", () => {
    let next = 0;
    const [copy] = copyOptionGroups([SIZES], () => `new-${(next += 1)}`);
    expect(copy).toEqual({
      id: "new-1",
      name: "Size",
      display: "chip",
      options: [
        { id: "new-2", name: "S", available: true },
        { id: "new-3", name: "M", available: true },
      ],
    });
  });
});

describe("predictDiscountDefaults", () => {
  it("follows a percent and a run two discounts share", () => {
    expect(predictDiscountDefaults([discount(20, 7), discount(20, 7)])).toEqual({ percent: 20, days: 7 });
  });

  it("does not make a habit of one discount", () => {
    expect(predictDiscountDefaults([discount(20, 7)])).toEqual({});
  });

  it("stays out of it when they differ or have no end", () => {
    expect(predictDiscountDefaults([discount(20, 7), discount(30, 3)])).toEqual({});
    expect(predictDiscountDefaults([discount(null, null), discount(null, null)])).toEqual({});
  });

  it("lists the channels codes went out on, most used first, once each", () => {
    const channels = predictDiscountDefaults([
      discount(10, null, "Pinterest"),
      discount(10, null, "Newsletter"),
      discount(10, null, "newsletter"),
      discount(10, null, " "),
      discount(10, null),
    ]).channels;
    expect(channels).toEqual(["Newsletter", "Pinterest"]);
  });
});

describe("carryOverDesign", () => {
  const theme = DEFAULT_STOREFRONT_CONFIG.theme;
  const config = (overrides: Partial<StorefrontConfig>): StorefrontConfig => ({
    ...DEFAULT_STOREFRONT_CONFIG,
    ...overrides,
  });

  it("keeps the look but not the board's height", () => {
    const carried = carryOverDesign(config({ theme: { ...theme, accent: "#ff0000", columns: 4, rows: 40 } }));
    expect(carried.theme).toMatchObject({ accent: "#ff0000", columns: 4, rows: theme.rows });
  });

  it("leaves uploaded files behind", () => {
    const uploaded = {
      ...theme,
      font: "custom",
      customFont: { key: "fonts/u/a.woff2", name: "A" },
      background: { kind: "image", key: "images/u/a.webp", x: 50, y: 50, scale: 1 },
    } as StorefrontTheme;
    const carried = carryOverDesign(
      config({
        theme: uploaded,
        productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, font: "custom", backgroundImage: { key: "images/u/p.webp" } },
        checkoutPage: {
          ...DEFAULT_CHECKOUT_PAGE_CONFIG,
          backgroundImage: { key: "images/u/c.webp" },
          thanksBackgroundImage: { key: "images/u/t.webp" },
        },
      }),
    );
    expect(carried.theme.customFont).toBeUndefined();
    expect(carried.theme.font).toBe(theme.font);
    expect(carried.theme.background).toEqual(theme.background);
    expect(carried.productPage).not.toHaveProperty("font");
    expect(JSON.stringify(carried)).not.toMatch(/fonts\/u|images\/u/);
  });

  it("carries the product page and checkout as they were set up", () => {
    const carried = carryOverDesign(
      config({
        productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "Get yours", font: "serif", allowIndexing: false },
        checkoutPage: { ...DEFAULT_CHECKOUT_PAGE_CONFIG, layout: "compact", note: "Thanks for shopping small" },
      }),
    );
    expect(carried.productPage).toMatchObject({ ctaLabel: "Get yours", font: "serif", allowIndexing: false });
    expect(carried.checkoutPage).toMatchObject({ layout: "compact", note: "Thanks for shopping small" });
  });

  it("leaves out a page the last storefront never set up", () => {
    const carried = carryOverDesign(config({}));
    expect(carried).not.toHaveProperty("productPage");
    expect(carried).not.toHaveProperty("checkoutPage");
  });
});

describe("embedDomainsElsewhere", () => {
  it("offers the newest other storefront's domains, never the storefront's own", () => {
    const storefronts = [
      { id: "this", name: "This", domains: ["mine.example"] },
      { id: "empty", name: "Empty", domains: [] },
      { id: "shop", name: "Shop", domains: ["shop.example", "www.shop.example"] },
    ];
    expect(embedDomainsElsewhere(storefronts, "this")).toEqual({
      from: "Shop",
      value: ["shop.example", "www.shop.example"],
    });
    expect(embedDomainsElsewhere(storefronts.slice(0, 2), "this")).toBeNull();
  });
});

describe("carrier habits", () => {
  const habits = carrierHabits([
    { carrier: "gls", country: "FR" },
    { carrier: "an-post", country: "IE" },
    { carrier: "dhl", country: "FR" },
    { carrier: "an-post", country: null },
  ]);

  it("starts each parcel on the carrier its country last went with", () => {
    expect(carrierFor(habits, "FR")).toBe("gls");
    expect(carrierFor(habits, "IE")).toBe("an-post");
  });

  it("falls back to the newest carrier for a new country, and to none for a new store", () => {
    expect(carrierFor(habits, "DE")).toBe("gls");
    expect(carrierFor(habits, null)).toBe("gls");
    expect(carrierFor(carrierHabits([]), "FR")).toBeNull();
  });

  it("learns a parcel just shipped", () => {
    const next = withCarrier(habits, "dpd", "IE");
    expect(carrierFor(next, "IE")).toBe("dpd");
    expect(carrierFor(next, "FR")).toBe("gls");
    expect(carrierFor(next, "DE")).toBe("dpd");
  });
});

describe("predictShippingDefaults", () => {
  it("offers the business country and the catalogue's currency", () => {
    expect(predictShippingDefaults(["USD", "USD"], "PT")).toEqual({ shipsFrom: "PT", ratesCurrency: "USD" });
  });

  it("stays quiet without either", () => {
    expect(predictShippingDefaults([], undefined)).toEqual({});
  });
});

describe("add-on habits", () => {
  const purchases = [
    { buyer: "ana@example.com", productIds: ["mug", "coasters"] },
    { buyer: "Ana@Example.com ", productIds: ["mug"] },
    { buyer: "ben@example.com", productIds: ["mug"] },
    { buyer: "ben@example.com", productIds: ["coasters", "towel"] },
    { buyer: "cat@example.com", productIds: ["mug", "towel"] },
    { buyer: "dan@example.com", productIds: ["bowl", "coasters"] },
    { buyer: "", productIds: ["mug", "bowl"] },
  ];
  const offers = [
    { id: "mug", addOnIds: ["wrap"] },
    { id: "bowl", addOnIds: ["wrap", "coasters"] },
    { id: "vase", addOnIds: ["wrap", "wrap"] },
    { id: "towel", addOnIds: ["mug"] },
  ];

  it("counts each buyer once across their orders, main products and add-ons alike", () => {
    const habits = addOnHabits("mug", purchases, offers);
    // Ana bought coasters with a mug, Ben a week later: two buyers, not three.
    expect(habits.boughtWith).toEqual({ coasters: 2, towel: 2 });
  });

  it("counts what the seller's OTHER products offer, each product once", () => {
    expect(addOnHabits("mug", purchases, offers).offeredWith).toEqual({ wrap: 2, coasters: 1 });
  });

  it("knows no buyers for a product not saved yet", () => {
    const habits = addOnHabits(null, purchases, offers);
    expect(habits.boughtWith).toEqual({});
    expect(habits.offeredWith).toEqual({ wrap: 3, coasters: 1, mug: 1 });
  });

  it("suggests what buyers bought together first, most buyers first, catalogue order among equals", () => {
    const habits = { boughtWith: { towel: 3, coasters: 2, bowl: 1 }, offeredWith: { wrap: 5 } };
    expect(suggestAddOns(habits, ["coasters", "towel", "bowl", "wrap"], [])).toEqual({
      reason: "boughtWith",
      ids: ["towel", "coasters"],
    });
    expect(
      suggestAddOns({ boughtWith: { towel: 2, coasters: 2 }, offeredWith: {} }, ["coasters", "towel"], []),
    ).toEqual({ reason: "boughtWith", ids: ["coasters", "towel"] });
  });

  it("falls back to the seller's usual add-ons once those are chosen", () => {
    const habits = { boughtWith: { towel: 3 }, offeredWith: { wrap: 2, card: 1 } };
    expect(suggestAddOns(habits, ["towel", "wrap", "card"], ["towel"])).toEqual({
      reason: "offeredWith",
      ids: ["wrap"],
    });
  });

  it("offers only what buyers would be shown, and never more than the list has room for", () => {
    const habits = { boughtWith: { a: 2, b: 2, c: 2, hidden: 9 }, offeredWith: {} };
    expect(suggestAddOns(habits, ["a", "b", "c"], ["x", "y"])).toEqual({ reason: "boughtWith", ids: ["a", "b"] });
    expect(suggestAddOns(habits, ["a", "b", "c"], ["w", "x", "y", "z"])).toBeNull();
  });

  it("stays quiet on one buyer or one product: that is a coincidence, not a habit", () => {
    expect(suggestAddOns({ boughtWith: { a: 1 }, offeredWith: { b: 1 } }, ["a", "b"], [])).toBeNull();
    expect(suggestAddOns(NO_ADD_ON_HABITS, ["a"], [])).toBeNull();
  });
});
