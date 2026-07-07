import type { AnalyticsData, AnalyticsRange, RangePreset } from "@/lib/analytics/types";
import { AnalyticsTiles } from "./AnalyticsTiles";
import { AovTrendChart } from "./AovTrendChart";
import { ChartCard } from "./ChartCard";
import { ChannelSplitChart } from "./ChannelSplitChart";
import { DemographicsCard } from "./DemographicsCard";
import { RangeSelector } from "./RangeSelector";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { StatusBreakdown } from "./StatusBreakdown";
import { TopProductsChart } from "./TopProductsChart";
import { WeekdayChart } from "./WeekdayChart";

// Composition only: range control -> URL -> server re-query -> these modules.
// Every module reacts to the same range; each renders a calm empty state when
// the range holds no paid sales. No data access here.

/**
 * The analytics page body: range selector, headline tiles, then the charts
 * (revenue trend full-width; AOV/channels, weekdays/top products and status
 * mix/demographics in two-up rows). Server-safe — only the charts and the
 * selector are client islands.
 */
export function AnalyticsPage({
  data,
  preset,
  range,
}: {
  data: AnalyticsData;
  preset: RangePreset;
  /** Custom bounds from the URL (empty for the presets). */
  range: AnalyticsRange;
}) {
  const hasSales = data.totals.sales > 0;
  const hasOrders = data.statuses.some((slice) => slice.count > 0);

  return (
    <div className="space-y-6">
      <RangeSelector preset={preset} range={range} />

      <AnalyticsTiles totals={data.totals} />

      <ChartCard
        title="Revenue"
        description="Paid revenue over time."
        empty={!hasSales || data.series.length === 0}
      >
        <RevenueTrendChart series={data.series} currency={data.totals.currency} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Average order value"
          description="How much a typical order is worth over time."
          empty={!hasSales || data.series.length === 0}
        >
          <AovTrendChart series={data.series} currency={data.totals.currency} />
        </ChartCard>
        <ChartCard
          title="Channels"
          description="Where your sales come from."
          empty={!hasSales}
        >
          <ChannelSplitChart
            channels={data.channels}
            currency={data.totals.currency}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Sales by weekday"
          description="Your store's weekly rhythm."
          empty={!hasSales}
        >
          <WeekdayChart weekdays={data.weekdays} currency={data.totals.currency} />
        </ChartCard>
        <ChartCard
          title="Top products"
          description="Your best sellers by paid revenue."
          empty={data.topProducts.length === 0}
        >
          <TopProductsChart
            products={data.topProducts}
            currency={data.totals.currency}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Order status"
          description="The full order mix, refunds and disputes included."
          empty={!hasOrders}
          emptyText="No orders in this range"
        >
          <StatusBreakdown statuses={data.statuses} />
        </ChartCard>
        <DemographicsCard />
      </div>
    </div>
  );
}
