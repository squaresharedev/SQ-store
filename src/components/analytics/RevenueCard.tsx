"use client";

import { useLocale, useTranslations } from "next-intl";
import { CHART, SCRUB } from "@/components/charts";
import { metricDataAttributes } from "@/components/dashboard/MetricTile";
import { InfoTip } from "@/components/ui/InfoTip";
import { MoneyFigure } from "@/components/ui/MoneyFigure";
import { infoTextClass } from "@/components/ui/control-styles";
import { cardClass, eyebrowClass, joinedCellClass } from "@/components/ui/surface-styles";
import type { AnalyticsRange, RevenuePoint } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { useAnalyticsLook } from "@/components/analytics/AnalyticsLookProvider";
import { alignPrevious } from "@/components/analytics/compare";
import { FIGURE_CLASS, moneyColor, sumLine } from "@/components/analytics/look";
import { flatSeries } from "@/components/analytics/RevenueHero";
import { ScrubTrend } from "@/components/analytics/ScrubTrend";

/**
 * THE REVENUE HEADLINE AS THE PAYMENTS TAB DRAWS ITS EARNINGS (look.lead
 * "card"): the figure on top, its change on the period before as a chip, and
 * under it one plain line to read by moving along it, in a card. RevenueHero
 * is the other way (corner marks, the chart bled across the page with the
 * figure laid over it); both take the same figures and publish the same ones.
 *
 * It is the Revenue tile too: it publishes `sales.revenue` exactly as the tile
 * did (docs/analytics-datapoints.md), and the "trend" panel around it.
 *
 * `joined` makes it a cell of a joined block (the trend tiles under it share
 * its edges) instead of a card of its own.
 */
export function RevenueCard({
  series: salesSeries,
  range,
  revenueCents,
  netRevenueCents,
  currency,
  empty,
  previous,
  joined = false,
}: {
  series: RevenuePoint[];
  /** The dates the figures cover, resolved. Only read when `empty`. */
  range: AnalyticsRange;
  revenueCents: number;
  netRevenueCents: number;
  currency: string;
  /** No paid order in the range: words over a flat line, never a "0.00". */
  empty: boolean;
  /** The period before the range, bucketed the same way. Absent or empty
   *  means there is nothing to compare against. */
  previous?: { revenueCents: number; series: RevenuePoint[]; range?: { from: string; to: string } } | null;
  joined?: boolean;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const look = useAnalyticsLook();
  const series = empty ? flatSeries(range) : salesSeries;
  const before = empty
    ? null
    : alignPrevious(series.length, previous?.series.map((point) => point.revenueCents) ?? []);
  const title = t("sales.revenue.title");

  return (
    <section
      className={cn(joined ? joinedCellClass : cardClass, "min-w-0 p-5 sm:p-6")}
      data-analytics-panel="trend"
      data-analytics-source="sales"
      data-analytics-state={empty ? "empty" : "live"}
    >
      <div className="flex items-center gap-1.5">
        <h3 className={cn(eyebrowClass, "tracking-widest")}>{t("tiles.revenue")}</h3>
        <InfoTip label={t("chart.howToRead", { title })}>{t("sales.revenue.description")}</InfoTip>
      </div>
      <div
        className="mt-1"
        {...metricDataAttributes({
          metric: "sales.revenue",
          value: revenueCents,
          unit: "currency_cents",
          currency,
          source: "sales",
        })}
      >
        <ScrubTrend
          values={sumLine(
            series.map((point) => point.revenueCents),
            look.line,
          )}
          compare={before && sumLine(before, look.line)}
          dates={series.map((point) => point.date)}
          line={look.line}
          total={revenueCents}
          before={before && previous ? previous.revenueCents : null}
          beforeRange={previous?.range}
          show={(cents) => <MoneyFigure cents={cents} currency={currency} fit />}
          showText={(cents) => formatCents(cents, currency, locale)}
          // Money is coloured; a range that earned none is not.
          color={empty ? CHART.series3 : moneyColor(look)}
          height={SCRUB.leadHeight}
          size="lead"
          figureClassName={FIGURE_CLASS[look.figure]}
          emptyText={empty ? t("chart.emptyDefault") : null}
          legend={{ now: t("sales.revenue.series"), before: t("compare.previous") }}
          ariaLabel={t("sales.revenue.ariaLabel")}
        >
          {!empty && (
            <p className={cn(infoTextClass, "mt-1")}>
              {t("tiles.afterFees", { amount: formatCents(netRevenueCents, currency, locale) })}
            </p>
          )}
        </ScrubTrend>
      </div>
    </section>
  );
}
