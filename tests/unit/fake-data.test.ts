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
  STORE_CURRENCY,
  buyerEmailForIndex,
  createRng,
  generateOrders,
  generateProducts,
  pickBuyerEmail,
  pickSecondOfDay,
  popularityWeights,
  weightedIndex,
  type SeededProduct,
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
