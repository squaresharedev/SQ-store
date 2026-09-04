import { MetricTile } from "@/components/dashboard/MetricTile";
import { formatCents } from "@/lib/format/money";
import { formatNumber } from "@/components/charts";
import type { AnalyticsTotals } from "@/lib/analytics/types";

/**
 * The headline sales metrics for the selected range.
 *
 * Money renders only via formatCents from integer cents; zero sales shows the
 * calm zero state instead of a fake "0.00".
 *
 * Every tile also publishes its RAW figure through `datapoint`, integer cents
 * for money, a plain count otherwise, so the numbers a person reads and the
 * numbers a machine reads are the same numbers. See
 * docs/analytics-datapoints.md.
 *
 * The old Views and Clicks tiles are gone from here: they were honest
 * "coming soon" placeholders, and now that the signal pipeline exists they are
 * real figures living in their own sections further down the page, where they
 * come with a trend and a breakdown rather than a bare number.
 */
export function AnalyticsTiles({ totals }: { totals: AnalyticsTotals }) {
  const hasSales = totals.sales > 0;
  // Refund rate over settled outcomes (paid + refunded) — display-only math,
  // never money. "0.0%" with real orders is a true, earned zero.
  const settled = totals.sales + totals.refundedCount;
  const refundRate = settled > 0 ? (totals.refundedCount / settled) * 100 : null;
  // Sales velocity across the window the data actually covers.
  const salesPerDay =
    hasSales && totals.rangeDays > 0 ? totals.sales / totals.rangeDays : null;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <MetricTile
        label="Revenue"
        value={hasSales ? formatCents(totals.revenueCents, totals.currency) : null}
        hint={
          hasSales
            ? `${formatCents(totals.netRevenueCents, totals.currency)} after fees`
            : undefined
        }
        zeroText="No sales yet"
        datapoint={{
          metric: "sales.revenue",
          value: totals.revenueCents,
          unit: "currency_cents",
          currency: totals.currency,
          source: "sales",
        }}
      />
      <MetricTile
        label="Sales"
        value={hasSales ? formatNumber(totals.sales) : null}
        hint={
          salesPerDay != null
            ? `${salesPerDay.toFixed(1)} per day on average`
            : undefined
        }
        zeroText="No sales yet"
        datapoint={{
          metric: "sales.count",
          value: totals.sales,
          unit: "count",
          source: "sales",
        }}
      />
      <MetricTile
        label="Avg. order"
        value={hasSales ? formatCents(totals.aovCents, totals.currency) : null}
        zeroText="No sales yet"
        datapoint={{
          metric: "sales.aov",
          value: totals.aovCents,
          unit: "currency_cents",
          currency: totals.currency,
          source: "sales",
        }}
      />
      <MetricTile
        label="Unique buyers"
        value={hasSales ? formatNumber(totals.uniqueBuyers) : null}
        hint={
          hasSales && totals.repeatBuyers > 0
            ? `${totals.repeatBuyers} bought more than once`
            : undefined
        }
        zeroText="No buyers yet"
        datapoint={{
          metric: "sales.unique_buyers",
          value: totals.uniqueBuyers,
          unit: "count",
          source: "sales",
        }}
      />
      <MetricTile
        label="Refund rate"
        value={refundRate != null ? `${refundRate.toFixed(1)}%` : null}
        hint={
          totals.refundedCount > 0
            ? `${totals.refundedCount} refunded, ${formatCents(totals.refundedCents, totals.currency)}`
            : undefined
        }
        zeroText="No orders yet"
        datapoint={{
          metric: "sales.refund_rate",
          // Published at full precision. The tile rounds to one decimal for
          // reading; a machine doing arithmetic should not inherit that.
          value: refundRate ?? 0,
          unit: "percent",
          source: "sales",
        }}
      />
    </div>
  );
}
