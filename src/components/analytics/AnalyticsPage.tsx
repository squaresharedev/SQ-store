import Link from "@/components/ui/AppLink";
import { useLocale, useTranslations } from "next-intl";
import { formatList } from "@/lib/format/intl";
import { TrendingUp } from "lucide-react";
import { helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { emptyIconClass, emptyStateClass, joinedCardsClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import {
  SIGNAL_SOURCES,
  SALES_SOURCE,
  isSourceRelevant,
} from "@/lib/analytics/sources";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { funnelHasActivity } from "@/lib/analytics/funnel/summary";
import type { AnalyticsRange, AnalyticsSnapshot } from "@/lib/analytics/types";
import { AnalyticsLookProvider } from "./AnalyticsLookProvider";
import { AnalyticsSection } from "./AnalyticsSection";
import { AnalyticsSnapshotScript } from "./AnalyticsSnapshotScript";
import { AnalyticsTiles } from "./AnalyticsTiles";
import { AovTrendChart } from "./AovTrendChart";
import { ChartCard } from "./ChartCard";
import { ChannelSplitChart } from "./ChannelSplitChart";
import { FunnelSection } from "./FunnelSection";
import { RangeSelector } from "./RangeSelector";
import { ANALYTICS_LOOK, moneyStyle, type AnalyticsLook } from "./look";
import { RevenueCard } from "./RevenueCard";
import { RevenueHero } from "./RevenueHero";
import { SalesTrendTiles } from "./SalesTrendTiles";
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
//
// HOW it is drawn is one AnalyticsLook (look.ts): the revenue lead, the tiles,
// the trend cards, the axes of every chart and the colour of money. /analytics
// passes none and gets ANALYTICS_LOOK; /dev/analytics-lab tries the others.

/**
 * The analytics page body: range selector, the sales section, then one section
 * per registered signal source. Server-safe: only the charts and the selector
 * are client islands.
 */
export function AnalyticsPage({
  snapshot,
  custom,
  firstRun = false,
  look = ANALYTICS_LOOK,
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
  /**
   * The store has never had an order, a storefront or a signal. The page is
   * then one empty state in place of the range control and every section,
   * while still publishing its root attributes and the snapshot, so a reader
   * that is not a person gets the same (empty) figures either way.
   */
  firstRun?: boolean;
  /** How the page is drawn. ANALYTICS_LOOK unless a lab is trying another. */
  look?: AnalyticsLook;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const { sales, signals, funnel, range, currency, previous } = snapshot;
  const hasSales = sales.totals.sales > 0;
  const hasOrders = sales.statuses.some((slice) => slice.count > 0);
  const revenueEmpty = !hasSales || sales.series.length === 0;
  const revenue = {
    series: sales.series,
    range,
    revenueCents: sales.totals.revenueCents,
    netRevenueCents: sales.totals.netRevenueCents,
    currency,
    empty: revenueEmpty,
    previous: previous ? { ...previous.sales, range: previous.range } : undefined,
  };
  // The Payments tab's block: the card lead and the trend tiles sharing their
  // edges, as one piece.
  const joined = look.lead === "card" && look.tiles === "trend" && look.joined;
  const trendTiles = (
    <SalesTrendTiles
      totals={sales.totals}
      series={sales.series}
      previous={previous?.sales}
      joined={joined}
    />
  );
  const lead =
    look.lead === "frame" ? (
      <RevenueHero {...revenue} />
    ) : joined ? (
      <div className={joinedCardsClass}>
        <RevenueCard {...revenue} joined />
        {trendTiles}
      </div>
    ) : (
      <RevenueCard {...revenue} />
    );

  const rootData = {
    "data-analytics-range-from": range.from ?? "",
    "data-analytics-range-to": range.to ?? "",
    "data-analytics-range-preset": range.preset,
    "data-analytics-currency": currency,
  };

  if (firstRun) {
    return (
      <div className="space-y-10" {...rootData} data-analytics-first-run="1">
        <AnalyticsSnapshotScript snapshot={snapshot} />
        <div className={cn(emptyStateClass, "bg-background")}>
          <div className={emptyIconClass}>
            <TrendingUp className="size-6" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {t("firstRun.title")}
          </h2>
          <p className={cn(helpTextClass, "mt-1 max-w-sm")}>
            {t("firstRun.body")}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href={STOREFRONT_LIST_PATH} className={secondaryButtonClass}>
              {t("firstRun.publishStorefront")}
            </Link>
            <Link href={PRODUCTS_PATH} className={secondaryButtonClass}>
              {t("firstRun.goToProducts")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AnalyticsLookProvider look={look}>
      <div className="space-y-10" style={moneyStyle(look)} {...rootData}>
        {/* The payload the charts were drawn from, for readers that are not
            people. Rendered first so it is in the document before any chart
            hydrates. */}
        <AnalyticsSnapshotScript snapshot={snapshot} />

        <RangeSelector preset={range.preset} range={custom} />

        <AnalyticsSection
          id={SALES_SOURCE.id}
          title={t("sales.label")}
          description={t("sales.description")}
          icon={SALES_SOURCE.icon}
          state="live"
          // Revenue leads, as the page's one headline figure (RevenueCard, or
          // RevenueHero for the frame look). It is the Revenue tile and the
          // revenue trend in a single piece, so neither appears again among
          // the tiles and cards below. Joined, the tiles are part of it.
          lead={lead}
        >
          {joined ? null : look.tiles === "trend" ? trendTiles : <AnalyticsTiles totals={sales.totals} />}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t("sales.aov.title")}
              description={t("sales.aov.description")}
              empty={revenueEmpty}
              panel="aov"
              source="sales"
              headingLevel="h3"
            >
              <AovTrendChart
                series={sales.series}
                currency={currency}
                previous={previous?.sales.series}
                aovCents={sales.totals.aovCents}
                previousAovCents={previous?.sales.aovCents}
              />
            </ChartCard>
            <ChartCard
              title={t("sales.channels.title")}
              description={t("sales.channels.description")}
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
              title={t("sales.weekday.title")}
              description={t("sales.weekday.description")}
              empty={!hasSales}
              panel="weekdays"
              source="sales"
              headingLevel="h3"
            >
              <WeekdayChart weekdays={sales.weekdays} products={sales.weekdayProducts} />
            </ChartCard>
            <ChartCard
              title={t("sales.topProducts.title")}
              description={t("sales.topProducts.description")}
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
            title={t("sales.orderStatus.title")}
            description={t("sales.orderStatus.description")}
            empty={!hasOrders}
            emptyText={t("sales.orderStatus.empty")}
            panel="statuses"
            source="sales"
            headingLevel="h3"
          >
            <StatusBreakdown statuses={sales.statuses} />
          </ChartCard>
        </AnalyticsSection>

        {/* The funnel between the two: sales above it, the views it starts from
            below. Only for a seller with something in it. A store nobody has
            embedded has no funnel, and a row of empty tiles saying so is the
            placeholder this page does not show (see the sources below). It
            reads the signals, so it waits on them like the sections under it. */}
        {signals.available && funnelHasActivity(funnel) && (
          <FunnelSection funnel={funnel} previous={previous?.funnel} />
        )}

        {/* One read failing must not take the page with it: revenue is still
            right above, so the signal sections say so and stop. */}
        {!signals.available && <SignalsUnavailableNotice />}

        {/* Only the sources this seller actually runs. A registered kind with no
            block placed and no history is a feature they have not adopted, and
            rendering it as a "coming soon" band would push the numbers they came
            for further down their own page. isSourceRelevant owns that test; the
            section reappears on its own the moment the block is placed. */}
        {signals.available &&
          (() => {
            const relevantContext = {
              everRecorded: signals.everRecorded,
              activeBlockTypes: signals.activeBlockTypes,
            };
            const relevantSources = SIGNAL_SOURCES.filter((source) =>
              isSourceRelevant(source, relevantContext),
            );
            // Only a source that CAN appear is worth naming. One still waiting
            // on its producer (a block or a report that does not exist yet) is
            // a promise the seller cannot act on, so it stays unsaid.
            const upcomingSources = SIGNAL_SOURCES.filter(
              (source) =>
                !source.awaiting && !isSourceRelevant(source, relevantContext),
            );
            // recordedOnly sources (e.g. checkout_view) need no block: split
            // them out so their footnote says the right thing.
            const upcomingRecorded = upcomingSources.filter((s) => s.recordedOnly);
            const upcomingBlock = upcomingSources.filter((s) => !s.recordedOnly);
            const upcomingBlockNeedProducts = upcomingBlock.every(
              (source) => source.blockType === "product",
            );
            const labelsFor = (sources: typeof upcomingSources) =>
              formatList(
                sources.map((source) => t(`sources.${source.id}.label`)),
                locale,
                { englishSeparator: ", " },
              );
            return (
              <>
                {relevantSources.map((source) => (
                  <SignalSection
                    key={source.id}
                    source={source}
                    breakdown={signals.byKind[source.id]}
                    previous={previous?.signals[source.id].series}
                    currency={currency}
                  />
                ))}
                {upcomingRecorded.length > 0 && (
                  <p className={helpTextClass}>
                    {t("upcoming.recordedOnly", { labels: labelsFor(upcomingRecorded) })}
                  </p>
                )}
                {upcomingBlock.length > 0 && (
                  <p className={helpTextClass}>
                    {upcomingBlockNeedProducts
                      ? t("upcoming.needProducts", { labels: labelsFor(upcomingBlock) })
                      : t("upcoming.needBlocks", { labels: labelsFor(upcomingBlock) })}
                  </p>
                )}
              </>
            );
          })()}
      </div>
    </AnalyticsLookProvider>
  );
}
