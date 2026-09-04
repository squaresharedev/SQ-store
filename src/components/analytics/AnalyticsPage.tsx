import {
  SIGNAL_SOURCES,
  SALES_SOURCE,
  isSourceRelevant,
} from "@/lib/analytics/sources";
import type { AnalyticsRange, AnalyticsSnapshot } from "@/lib/analytics/types";
import { AnalyticsSection } from "./AnalyticsSection";
import { AnalyticsSnapshotScript } from "./AnalyticsSnapshotScript";
import { AnalyticsTiles } from "./AnalyticsTiles";
import { AovTrendChart } from "./AovTrendChart";
import { ChartCard } from "./ChartCard";
import { ChannelSplitChart } from "./ChannelSplitChart";
import { RangeSelector } from "./RangeSelector";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { SignalSection } from "./SignalSection";
import { SignalsUnavailableNotice } from "./SignalsUnavailableNotice";
import { StatusBreakdown } from "./StatusBreakdown";
import { TopProductsChart } from "./TopProductsChart";
import { WeekdayChart } from "./WeekdayChart";

// Composition only: range control -> URL -> server re-query -> these sections.
// Every section reacts to the same range; each renders a calm empty state when
// the range holds nothing. No data access here.
//
// THE PAGE IS A STACK OF SOURCES. Sales first, because it is why a seller
// opens this page, and it stays hand-composed: orders carry money, refunds and
// a status lifecycle, so its panels genuinely differ from every other source's.
// Everything after it is generated from SIGNAL_SOURCES, so shipping a new
// measurable surface adds a section here without touching this file.

/**
 * The analytics page body: range selector, the sales section, then one section
 * per registered signal source. Server-safe: only the charts and the selector
 * are client islands.
 */
export function AnalyticsPage({
  snapshot,
  custom,
}: {
  snapshot: AnalyticsSnapshot;
  /**
   * The custom bounds as they appear in the URL, empty for the presets.
   *
   * Deliberately NOT snapshot.range: that one is RESOLVED (a preset's open
   * upper bound becomes today, because a figure without the window it covers
   * is not readable by a machine). Echoing a resolved bound back into the
   * picker would silently convert "last 30 days" into a fixed custom range the
   * moment the page rendered.
   */
  custom: AnalyticsRange;
}) {
  const { sales, signals, range, currency } = snapshot;
  const hasSales = sales.totals.sales > 0;
  const hasOrders = sales.statuses.some((slice) => slice.count > 0);

  return (
    <div
      className="space-y-10"
      data-analytics-range-from={range.from ?? ""}
      data-analytics-range-to={range.to ?? ""}
      data-analytics-range-preset={range.preset}
      data-analytics-currency={currency}
    >
      {/* The payload the charts were drawn from, for readers that are not
          people. Rendered first so it is in the document before any chart
          hydrates. */}
      <AnalyticsSnapshotScript snapshot={snapshot} />

      <RangeSelector preset={range.preset} range={custom} />

      <AnalyticsSection
        id={SALES_SOURCE.id}
        title={SALES_SOURCE.label}
        description={SALES_SOURCE.description}
        icon={SALES_SOURCE.icon}
        state="live"
      >
        <AnalyticsTiles totals={sales.totals} />

        <ChartCard
          title="Revenue"
          description="Paid revenue over time."
          empty={!hasSales || sales.series.length === 0}
          panel="trend"
          source="sales"
          headingLevel="h3"
        >
          <RevenueTrendChart series={sales.series} currency={currency} />
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Average order value"
            description="How much a typical order is worth over time."
            empty={!hasSales || sales.series.length === 0}
            panel="aov"
            source="sales"
            headingLevel="h3"
          >
            <AovTrendChart series={sales.series} currency={currency} />
          </ChartCard>
          <ChartCard
            title="Channels"
            description="Where your sales come from."
            empty={!hasSales}
            panel="channels"
            source="sales"
            headingLevel="h3"
          >
            <ChannelSplitChart channels={sales.channels} currency={currency} />
          </ChartCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Sales by weekday"
            description="Your store's weekly rhythm."
            empty={!hasSales}
            panel="weekdays"
            source="sales"
            headingLevel="h3"
          >
            <WeekdayChart weekdays={sales.weekdays} />
          </ChartCard>
          <ChartCard
            title="Top products"
            description="Your best sellers by paid revenue."
            empty={sales.topProducts.length === 0}
            panel="top_products"
            source="sales"
            headingLevel="h3"
          >
            <TopProductsChart products={sales.topProducts} currency={currency} />
          </ChartCard>
        </div>

        {/* Full width because it is now alone in its row: the "Buyer countries"
            placeholder that used to sit beside it is gone. It was a dashed card
            for data checkout does not capture, which is the same thing as a
            section for a block the seller has not added, and the same answer
            applies. A composition bar is happy across the full column. */}
        <ChartCard
          title="Order status"
          description="The full order mix, refunds and disputes included."
          empty={!hasOrders}
          emptyText="No orders in this range"
          panel="statuses"
          source="sales"
          headingLevel="h3"
        >
          <StatusBreakdown statuses={sales.statuses} />
        </ChartCard>
      </AnalyticsSection>

      {/* One read failing must not take the page with it: revenue is still
          right above, so the signal sections say so and stop. */}
      {!signals.available && <SignalsUnavailableNotice />}

      {/* Only the sources this seller actually runs. A registered kind with no
          block placed and no history is a feature they have not adopted, and
          rendering it as a "coming soon" band would push the numbers they came
          for further down their own page. isSourceRelevant owns that test; the
          section reappears on its own the moment the block is placed. */}
      {signals.available &&
        SIGNAL_SOURCES.filter((source) =>
          isSourceRelevant(source, {
            everRecorded: signals.everRecorded,
            activeBlockTypes: signals.activeBlockTypes,
          }),
        ).map((source) => (
          <SignalSection
            key={source.id}
            source={source}
            breakdown={signals.byKind[source.id]}
            currency={currency}
          />
        ))}
    </div>
  );
}
