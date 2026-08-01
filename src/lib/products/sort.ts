// The sort vocabulary for the products grid, and the semantics of the two
// orderings the database cannot express.
//
// Ordering is applied SERVER-side (lib/products/queries.ts) now that the list
// paginates: sorting only the fetched page would rank an arbitrary slice.
// Most sorts map straight to a column; "unitsSold" and "revenue" rank by a
// rollup that lives in the ORDERS table, which this schema cannot join onto
// products, so the query layer ranks those in memory using `metricValue`.

import type { ProductSales } from "@/types/product";

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

/** The sorts that rank by the sales rollup rather than a product column. */
export const METRIC_SORTS = ["unitsSold", "revenue"] as const;

export type MetricSort = (typeof METRIC_SORTS)[number];

export function isMetricSort(sort: ProductSort): sort is MetricSort {
  return (METRIC_SORTS as readonly ProductSort[]).includes(sort);
}

/**
 * The number a metric sort ranks by, descending. A product with no paid sales
 * has no rollup entry and scores 0, which puts it below everything that sold —
 * the only sensible reading of "best selling".
 */
export function metricValue(
  sales: ProductSales | undefined,
  sort: MetricSort,
): number {
  if (!sales) return 0;
  return sort === "revenue" ? sales.revenueCents : sales.unitsSold;
}
