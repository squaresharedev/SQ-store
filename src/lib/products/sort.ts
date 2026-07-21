// Client-side ordering for the products grid. The list is already fully loaded
// (listProducts returns the account's products in one read), so sorting is a
// pure array operation — no refetch, no URL state. If the list ever paginates,
// this moves server-side and these keys become query params.

import type { Product, ProductSales } from "@/types/product";

/** Ordering options offered by the products toolbar. */
export const PRODUCT_SORTS = [
  "default",
  "unitsSold",
  "revenue",
  "priceHigh",
  "priceLow",
  "title",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Sales lookup keyed by product id; products with no sales are absent. */
type SalesByProduct = Record<string, ProductSales | undefined>;

const NO_SALES: ProductSales = { unitsSold: 0, revenueCents: 0, currency: "EUR" };

/**
 * Return a NEW array ordered by `sort`. `default` preserves the incoming order
 * (listProducts already returns newest-first), so it is the identity case.
 *
 * Metric sorts are descending — "best first" is the only useful direction for
 * units/revenue — and fall back to the incoming order on ties, which keeps the
 * result stable and makes repeated sorts idempotent.
 */
export function sortProducts(
  products: Product[],
  sort: ProductSort,
  sales: SalesByProduct,
): Product[] {
  if (sort === "default") return products;

  const metrics = (product: Product) => sales[product.id] ?? NO_SALES;
  const sorted = [...products];

  switch (sort) {
    case "unitsSold":
      return sorted.sort((a, b) => metrics(b).unitsSold - metrics(a).unitsSold);
    case "revenue":
      return sorted.sort((a, b) => metrics(b).revenueCents - metrics(a).revenueCents);
    case "priceHigh":
      return sorted.sort((a, b) => b.price - a.price);
    case "priceLow":
      return sorted.sort((a, b) => a.price - b.price);
    case "title":
      // Locale-aware + case-insensitive, so "apple" and "Apple" sort together.
      return sorted.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
    default:
      return sorted;
  }
}
