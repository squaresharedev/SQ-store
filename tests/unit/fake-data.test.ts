// The seed generator's job is not "produce rows" but "produce rows that make
// the dashboard look like a real store". Those are statistical properties, so
// these tests assert on distributions rather than on individual values. The RNG
// is seeded, so every assertion here is deterministic despite being statistical.
//
// Each property below corresponds to a way the OLD generator produced data that
// rendered as visibly fake, and each is mirrored by the pg_cron sales simulator
// in supabase/migrations/20260801_demo_sales_sim.sql.

import { describe, expect, it } from "vitest";
import {
  BUYER_POOL_SIZE,
  CATALOG_PRODUCTS,
  PRODUCT_THEMES,
  RETURNING_VISITOR_RATE,
  STORE_CURRENCY,
  VISITOR_POOL_SIZE,
  buyerEmailForIndex,
  createRng,
  documentAssets,
  findCatalogProduct,
  generateOrders,
  generateProducts,
  generateSignals,
  pickBuyerEmail,
  pickSecondOfDay,
  pickVisitorHash,
  popularityWeights,
  storeFactsFor,
  THEME_KEYS,
  themeByKey,
  weightedIndex,
  type SeededProduct,
  type SignalInsert,
} from "../../scripts/lib/fake-data.ts";

const SELLER = "11111111-1111-4111-8111-111111111111";
const STOREFRONT = "22222222-2222-4222-8222-222222222222";

function productsFixture(count: number): SeededProduct[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `product-${i}`,
    title: `Product ${i}`,
    price_cents: 1000 + i * 100,
    currency: STORE_CURRENCY,
    status: "active",
  }));
}

describe("buyer identities", () => {
  it("maps an index to a stable, undeliverable address", () => {
    expect(buyerEmailForIndex(0)).toBe(buyerEmailForIndex(0));
    expect(buyerEmailForIndex(0)).not.toBe(buyerEmailForIndex(1));
    // A reserved TLD: RFC 2606 guarantees .test never resolves, so a stray
    // send from a seeded row can never reach a real person.
    expect(buyerEmailForIndex(7)).toMatch(/@example\.test$/);
  });

  it("never collides a first-timer with a member of the regulars pool", () => {
    // Distinct indices must give distinct addresses across the whole range the
    // generator draws from; a collision would silently promote a first-timer to
    // a repeat buyer and inflate the retention figure.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(buyerEmailForIndex(i));
    expect(seen.size).toBe(5000);
  });

  it("produces both first-time and repeat buyers", () => {
    const rng = createRng(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      const email = pickBuyerEmail(rng);
      counts.set(email, (counts.get(email) ?? 0) + 1);
    }
    const repeat = [...counts.values()].filter((n) => n >= 2).length;

    // The two failure modes this replaced. Fresh-random-per-order gave
    // repeat === 0; a pool-only draw would make unique <= BUYER_POOL_SIZE.
    expect(repeat).toBeGreaterThan(0);
    expect(counts.size).toBeGreaterThan(BUYER_POOL_SIZE);

    // And no single address may dominate the store. An earlier skew
    // (exponent 2.2) handed 15% of all orders to one buyer.
    const topShare = Math.max(...counts.values()) / 4000;
    expect(topShare).toBeLessThan(0.05);
  });
});

describe("time-of-day shape", () => {
  it("sells more in the evening than in the small hours", () => {
    const rng = createRng(7);
    const byHour = new Array<number>(24).fill(0);
    for (let i = 0; i < 20_000; i += 1) {
      byHour[Math.floor(pickSecondOfDay(rng) / 3600)]! += 1;
    }
    const night = byHour[2]! + byHour[3]! + byHour[4]!;
    const evening = byHour[18]! + byHour[19]! + byHour[20]!;
    expect(evening).toBeGreaterThan(night * 5);
    // Still a real distribution: no hour is empty, so the data never looks
    // like a store that is closed.
    expect(Math.min(...byHour)).toBeGreaterThan(0);
  });

  it("stays inside the day it was asked for", () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i += 1) {
      const second = pickSecondOfDay(rng);
      expect(second).toBeGreaterThanOrEqual(0);
      expect(second).toBeLessThan(86_400);
    }
  });
});

describe("product popularity", () => {
  it("weights a head above a long tail", () => {
    const weights = popularityWeights(10);
    expect(weights[0]).toBeGreaterThan(weights[9]!);
    // Decreasing everywhere, so "rank" means something.
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThan(weights[i - 1]!);
    }
  });

  it("still sells the tail rather than only the bestseller", () => {
    const rng = createRng(11);
    const weights = popularityWeights(12);
    const hits = new Array<number>(12).fill(0);
    for (let i = 0; i < 6000; i += 1) hits[weightedIndex(rng, weights)]! += 1;

    expect(hits[0]).toBeGreaterThan(hits[11]!);
    // Every product gets sales: a catalogue where most items never sell makes
    // the products page look broken rather than realistic.
    expect(Math.min(...hits)).toBeGreaterThan(0);
    // ...but the top item must not swallow the store.
    expect(hits[0]! / 6000).toBeLessThan(0.35);
  });
});

describe("seeded product pages", () => {
  // The point of seeding page facts is that a demo page looks like one a real
  // seller filled in. An empty section is the thing nobody reviews, so these
  // assert that none of them CAN be empty.

  it("gives every product its documents, options and compliance block", () => {
    const products = generateProducts(createRng(3), SELLER, 30, undefined, "https://demo.test");
    for (const product of products) {
      expect(product.documents.length, product.title).toBeGreaterThan(0);
      expect(product.option_groups.length, product.title).toBeGreaterThan(0);
      expect(product.details).toHaveProperty("safety");
      expect(product.details).toHaveProperty("specs");
      // The document key is a full URL because only a service_role seed can
      // write one; the app's own writes are gated to R2 object keys.
      for (const document of product.documents) {
        expect(document.key.startsWith("https://demo.test/"), document.key).toBe(true);
        expect(document.key.endsWith(".pdf"), document.key).toBe(true);
        expect(document.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("shows every availability state somewhere in the catalogue", () => {
    // Rolling each product independently missed a state about one run in six,
    // which left the low-stock and sold-out treatments invisible on the demo
    // store. The scarce states are dealt, not rolled — so this holds for every
    // seed and every theme rather than usually.
    for (const theme of PRODUCT_THEMES) {
      for (let seed = 0; seed < 40; seed += 1) {
        const products = generateProducts(createRng(seed), SELLER, 30, theme);
        if (products.length < 4) continue;
        const states = new Set(
          products.map((product) =>
            !product.track_stock
              ? "untracked"
              : product.stock_quantity === 0
                ? "out"
                : product.stock_quantity! <= product.low_stock_threshold
                  ? "low"
                  : "healthy",
          ),
        );
        expect(states, `${theme.key} @ seed ${seed}`).toEqual(
          new Set(["untracked", "out", "low", "healthy"]),
        );
      }
    }
  });

  it("never counts stock it is not tracking", () => {
    // The DB constraint mirrors this: tracking without a quantity is invalid,
    // and a quantity without tracking is a number nothing reads.
    const products = generateProducts(createRng(11), SELLER, 30);
    for (const product of products) {
      if (product.track_stock) expect(typeof product.stock_quantity).toBe("number");
      else expect(product.stock_quantity).toBeNull();
    }
  });

  it("writes store-level policies and an EU trader identity", () => {
    // These live on the storefront, not the product, and were the reason a
    // seeded page still said "the seller has not added shipping details yet".
    for (const theme of PRODUCT_THEMES) {
      const facts = storeFactsFor(theme.key);
      expect(facts.policies.shipping.length).toBeGreaterThan(80);
      expect(facts.policies.returns.length).toBeGreaterThan(80);
      expect(facts.seller.businessName.length).toBeGreaterThan(0);
      // An EU country on purpose: the statutory withdrawal and guarantee lines
      // render only for one, and they are a real part of the page.
      expect(facts.seller.country).toBe("IE");
    }
  });

  it("names one asset per document, with no two sharing a path", () => {
    const assets = documentAssets();
    expect(assets.length).toBeGreaterThan(0);
    expect(new Set(assets.map((asset) => asset.path)).size).toBe(assets.length);
    for (const asset of assets) expect(asset.path.endsWith(".pdf")).toBe(true);
  });
});

describe("generateProducts", () => {
  it("prices the whole catalogue in one currency", () => {
    const rng = createRng(99);
    const products = generateProducts(rng, SELLER, 30);
    // getAnalytics() filters USD out at the database, so a mixed catalogue
    // silently hides part of the store from every chart.
    expect(new Set(products.map((p) => p.currency))).toEqual(new Set([STORE_CURRENCY]));
  });

  it("never emits two products with the same title", () => {
    const rng = createRng(5);
    const products = generateProducts(rng, SELLER, 40);
    // Titles are snapshotted onto orders and the top-products table groups on
    // that snapshot, so duplicates would merge into one overstated row.
    expect(new Set(products.map((p) => p.title)).size).toBe(products.length);
  });

  it("keeps money in integer cents", () => {
    const rng = createRng(5);
    for (const product of generateProducts(rng, SELLER, 40)) {
      expect(Number.isInteger(product.price_cents)).toBe(true);
      expect(product.price_cents).toBeGreaterThan(0);
    }
  });

  it("draws the whole catalogue from a single theme, never mixing categories", () => {
    // The bug this replaced: picking a product independently per slot could
    // land a store selling drum kits next to Lightroom presets, which reads as
    // obviously fake on any real storefront.
    for (const theme of PRODUCT_THEMES) {
      const titles = new Set(theme.products.map((p) => p.title));
      for (const product of generateProducts(createRng(21), SELLER, 40, theme)) {
        expect(titles.has(product.title)).toBe(true);
      }
    }
  });

  it("gives every product its own real photo", () => {
    // The generator used to fetch a photo by keyword, which returned whatever
    // loosely matched the tag: a "lamp" was paper sculpture, a "lounge chair"
    // was a family portrait, and every "drone" was a landscape shot FROM a
    // drone. Each product now carries the photograph of that exact product.
    for (const theme of PRODUCT_THEMES) {
      for (const product of generateProducts(createRng(8), SELLER, 40, theme)) {
        const entry = findCatalogProduct(product.title)!;
        expect(entry).toBeDefined();
        expect(product.image_key).toBe(entry.imageUrl);
        expect(product.image_key).toMatch(/^https:\/\//);
      }
    }
  });

  it("serves every catalogue photo from our own storage", () => {
    // Hotlinked third-party hosts are outside the app's CSP img-src allowlist
    // (next.config.ts) and Wikimedia rate-limits bursts with 429. The Supabase
    // origin is allowlisted and ours, so mirrored copies survive the CSP being
    // switched from Report-Only to enforcing. See pnpm mirror-catalog-images.
    for (const product of CATALOG_PRODUCTS) {
      expect(product.imageUrl).toContain("/seed-assets/");
      expect(product.imageUrl).not.toContain("dummyjson.com");
      expect(product.imageUrl).not.toContain("wikimedia.org");
    }
  });

  it("never lists the same product twice, even when asked for more than it has", () => {
    for (const theme of PRODUCT_THEMES) {
      // Deliberately over-ask: sampling is without replacement, so the result
      // is capped at the theme size rather than padded with duplicates.
      const products = generateProducts(createRng(4), SELLER, theme.products.length + 25, theme);
      expect(products.length).toBe(theme.products.length);
      expect(new Set(products.map((p) => p.title)).size).toBe(products.length);
    }
  });

  it("describes each product as the physical good it is", () => {
    for (const theme of PRODUCT_THEMES) {
      for (const product of generateProducts(createRng(77), SELLER, 40, theme)) {
        // These themes ship boxes, so the old digital-goods copy would be a lie.
        expect(product.description).not.toMatch(/download|instant delivery/i);
        expect(product.description.length).toBeGreaterThan(20);
      }
    }
  });

  it("prices each theme in a band that suits what it sells", () => {
    // A camera drone and a t-shirt must not share a price range, or the
    // revenue tiles read as one undifferentiated blob.
    const drones = themeByKey("drones")!;
    const fashion = themeByKey("fashion")!;
    const medianOf = (theme: typeof drones): number => {
      const sorted = theme.products.map((p) => p.priceCents).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };
    expect(medianOf(drones)).toBeGreaterThan(medianOf(fashion) * 5);
  });

  it("gives every collection its own design language", () => {
    const aesthetics = new Set<string>();
    for (const theme of PRODUCT_THEMES) {
      const { name, aesthetic, prompt } = theme.photoStyle;
      expect(name.length).toBeGreaterThan(0);
      expect(aesthetic.length).toBeGreaterThan(0);
      // The prompt is what keeps a later addition matching the existing set;
      // without it the collection drifts the moment someone extends it.
      expect(prompt.length).toBeGreaterThan(40);
      aesthetics.add(aesthetic);
    }
    // Material palettes must be distinct — that is what makes a store read as
    // one shop. Backdrops deliberately are NOT required to be unique: the
    // brutalist and cozy furniture collections are both shot on white, and
    // that is the point, since they differ in what they sell rather than in
    // how it is lit.
    expect(aesthetics.size).toBe(PRODUCT_THEMES.length);
  });

  it("renders every catalogue photo at the current style version", () => {
    // A stale version segment means a product still points at an image shot in
    // the previous look, which is exactly the inconsistency styles exist to
    // prevent. Bumping STYLE_VERSION also busts Supabase's CDN cache.
    for (const product of CATALOG_PRODUCTS) {
      expect(product.imageUrl).toMatch(/\/seed-assets\/[a-z]\d+\//);
    }
    const versions = new Set(
      CATALOG_PRODUCTS.map((p) => p.imageUrl.match(/\/seed-assets\/([a-z]\d+)\//)?.[1]),
    );
    expect(versions.size).toBe(1);
  });

  it("carries a usable number of real products in every category", () => {
    // The seed asks for 8-15 products; a theme thinner than that would ship a
    // near-empty store.
    for (const theme of PRODUCT_THEMES) {
      expect(theme.products.length).toBeGreaterThanOrEqual(8);
      for (const product of theme.products) {
        expect(product.title.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(product.priceCents)).toBe(true);
        expect(product.priceCents).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every catalogue title unique across the whole catalogue", () => {
    // findCatalogProduct() resolves by exact title, so a duplicate would make
    // update-product-images.ts restore the wrong photo.
    const titles = CATALOG_PRODUCTS.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("exposes exactly the expected collections", () => {
    expect([...THEME_KEYS].sort()).toEqual(
      ["drones", "fashion", "furniture-brutalist", "furniture-cozy", "tech"].sort(),
    );
    for (const key of THEME_KEYS) expect(themeByKey(key)?.key).toBe(key);
    expect(themeByKey("nope")).toBeUndefined();
  });
});

describe("generateOrders", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  function generate(seed: number, targetTotal = 900) {
    return generateOrders(createRng(seed), {
      sellerId: SELLER,
      storefrontId: STOREFRONT,
      products: productsFixture(12),
      now,
      days: 90,
      targetTotal,
    });
  }

  it("lands near the requested volume", () => {
    const orders = generate(1);
    expect(orders.length).toBeGreaterThan(700);
    expect(orders.length).toBeLessThan(1100);
  });

  it("never dates an order in the future", () => {
    for (const order of generate(2)) {
      expect(Date.parse(order.created_at)).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("carries repeat buyers through to the rows the dashboard reads", () => {
    const counts = new Map<string, number>();
    for (const order of generate(3)) {
      counts.set(order.buyer_email, (counts.get(order.buyer_email) ?? 0) + 1);
    }
    // The analytics page reports uniqueBuyers and repeatBuyers side by side.
    // Before this model, repeatBuyers was structurally always zero.
    expect([...counts.values()].filter((n) => n >= 2).length).toBeGreaterThan(0);
  });

  it("attributes embed sales to the storefront and marketplace sales to none", () => {
    for (const order of generate(4)) {
      if (order.channel === "embed") expect(order.storefront_id).toBe(STOREFRONT);
      else expect(order.storefront_id).toBeNull();
    }
  });

  it("takes an integer platform fee from every order", () => {
    for (const order of generate(5)) {
      expect(Number.isInteger(order.platform_fee_cents)).toBe(true);
      expect(order.platform_fee_cents).toBeLessThan(order.amount_cents);
    }
  });

  it("sells less at the weekend", () => {
    const byDow = new Array<number>(7).fill(0);
    for (const order of generate(6, 3000)) {
      byDow[new Date(order.created_at).getUTCDay()]! += 1;
    }
    const weekend = byDow[0]! + byDow[6]!;
    const weekdays = byDow[1]! + byDow[2]! + byDow[3]! + byDow[4]! + byDow[5]!;
    expect(weekend / 2).toBeLessThan(weekdays / 5);
  });

  it("only ever sells active products", () => {
    const products: SeededProduct[] = [
      ...productsFixture(3),
      { id: "draft-1", title: "Draft", price_cents: 500, currency: STORE_CURRENCY, status: "draft" },
    ];
    const orders = generateOrders(createRng(8), {
      sellerId: SELLER,
      storefrontId: STOREFRONT,
      products,
      now,
      days: 30,
      targetTotal: 400,
    });
    expect(orders.some((o) => o.product_id === "draft-1")).toBe(false);
  });

  it("is reproducible for a given seed", () => {
    expect(generate(1234)).toEqual(generate(1234));
  });
});

describe("visitor identities", () => {
  it("produces a stable-shaped 64-hex digest", () => {
    const rng = createRng(1);
    expect(pickVisitorHash(rng)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces both first-time and repeat visitors", () => {
    const rng = createRng(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      const hash = pickVisitorHash(rng);
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    }
    const repeat = [...counts.values()].filter((n) => n >= 2).length;

    // Same two failure modes RETURNING_BUYER_RATE exists to avoid: fresh-hash-
    // per-view gives repeat === 0 (uniqueVisitors === count forever); a
    // pool-only draw makes unique <= VISITOR_POOL_SIZE (every visitor a repeat).
    expect(repeat).toBeGreaterThan(0);
    expect(counts.size).toBeGreaterThan(VISITOR_POOL_SIZE);

    // And no single visitor dominates the traffic.
    const topShare = Math.max(...counts.values()) / 4000;
    expect(topShare).toBeLessThan(0.05);
  });

  it("keeps the returning-visitor rate inside a sane, non-degenerate band", () => {
    // Not 0 (every visitor would be a first-timer, repeatBuyers-style figure
    // pinned to 0) and not 1 (no first-timers, store never appears to acquire
    // anyone) — the same two degenerate ends RETURNING_BUYER_RATE avoids.
    expect(RETURNING_VISITOR_RATE).toBeGreaterThan(0.1);
    expect(RETURNING_VISITOR_RATE).toBeLessThan(0.6);
  });
});

describe("generateSignals", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const products = Array.from({ length: 10 }, (_, i) => ({
    id: `product-${i}`,
    title: `Product ${i}`,
    price_cents: 1000 + i * 100,
    currency: STORE_CURRENCY,
    status: "active",
  })) satisfies SeededProduct[];
  const STOREFRONT = "22222222-2222-4222-8222-222222222222";
  const ACCOUNT = "11111111-1111-4111-8111-111111111111";

  function generate(seed: number, embedOrderCount = 60) {
    return generateSignals(createRng(seed), {
      accountId: ACCOUNT,
      storefrontId: STOREFRONT,
      products,
      now,
      days: 90,
      embedOrderCount,
    });
  }

  it("seeds nothing without a storefront", () => {
    const signals = generateSignals(createRng(1), {
      accountId: ACCOUNT,
      storefrontId: null,
      products,
      now,
      days: 90,
      embedOrderCount: 100,
    });
    expect(signals).toEqual([]);
  });

  it("builds a real funnel: more views than clicks, more clicks than embed orders", () => {
    const embedOrderCount = 60;
    const signals = generate(3, embedOrderCount);
    const views = signals.filter((s) => s.kind === "storefront_view").length;
    const clicks = signals.filter((s) => s.kind === "product_click").length;

    expect(views).toBeGreaterThan(clicks);
    expect(clicks).toBeGreaterThanOrEqual(embedOrderCount);
  });

  it("still seeds some traffic for a store with zero embed orders", () => {
    const signals = generate(4, 0);
    const views = signals.filter((s) => s.kind === "storefront_view").length;
    const clicks = signals.filter((s) => s.kind === "product_click").length;
    // People look at a storefront before it has sold anything too.
    expect(views).toBeGreaterThan(0);
    expect(clicks).toBeGreaterThan(0);
  });

  it("never dates a signal in the future", () => {
    for (const signal of generate(5)) {
      expect(Date.parse(signal.occurred_at)).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("attributes every signal to the given storefront and account, on the embed channel", () => {
    for (const signal of generate(6)) {
      expect(signal.account_id).toBe(ACCOUNT);
      expect(signal.storefront_id).toBe(STOREFRONT);
      expect(signal.channel).toBe("embed");
      expect(signal.block_id).toBeNull();
    }
  });

  it("carries a 64-hex-char visitor_hash on every row", () => {
    for (const signal of generate(7)) {
      expect(signal.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("attaches a real product id to at least some clicks, and never to views", () => {
    const signals = generate(8, 200);
    const clicks = signals.filter(
      (s): s is SignalInsert & { metadata: { product_id: string } } =>
        s.kind === "product_click" && "product_id" in s.metadata,
    );
    expect(clicks.length).toBeGreaterThan(0);
    const productIds = new Set(products.map((p) => p.id));
    for (const click of clicks) {
      expect(productIds.has(click.metadata.product_id)).toBe(true);
    }
    // metadata is ALWAYS present (never a missing key — see SignalInsert),
    // but a view never carries a product.
    for (const signal of signals) {
      if (signal.kind === "storefront_view") {
        expect(signal.metadata).toEqual({});
      }
    }
  });

  it("produces repeat visitors, not a fresh one per row", () => {
    const signals = generate(9, 400);
    const counts = new Map<string, number>();
    for (const signal of signals) {
      counts.set(signal.visitor_hash, (counts.get(signal.visitor_hash) ?? 0) + 1);
    }
    expect([...counts.values()].filter((n) => n >= 2).length).toBeGreaterThan(0);
  });

  it("sells less traffic at the weekend, like orders do", () => {
    const byDow = new Array<number>(7).fill(0);
    for (const signal of generate(10, 900)) {
      byDow[new Date(signal.occurred_at).getUTCDay()]! += 1;
    }
    const weekend = byDow[0]! + byDow[6]!;
    const weekdays = byDow[1]! + byDow[2]! + byDow[3]! + byDow[4]! + byDow[5]!;
    expect(weekend / 2).toBeLessThan(weekdays / 5);
  });

  it("is reproducible for a given seed", () => {
    expect(generate(1234)).toEqual(generate(1234));
  });
});

describe("seeded orders record which version was bought", () => {
  const VERSIONED: SeededProduct[] = [
    {
      id: "product-versioned",
      title: "Oak dining table",
      price_cents: 89900,
      currency: STORE_CURRENCY,
      status: "active",
      option_groups: [
        {
          id: "group-size",
          name: "Size",
          display: "chip",
          options: [
            { id: "opt-small", name: "Four seater", available: true },
            { id: "opt-large", name: "Six seater", available: true },
          ],
        },
        {
          id: "group-finish",
          name: "Finish",
          display: "swatch",
          options: [{ id: "opt-oak", name: "Oak", swatch: "#c8a878", available: true }],
        },
      ],
    },
  ];

  it("picks exactly one option per group, by name", () => {
    const orders = generateOrders(createRng(7), {
      sellerId: SELLER,
      storefrontId: STOREFRONT,
      products: VERSIONED,
      now: new Date("2026-09-01T12:00:00.000Z"),
      days: 30,
      targetTotal: 40,
    });
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(order.selected_options.map((entry) => entry.label)).toEqual(["Size", "Finish"]);
      // The NAMES are stored, never the ids: an order says what was sold, and
      // the product's options are free to change after it.
      expect(["Four seater", "Six seater"]).toContain(order.selected_options[0]!.value);
      expect(order.selected_options[1]!.value).toBe("Oak");
    }
    // Both sizes actually occur, so the seeded store shows the column working
    // rather than one value repeated.
    const sizes = new Set(orders.map((order) => order.selected_options[0]!.value));
    expect(sizes.size).toBe(2);
  });

  it("records nothing for a product sold in one version", () => {
    const orders = generateOrders(createRng(3), {
      sellerId: SELLER,
      storefrontId: STOREFRONT,
      products: productsFixture(2),
      now: new Date("2026-09-01T12:00:00.000Z"),
      days: 30,
      targetTotal: 20,
    });
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) expect(order.selected_options).toEqual([]);
  });
});
