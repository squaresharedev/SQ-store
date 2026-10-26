// The review seed exists so every review surface can be opened and judged.
// These tests pin the two halves of that: the rows obey the rules the reviews
// table enforces (so a seed run never dies on a CHECK), and the batch covers
// every state a seller or buyer can meet.

import { describe, expect, it } from "vitest";
import { createRng } from "../../scripts/lib/fake-data.ts";
import { generateReviews, type ReviewableOrder } from "../../scripts/lib/fake-reviews.ts";

const SELLER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-26T12:00:00Z");

const products = Array.from({ length: 10 }, (_, i) => ({ id: `product-${i}`, title: `Lamp ${i}` }));
const orders: ReviewableOrder[] = Array.from({ length: 120 }, (_, i) => ({
  id: `order-${i}`,
  product_id: `product-${i % 10}`,
  buyer_email: `alex.wong${100 + i}@example.test`,
  created_at: new Date(NOW.getTime() - (i + 5) * 86_400_000).toISOString(),
}));

const batch = generateReviews(createRng(7), { sellerId: SELLER, products, orders, now: NOW });

describe("generateReviews", () => {
  it("writes only rows the reviews table accepts", () => {
    for (const review of batch.reviews) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(review.author_name.length).toBeGreaterThan(0);
      expect(review.title === null || review.title.length > 0).toBe(true);
      // reviews_origin and reviews_imported_not_verified
      if (review.source === "native") {
        expect(review.order_id).not.toBeNull();
        expect(review.import_id).toBeNull();
        expect(review.external_id).toBeNull();
      } else {
        expect(review.order_id).toBeNull();
        expect(review.import_id).not.toBeNull();
        expect(review.external_id).not.toBeNull();
        expect(review.is_verified_buyer).toBe(false);
      }
      // reviews_hidden_has_reason
      expect(review.is_approved).toBe(review.hidden_reason === null);
      expect(Date.parse(review.reviewed_at)).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("uses each order for one review at most, and only for its own product", () => {
    const native = batch.reviews.filter((review) => review.order_id);
    expect(new Set(native.map((review) => review.order_id)).size).toBe(native.length);
    for (const review of native) {
      expect(orders.find((order) => order.id === review.order_id)?.product_id).toBe(review.product_id);
      expect(review.is_verified_buyer).toBe(true);
    }
  });

  it("covers every state: verified, imported, held, blocked, hidden, pending", () => {
    const has = (test: (review: (typeof batch.reviews)[number]) => boolean) => batch.reviews.some(test);
    expect(has((review) => review.source === "native")).toBe(true);
    expect(has((review) => review.source !== "native")).toBe(true);
    expect(has((review) => review.moderation_status === "held")).toBe(true);
    expect(has((review) => review.moderation_status === "blocked")).toBe(true);
    expect(has((review) => review.moderation_status === "pending")).toBe(true);
    expect(has((review) => !review.is_approved)).toBe(true);
  });

  it("gives one product more than a page of reviews, so the feed paginates", () => {
    const perProduct = new Map<string, number>();
    for (const review of batch.reviews) perProduct.set(review.product_id, (perProduct.get(review.product_id) ?? 0) + 1);
    expect(Math.max(...perProduct.values())).toBeGreaterThan(10);
  });

  it("counts each import run's reviews on the run", () => {
    for (const run of batch.imports) {
      const brought = batch.reviews.filter((review) => review.import_id === run.id);
      expect(run.imported_count).toBe(brought.length);
      expect(run.row_count).toBe(run.imported_count + run.skipped_count);
      expect(brought.every((review) => review.source === run.source)).toBe(true);
    }
  });

  it("skews positive, like a real shop", () => {
    const fives = batch.reviews.filter((review) => review.rating === 5).length;
    const ones = batch.reviews.filter((review) => review.rating === 1).length;
    expect(fives).toBeGreaterThan(ones);
  });

  it("writes nothing for a store with no products", () => {
    expect(generateReviews(createRng(1), { sellerId: SELLER, products: [], orders, now: NOW })).toEqual({
      imports: [],
      reviews: [],
    });
  });
});
