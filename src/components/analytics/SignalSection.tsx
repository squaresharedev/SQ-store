import { MetricTile } from "@/components/dashboard/MetricTile";
import { formatCents } from "@/lib/format/money";
import { formatNumber } from "@/components/charts";
import type { AnalyticsSource, SourcePanel } from "@/lib/analytics/sources";
import { resolveSourceState } from "@/lib/analytics/sources";
import type { SignalBreakdown } from "@/lib/analytics/types";
import { AnalyticsSection } from "@/components/analytics/AnalyticsSection";
import { TONE } from "@/components/analytics/palette";
import { ChartCard } from "@/components/analytics/ChartCard";
import {
  SignalChannelChart,
  SignalStorefrontsChart,
  SignalTrendChart,
  SignalWeekdayChart,
} from "@/components/analytics/SignalCharts";

/**
 * ONE SOURCE'S SECTION, rendered from its registry entry.
 *
 * This component is the payoff for the whole design: it is written once and
 * knows nothing about views, clicks, signups or bookings specifically. Give it
 * a source and that source's breakdown and it produces the tiles, the panels
 * in the declared order, the empty states and the machine-readable attributes.
 * A new measurable surface is a registry entry plus a producer, not a screen.
 *
 * THREE STATES, and the difference between them matters to a seller:
 *
 *   live + data:    the charts.
 *   live + no data: "nothing in this range", which is a real answer.
 *   awaiting:       nothing produces this yet, dashed, and the copy says
 *                     what will ship it. Never a zero, because a zero here
 *                     would read as "nobody signed up" rather than "signups
 *                     are not being counted".
 *
 * The awaiting state is a DEFAULT, not a lock: resolveSourceState promotes any
 * source with real rows to live, so the day a producer lands its section fills
 * in without this file changing.
 */
export function SignalSection({
  source,
  breakdown,
  currency,
}: {
  source: AnalyticsSource;
  breakdown: SignalBreakdown;
  /** Only read when the source carries money. */
  currency: string;
}) {
  const { totals } = breakdown;
  const state = resolveSourceState(source, totals.count);
  const awaiting = state === "awaiting" ? source.awaiting : undefined;
  const hasData = totals.count > 0;
  const emptyText = `No ${source.noun.many} in this range`;

  return (
    <AnalyticsSection
      id={source.id}
      title={source.label}
      description={source.description}
      icon={source.icon}
      state={state}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label={`Total ${source.noun.many}`}
          value={hasData ? formatNumber(totals.count) : null}
          pending={awaiting !== undefined}
          // Short on purpose. The generic "waiting on analytics" would be
          // wrong (analytics IS connected; this metric is waiting on its own
          // block), and the full explanation belongs in exactly ONE place per
          // section: the card below, where there is room to read it.
          pendingText="Not measured yet."
          zeroText={emptyText}
          datapoint={{
            metric: `${source.id}.count`,
            value: totals.count,
            unit: "count",
            source: source.id,
          }}
        />
        {/* An awaiting source gets ONE tile, not the full set. The datapoint
            still ships (a machine reader needs to know the metric exists and
            is not yet measured), but three tiles repeating one sentence is the
            same noise as three identical placeholder charts. */}
        {!awaiting && (
          <MetricTile
            label="Visitors"
            // Distinct visitors only exist if the producer sends a digest. Zero
            // with real signals means "not attributed", not "nobody", so it
            // renders the calm zero rather than a confident 0.
            value={
              totals.uniqueVisitors > 0 ? formatNumber(totals.uniqueVisitors) : null
            }
            hint={
              totals.uniqueVisitors > 0 && totals.count > totals.uniqueVisitors
                ? `${
                    Math.round((totals.count / totals.uniqueVisitors) * 10) / 10
                  } per visitor on average`
                : undefined
            }
            zeroText="Not counted yet"
            datapoint={{
              metric: `${source.id}.unique_visitors`,
              value: totals.uniqueVisitors,
              unit: "count",
              source: source.id,
            }}
          />
        )}
        {!awaiting && source.carriesValue && (
          <MetricTile
            label="Value"
            value={
              totals.valueCents > 0 ? formatCents(totals.valueCents, currency) : null
            }
            zeroText="No value yet"
            datapoint={{
              metric: `${source.id}.value`,
              value: totals.valueCents,
              unit: "currency_cents",
              currency,
              source: source.id,
            }}
          />
        )}
      </div>

      {awaiting ? (
        // ONE card, not the full panel set. A source with no producer has
        // nothing to break down, and three identical "coming soon" cards
        // reading the same sentence is noise pretending to be a layout
        // preview. The panels arrive when the data does.
        <ChartCard
          title={`${source.label} over time`}
          description={`Ready to chart as soon as ${source.noun.many} start arriving.`}
          awaiting={awaiting}
          panel="trend"
          source={source.id}
          headingLevel="h3"
        >
          {null}
        </ChartCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {source.panels.map((panel) => (
            <SignalPanel
              key={panel}
              panel={panel}
              source={source}
              breakdown={breakdown}
              emptyText={emptyText}
              hasData={hasData}
              // The trend is the section's headline and reads best across the
              // full width; the breakdowns pair up beside each other.
              className={panel === "trend" ? "lg:col-span-2" : undefined}
            />
          ))}
        </div>
      )}
    </AnalyticsSection>
  );
}

/** The panel titles, kept beside the switch that renders them. */
const PANEL_TITLES: Record<SourcePanel, string> = {
  trend: "Over time",
  channels: "Channels",
  weekdays: "By weekday",
  storefronts: "By storefront",
};

function SignalPanel({
  panel,
  source,
  breakdown,
  emptyText,
  hasData,
  className,
}: {
  panel: SourcePanel;
  source: AnalyticsSource;
  breakdown: SignalBreakdown;
  emptyText: string;
  hasData: boolean;
  className?: string;
}) {
  const shared = {
    panel,
    source: source.id,
    emptyText,
    headingLevel: "h3" as const,
    className,
  };
  // Blue for activity, green for a source that is income. A booking is money
  // and should not be drawn like a page view (palette.ts).
  const tone = source.carriesValue ? TONE.money : TONE.traffic;

  if (panel === "trend") {
    return (
      <ChartCard
        {...shared}
        title={PANEL_TITLES.trend}
        description={`${source.label} across the selected range.`}
        empty={!hasData || breakdown.series.length === 0}
      >
        <SignalTrendChart
          series={breakdown.series}
          noun={source.noun}
          label={source.label}
          tone={tone}
        />
      </ChartCard>
    );
  }

  if (panel === "channels") {
    return (
      <ChartCard
        {...shared}
        title={PANEL_TITLES.channels}
        description="Where they came from."
        empty={!hasData}
      >
        <SignalChannelChart
          channels={breakdown.channels}
          noun={source.noun}
          label={source.label}
        />
      </ChartCard>
    );
  }

  if (panel === "weekdays") {
    return (
      <ChartCard
        {...shared}
        title={PANEL_TITLES.weekdays}
        description="The weekly rhythm."
        empty={!hasData}
      >
        <SignalWeekdayChart
          weekdays={breakdown.weekdays}
          noun={source.noun}
          label={source.label}
          tone={tone}
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      {...shared}
      title={PANEL_TITLES.storefronts}
      description="Which storefront they came from."
      empty={!hasData || breakdown.storefronts.length === 0}
    >
      <SignalStorefrontsChart
        storefronts={breakdown.storefronts}
        noun={source.noun}
        label={source.label}
        tone={tone}
      />
    </ChartCard>
  );
}
