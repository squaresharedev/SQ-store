import { describe, expect, it } from "vitest";
import { sortProducts, type ProductSort } from "@/lib/products/sort";
import type { Product, ProductSales } from "@/types/product";

function product(id: string, title: string, price: number): Product {
  return {
    id,
    title,
    description: "",
    price,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 5,
  };
}

function sales(unitsSold: number, revenueCents: number): ProductSales {
  return { unitsSold, revenueCents, currency: "EUR" };
}

// Incoming order is listProducts' newest-first order.
const PRODUCTS = [
  product("a", "Zebra print", 30),
  product("b", "apple poster", 10),
  product("c", "Mango zine", 20),
];

const SALES = {
  a: sales(2, 6000),
  b: sales(9, 900),
  // "c" has never sold — deliberately absent, like the real lookup.
};

const ids = (list: Product[]) => list.map((p) => p.id);

describe("sortProducts", () => {
  it("returns the input untouched for the default ordering", () => {
    const result = sortProducts(PRODUCTS, "default", SALES);
    expect(result).toBe(PRODUCTS);
  });

  it("never mutates the input array", () => {
    const before = ids(PRODUCTS);
    sortProducts(PRODUCTS, "revenue", SALES);
    expect(ids(PRODUCTS)).toEqual(before);
  });

  it("orders by units sold, descending", () => {
    expect(ids(sortProducts(PRODUCTS, "unitsSold", SALES))).toEqual(["b", "a", "c"]);
  });

  it("orders by total value sold, descending — not by unit count", () => {
    expect(ids(sortProducts(PRODUCTS, "revenue", SALES))).toEqual(["a", "b", "c"]);
  });

  it("treats products with no sales as zero and sinks them to the bottom", () => {
    for (const sort of ["unitsSold", "revenue"] as ProductSort[]) {
      expect(ids(sortProducts(PRODUCTS, sort, SALES)).at(-1)).toBe("c");
    }
  });

  it("orders by price in both directions", () => {
    expect(ids(sortProducts(PRODUCTS, "priceHigh", SALES))).toEqual(["a", "c", "b"]);
    expect(ids(sortProducts(PRODUCTS, "priceLow", SALES))).toEqual(["b", "c", "a"]);
  });

  it("orders by title case-insensitively", () => {
    expect(ids(sortProducts(PRODUCTS, "title", SALES))).toEqual(["b", "c", "a"]);
  });

  it("is stable: ties keep their incoming order", () => {
    const tied = [product("x", "X", 5), product("y", "Y", 5), product("z", "Z", 5)];
    expect(ids(sortProducts(tied, "priceHigh", {}))).toEqual(["x", "y", "z"]);
    // All three have no sales, so every metric sort is one big tie.
    expect(ids(sortProducts(tied, "revenue", {}))).toEqual(["x", "y", "z"]);
  });

  it("handles an empty list", () => {
    expect(sortProducts([], "revenue", {})).toEqual([]);
  });
});
