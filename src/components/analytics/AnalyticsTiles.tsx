import { MetricTile } from "@/components/dashboard/MetricTile";
import type { AnalyticsTotals } from "@/lib/analytics/types";
import { useSalesTiles } from "@/components/analytics/sales-tiles";

/**
 * The sales metrics for the selected range, under the revenue hero.
 *
 * Revenue itself is not here: the revenue lead (RevenueCard or RevenueHero) is
 * that tile and the revenue trend in one piece, and publishes `sales.revenue`
 * the same way a tile would.
 *
 * The figures, their wording and what each publishes come from useSalesTiles,
 * which SalesTrendTiles draws the other way (with a change and a sparkline).
 *
 * The old Views and Clicks tiles are gone from here: they were honest
 * "coming soon" placeholders, and now that the signal pipeline exists they are
 * real figures living in their own sections further down the page, where they
 * come with a trend and a breakdown rather than a bare number.
 */
export function AnalyticsTiles({ totals }: { totals: AnalyticsTotals }) {
  const tiles = useSalesTiles(totals);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <MetricTile
          key={tile.key}
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          zeroText={tile.zeroText}
          datapoint={tile.datapoint}
        />
      ))}
    </div>
  );
}
