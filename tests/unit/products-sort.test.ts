import { describe, expect, it } from "vitest";
import {
  METRIC_SORTS,
  PRODUCT_SORTS,
  isMetricSort,
  metricValue,
  type ProductSort,
} from "@/lib/products/sort";
import type { ProductSales } from "@/types/product";

function sales(unitsSold: number, revenueCents: number): ProductSales {
  return { unitsSold, revenueCents, currency: "EUR" };
}

// Ordering itself is applied server-side (lib/products/queries.ts). What lives
// here is the sort vocabulary and the metric semantics the query layer ranks
// by, so these cover the contract between the two.

describe("sort vocabulary", () => {
  it("every metric sort is a member of the offered sorts", () => {
    for (const sort of METRIC_SORTS) {
      expect(PRODUCT_SORTS).toContain(sort);
    }
  });

  it("classifies exactly the rollup-backed sorts as metric sorts", () => {
    const metric = PRODUCT_SORTS.filter((sort) => isMetricSort(sort));
    expect(metric).toEqual(["unitsSold", "revenue"]);
  });

  it("treats every column-backed sort as non-metric", () => {
    for (const sort of ["default", "priceHigh", "priceLow", "title"] as ProductSort[]) {
      expect(isMetricSort(sort)).toBe(false);
    }
  });
});

describe("metricValue", () => {
  it("reads units for unitsSold and cents for revenue", () => {
    const record = sales(3, 9_900);
    expect(metricValue(record, "unitsSold")).toBe(3);
    expect(metricValue(record, "revenue")).toBe(9_900);
  });

  it("scores a product with no sales at zero, so it ranks below any seller", () => {
    expect(metricValue(undefined, "unitsSold")).toBe(0);
    expect(metricValue(undefined, "revenue")).toBe(0);
    expect(metricValue(undefined, "revenue")).toBeLessThan(
      metricValue(sales(1, 1), "revenue"),
    );
  });

  it("ranks by revenue independently of unit count", () => {
    // One expensive sale outranks several cheap ones by revenue and loses on
    // units, so the two sorts must not collapse into each other.
    const fewExpensive = sales(1, 50_000);
    const manyCheap = sales(10, 1_000);
    expect(metricValue(fewExpensive, "revenue")).toBeGreaterThan(
      metricValue(manyCheap, "revenue"),
    );
    expect(metricValue(fewExpensive, "unitsSold")).toBeLessThan(
      metricValue(manyCheap, "unitsSold"),
    );
  });
});
