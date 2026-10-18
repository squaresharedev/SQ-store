import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "@/lib/analytics/buckets";
import type { WeekdaySlice } from "@/lib/analytics/types";
import { withWeekdayProducts } from "@/lib/analytics/weekday-products";

// The weekday card's bars are stacks: each day's sales split by product. The
// split is a separate read from the totals, so the one place that joins them
// has to hold two things: a product keeps its place on every day, and a split
// that does not add up to the bar it replaces is not drawn at all.

function week(sales: number[]): WeekdaySlice[] {
  return WEEKDAYS.map((weekday, index) => ({
    weekday,
    sales: sales[index] ?? 0,
    revenueCents: (sales[index] ?? 0) * 1000,
    products: [],
  }));
}

describe("withWeekdayProducts", () => {
  it("lays each day's products on its bar, named ones in rank order, the rest last", () => {
    const result = withWeekdayProducts(week([3, 0, 0, 0, 0, 4, 0]), {
      products: [
        { title: "Lamp", sales: 4 },
        { title: "Vase", sales: 2 },
      ],
      weekdays: [
        // Out of order on purpose: the SQL's order is not what is relied on.
        { isodow: 1, title: null, sales: 1 },
        { isodow: 1, title: "Vase", sales: 1 },
        { isodow: 1, title: "Lamp", sales: 1 },
        { isodow: 6, title: "Lamp", sales: 3 },
        { isodow: 6, title: "Vase", sales: 1 },
      ],
    });

    expect(result.products).toEqual(["Lamp", "Vase"]);
    expect(result.weekdays[0].products).toEqual([
      { title: "Lamp", sales: 1 },
      { title: "Vase", sales: 1 },
      { title: null, sales: 1 },
    ]);
    expect(result.weekdays[5].products).toEqual([
      { title: "Lamp", sales: 3 },
      { title: "Vase", sales: 1 },
    ]);
    // A day with no sales has no segments, and the totals are untouched.
    expect(result.weekdays[1].products).toEqual([]);
    expect(result.weekdays.map((slice) => slice.sales)).toEqual([3, 0, 0, 0, 0, 4, 0]);
  });

  it("puts ISO Sunday (7) on the last bar", () => {
    const result = withWeekdayProducts(week([0, 0, 0, 0, 0, 0, 2]), {
      products: [{ title: "Lamp", sales: 2 }],
      weekdays: [{ isodow: 7, title: "Lamp", sales: 2 }],
    });
    expect(result.weekdays[6].products).toEqual([{ title: "Lamp", sales: 2 }]);
  });

  it("draws no split when the read failed or found nothing", () => {
    const totals = week([3, 0, 0, 0, 0, 0, 0]);
    for (const payload of [null, { products: [], weekdays: [] }]) {
      const result = withWeekdayProducts(totals, payload);
      expect(result.products).toEqual([]);
      expect(result.weekdays.every((slice) => slice.products.length === 0)).toBe(true);
      expect(result.weekdays[0].sales).toBe(3);
    }
  });

  it("draws no split that does not add up to the bars it would replace", () => {
    // The two reads are separate, and an order can land between them: the
    // split says four on Monday, the totals say three.
    const result = withWeekdayProducts(week([3, 0, 0, 0, 0, 0, 0]), {
      products: [{ title: "Lamp", sales: 4 }],
      weekdays: [{ isodow: 1, title: "Lamp", sales: 4 }],
    });
    expect(result.products).toEqual([]);
    expect(result.weekdays[0].products).toEqual([]);
  });

  it("keeps a product with no title apart from the rest", () => {
    // A named product whose title is null is a product. A null title that is
    // not named is everything else.
    const named = withWeekdayProducts(week([2, 0, 0, 0, 0, 0, 0]), {
      products: [{ title: null, sales: 2 }],
      weekdays: [{ isodow: 1, title: null, sales: 2 }],
    });
    expect(named.products).toEqual([""]);
    expect(named.weekdays[0].products).toEqual([{ title: "", sales: 2 }]);
  });
});
