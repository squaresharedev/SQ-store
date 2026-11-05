import type { Product } from "@/types/product";

/**
 * DEV HARNESSES ONLY (/dev/embed-frame, /dev/sample-storefront with
 * `?extras=1`): the sample's products with the facts the card extras draw
 * from, so a second photo, stars and both stock states can be judged without
 * a database. The real sample storefront never carries these: its photos are
 * one per product, nobody has reviewed it, and it tracks no stock.
 *
 * Between them the five cover every case: a second photo and none, ratings
 * from one review to many and none at all, stock running low, gone, plenty,
 * and not tracked.
 */
const EXTRAS: Record<string, Partial<Product>> = {
  // camera
  "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a01": {
    hoverImageUrl: "/sample-storefront/speaker.webp",
    rating: { average: 4.8, count: 24 },
  },
  // headphones
  "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a02": {
    hoverImageUrl: "/sample-storefront/mouse.webp",
    rating: { average: 4.25, count: 7 },
    trackStock: true,
    stockQuantity: 50,
  },
  // watch: running low (2 left, low at 3), no reviews yet
  "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03": {
    hoverImageUrl: "/sample-storefront/succulent.webp",
    trackStock: true,
    stockQuantity: 2,
  },
  // mouse: gone, one review
  "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a04": {
    rating: { average: 5, count: 1 },
    trackStock: true,
    stockQuantity: 0,
  },
  // speaker: no second photo, a middling rating, stock not tracked
  "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a05": {
    rating: { average: 3.6, count: 15 },
  },
};

export function withSampleCardExtras(products: readonly Product[]): Product[] {
  return products.map((product) => ({ ...product, ...EXTRAS[product.id] }));
}
