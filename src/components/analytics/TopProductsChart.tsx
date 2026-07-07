"use client";

import type { TopProduct } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";

// Top products by paid revenue — token-styled proportional bars rather than a
// Recharts BarChart: crisper for a top-5 ranking, and the sharp rectangular
// bars match the brand's square identity. Presentational only: the parent
// fetches via getAnalytics and guarantees a non-empty, revenue-descending list.

export function TopProductsChart({
  products,
  currency,
}: {
  products: TopProduct[];
  currency: string;
}) {
  // Descending input, so the first row is the max the others scale against.
  const maxCents = Math.max(...products.map((product) => product.revenueCents), 1);
  return (
    <ul className="flex flex-col gap-4">
      {products.map((product) => (
        <li key={product.title} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate text-sm font-medium text-foreground">
              {product.title}
            </span>
            <span className="shrink-0 text-sm font-semibold text-foreground">
              {formatCents(product.revenueCents, currency)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Track + fill: widths are data-proportional, colours are tokens. */}
            <div className="h-2 flex-1 bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${(product.revenueCents / maxCents) * 100}%` }}
              />
            </div>
            <span className="font-inter w-16 shrink-0 text-right text-xs text-muted-foreground">
              {product.sales} {product.sales === 1 ? "sale" : "sales"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
