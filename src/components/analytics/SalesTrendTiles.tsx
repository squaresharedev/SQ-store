"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SCRUB, ScrubChart, formatNumber } from "@/components/charts";
import { metricDataAttributes } from "@/components/dashboard/MetricTile";
import { ChangeChip } from "@/components/ui/ChangeChip";
import { MoneyFigure } from "@/components/ui/MoneyFigure";
import { infoTextClass } from "@/components/ui/control-styles";
import { cardClass, joinedCellClass } from "@/components/ui/surface-styles";
import type { AnalyticsTotals, PreviousPeriod, RevenuePoint } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { useAnalyticsLook } from "@/components/analytics/AnalyticsLookProvider";
import { averageLine, moneyColor, sumLine } from "@/components/analytics/look";
import { useSalesTiles, type SalesTile } from "@/components/analytics/sales-tiles";

/** What a tile can add to its figure: the period before's, and a line. */
type TileTrend = { before: number | null; spark: (number | null)[] | null; show: (value: number) => string; figure?: ReactNode };

/**
 * The sales tiles as the Payments tab draws its trend tiles (look.tiles
 * "trend"): each figure with its change on the period before as a chip, that
 * period's figure under it, and its own line along the bottom, so a tile shows
 * how it got there and not only where it ended. Same facts as AnalyticsTiles
 * (useSalesTiles), drawn the other way.
 *
 * Only sales and the average order have a series and a figure for the period
 * before; buyers and the refund rate keep their hint and no line, rather than
 * a made-up one.
 *
 * `joined` makes them cells of the revenue card's joined block.
 */
export function SalesTrendTiles({
  totals,
  series,
  previous,
  joined = false,
}: {
  totals: AnalyticsTotals;
  series: RevenuePoint[];
  previous?: PreviousPeriod["sales"] | null;
  joined?: boolean;
}) {
  const tTrends = useTranslations("Common.charts");
  const locale = useLocale();
  const look = useAnalyticsLook();
  const tiles = useSalesTiles(totals);
  const hasSales = totals.sales > 0;
  // A period before that sold nothing is no yardstick (compare.ts).
  const before = previous && previous.series.length > 0 ? previous : null;
  const money = (cents: number) => formatCents(cents, totals.currency, locale);
  const count = (value: number) => formatNumber(value, locale);

  const trendOf = (tile: SalesTile): TileTrend | null => {
    if (!hasSales) return null;
    if (tile.key === "sales") {
      return {
        before: before?.sales ?? null,
        spark: sumLine(
          series.map((point) => point.sales),
          look.line,
        ),
        show: count,
      };
    }
    if (tile.key === "avgOrder") {
      return {
        before: before?.aovCents ?? null,
        spark: averageLine(
          series.map((point) => ({ totalCents: point.revenueCents, count: point.sales })),
          look.line,
        ),
        show: money,
        figure: <MoneyFigure cents={totals.aovCents} currency={totals.currency} fit />,
      };
    }
    return null;
  };

  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4", joined ? "gap-px" : "gap-4")} data-trend-tiles="">
      {tiles.map((tile) => {
        const trend = trendOf(tile);
        const spark = trend?.spark && trend.spark.length > 1 ? trend.spark : null;
        const compared = trend && trend.before !== null && trend.before > 0 ? trend.before : null;
        return (
          <section
            key={tile.key}
            className={cn(
              joined ? joinedCellClass : cardClass,
              "flex min-w-0 flex-col overflow-hidden p-4",
              spark && "pb-0",
            )}
            {...metricDataAttributes(tile.datapoint)}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <h3 className="font-inter text-xs font-medium text-muted-foreground">{tile.label}</h3>
              {compared !== null && trend && (
                <ChangeChip current={tile.datapoint.value} previous={compared} calm />
              )}
            </div>
            {tile.value === null ? (
              <p className="mt-1 font-inter text-sm text-muted-foreground">{tile.zeroText}</p>
            ) : (
              <p className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">
                {trend?.figure ?? <span className="tabular-nums">{tile.value}</span>}
              </p>
            )}
            {compared !== null && trend ? (
              <p className={cn(infoTextClass, "mt-0.5")}>{tTrends("vsBefore", { amount: trend.show(compared) })}</p>
            ) : (
              tile.hint && <p className={cn(infoTextClass, "mt-0.5")}>{tile.hint}</p>
            )}
            {/* Pinned to the tile's bottom edge, so the lines of a row line up
                when one tile's words run to two lines. */}
            {spark && (
              <div className="-mx-4 mt-auto pt-3">
                <ScrubChart
                  values={spark}
                  color={moneyColor(look)}
                  height={SCRUB.sparkHeight}
                  strokeWidth={SCRUB.sparkStroke}
                  baseline={false}
                  ariaLabel={tTrends("spark", { label: tile.label })}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
