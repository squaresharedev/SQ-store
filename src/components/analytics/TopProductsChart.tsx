"use client";

import { HBarChart } from "@/components/charts";
import type { TopProduct } from "@/lib/analytics/types";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { TONE } from "@/components/analytics/palette";

// Top products by paid revenue, horizontal bars from the shared chart kit
// (/dev/charts). Horizontal because the category is a product TITLE: titles
// are long, and a vertical bar chart would either rotate them 45 degrees or
// truncate them to three characters.
//
// No fixed height: HBarChart derives one from the row count, so a store with
// two products does not get a card padded with four rows of nothing.
//
// Presentational only: the parent guarantees a non-empty, revenue-descending
// list. Titles are the order's product_title snapshot, so a renamed or deleted
// product still reports the revenue it actually earned.

/** Titles are user content and can be long; the axis column is finite. */
const MAX_LABEL = 22;

export function TopProductsChart({
  products,
  currency,
}: {
  products: TopProduct[];
  currency: string;
}) {
  return (
    <HBarChart
      data={products}
      xKey="title"
      series={[{ key: "revenueCents", label: "Revenue", colorIndex: TONE.money }]}
      categoryWidth={116}
      categoryFormatter={(title) =>
        title.length > MAX_LABEL ? `${title.slice(0, MAX_LABEL - 1)}…` : title
      }
      valueFormatter={moneyExact(currency)}
      axisValueFormatter={moneyCompact(currency)}
      ariaLabel="Top products by paid revenue"
    />
  );
}
