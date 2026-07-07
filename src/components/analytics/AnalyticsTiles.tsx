import { MetricTile } from "@/components/dashboard/MetricTile";
import { formatCents } from "@/lib/format/money";
import type { AnalyticsTotals } from "@/lib/analytics/types";

/**
 * The five headline metrics for the selected range. Money renders only via
 * formatCents from integer cents; zero sales shows the calm zero state
 * instead of fake "0.00" figures. Views/Clicks are honestly pending until
 * the events pipeline exists — never invented numbers.
 */
export function AnalyticsTiles({ totals }: { totals: AnalyticsTotals }) {
  const hasSales = totals.sales > 0;
  // Refund rate over settled outcomes (paid + refunded) — display-only math,
  // never money. "0.0%" with real orders is a true, earned zero.
  const settled = totals.sales + totals.refundedCount;
  const refundRate =
    settled > 0 ? ((totals.refundedCount / settled) * 100).toFixed(1) : null;
  // Sales velocity across the window the data actually covers.
  const salesPerDay =
    hasSales && totals.rangeDays > 0
      ? (totals.sales / totals.rangeDays).toFixed(1)
      : null;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <MetricTile
        label="Revenue"
        value={hasSales ? formatCents(totals.revenueCents, totals.currency) : null}
        hint={
          hasSales
            ? `${formatCents(totals.netRevenueCents, totals.currency)} after fees`
            : undefined
        }
        zeroText="No sales yet"
      />
      <MetricTile
        label="Sales"
        value={hasSales ? String(totals.sales) : null}
        hint={salesPerDay ? `${salesPerDay} per day on average` : undefined}
        zeroText="No sales yet"
      />
      <MetricTile
        label="Avg. order"
        value={hasSales ? formatCents(totals.aovCents, totals.currency) : null}
        zeroText="No sales yet"
      />
      <MetricTile
        label="Unique buyers"
        value={hasSales ? String(totals.uniqueBuyers) : null}
        hint={
          hasSales && totals.repeatBuyers > 0
            ? `${totals.repeatBuyers} bought more than once`
            : undefined
        }
        zeroText="No buyers yet"
      />
      <MetricTile
        label="Refund rate"
        value={refundRate != null ? `${refundRate}%` : null}
        hint={
          totals.refundedCount > 0
            ? `${totals.refundedCount} refunded, ${formatCents(totals.refundedCents, totals.currency)}`
            : undefined
        }
        zeroText="No orders yet"
      />
      <MetricTile
        label="Platform fees"
        value={hasSales ? formatCents(totals.feesCents, totals.currency) : null}
        zeroText="No sales yet"
      />
      {/* TODO(analytics-events): live once the events pipeline lands */}
      <MetricTile label="Views" pending />
      {/* TODO(analytics-events): live once the events pipeline lands */}
      <MetricTile label="Clicks" pending />
    </div>
  );
}
