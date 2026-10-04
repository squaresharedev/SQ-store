"use client";

import { useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LineChart, bleedPlot, niceTicks } from "@/components/charts";
import { metricDataAttributes } from "@/components/dashboard/MetricTile";
import { CountUp } from "@/components/ui/CountUp";
import { InfoTip } from "@/components/ui/InfoTip";
import { infoTextClass } from "@/components/ui/control-styles";
import { eyebrowClass, pageGutterClass } from "@/components/ui/surface-styles";
import { formatBucketLabel, isMonthlySeries, planBuckets } from "@/lib/analytics/buckets";
import type { AnalyticsRange, RevenuePoint } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { cn } from "@/lib/utils";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import {
  HERO_CHART_HEIGHT,
  heroChartHeightClass,
} from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";
import {
  heroCeiling,
  heroSide,
  type HeroFootprint,
  type HeroSide,
} from "@/components/analytics/revenue-hero-layout";

// THE PAGE'S HEADLINE: revenue over time, drawn on the page itself.
//
// Every other chart here is a card. This one is not: the line starts at the
// left edge of the screen and ends at the right, with no border around it,
// because revenue is the number a seller opens the page for and it should not
// look like one card among twelve. Its parent gives it a full-width lane
// (AnalyticsSection's `lead`); this component fills whatever width it is given.
//
// The figure is laid over the plot, in the top corner the line leaves free:
// top left when the graph is going up, top right when it is going down
// (revenue-hero-layout.ts). Three things keep that readable:
//
//   - The value axis is raised just enough that the line never runs under the
//     figure, and no further, so the peak still climbs past it.
//   - The gridlines stop short of the figure instead of striking through it.
//   - The value labels run down the OTHER edge, inside the plot, each on its
//     own gridline, so the chart keeps its scale without an axis column.
//
// It is also the Revenue tile: it publishes `sales.revenue` exactly as the
// tile did (docs/analytics-datapoints.md), and the "trend" panel around it.
//
// A RANGE WITH NO SALES is the same chart lying flat: its dates along the
// bottom, a grey line on zero, and words where the figure would be. Never a
// "0.00" in the headline, and never a blank box that reads as a failed load.

/** Clear space kept around the figure, in px: the line and the gridlines stay
 *  this far from it. */
const CLEARANCE = 16;

/** Money is integer cents, so a value-axis step under one whole unit would
 *  print the same amount on two gridlines. */
const CENTS_PER_UNIT = 100;

/** The value axis of a range with nothing in it: any positive top will do,
 *  it only has to put zero on the baseline. */
const FLAT_CEILING = CENTS_PER_UNIT;

/**
 * The buckets of a range that sold nothing, all at zero.
 *
 * The sales series is empty for such a range (it is anchored on paid orders,
 * and there are none), but the range still has dates, and a flat line with its
 * dates under it says "nothing happened across these days". An unbounded range
 * has no dates to draw, and gets none.
 */
function flatSeries(range: AnalyticsRange): RevenuePoint[] {
  return planBuckets(range, null).keys.map((date) => ({
    date,
    revenueCents: 0,
    sales: 0,
    aovCents: 0,
  }));
}

/** Where the figure sits over the chart, in px from the hero's own box. */
type HeadlineBox = { start: number; end: number; bottom: number; width: number };

/** Until the figure has been measured: assume it covers its half of the plot,
 *  so a chart drawn a frame early errs towards too much room, never too little. */
function assumedFootprint(side: HeroSide): HeroFootprint {
  return side === "left" ? { from: 0, to: 0.5, depth: 0.4 } : { from: 0.5, to: 1, depth: 0.4 };
}

/** The figure's box, measured against the hero's, and kept current as either
 *  resizes. Null on the server and until the first measurement. */
function useHeadlineBox(
  frameRef: RefObject<HTMLDivElement | null>,
  headlineRef: RefObject<HTMLDivElement | null>,
  side: HeroSide,
): HeadlineBox | null {
  const [box, setBox] = useState<HeadlineBox | null>(null);

  // `side` is a dependency because moving the figure to the other corner
  // changes its position without changing its size, which no ResizeObserver
  // reports.
  useIsomorphicLayoutEffect(() => {
    const frame = frameRef.current;
    const headline = headlineRef.current;
    if (!frame || !headline || typeof ResizeObserver === "undefined") return;

    function measure() {
      if (!frame || !headline) return;
      const outer = frame.getBoundingClientRect();
      const inner = headline.getBoundingClientRect();
      if (outer.width === 0) return;
      const next: HeadlineBox = {
        start: Math.max(0, Math.round(inner.left - outer.left - CLEARANCE)),
        end: Math.min(outer.width, Math.round(inner.right - outer.left + CLEARANCE)),
        bottom: Math.round(inner.bottom - outer.top + CLEARANCE),
        width: Math.round(outer.width),
      };
      setBox((current) =>
        current &&
        current.start === next.start &&
        current.end === next.end &&
        current.bottom === next.bottom &&
        current.width === next.width
          ? current
          : next,
      );
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(headline);
    return () => observer.disconnect();
  }, [frameRef, headlineRef, side]);

  return box;
}

export function RevenueHero({
  series: salesSeries,
  range,
  revenueCents,
  netRevenueCents,
  currency,
  empty,
}: {
  series: RevenuePoint[];
  /** The dates the figures cover, resolved. Only read when `empty`. */
  range: AnalyticsRange;
  /** Paid revenue across the range, integer cents. */
  revenueCents: number;
  /** The same figure after platform fees. */
  netRevenueCents: number;
  currency: string;
  /** No paid order in the range: the calm empty state, never a "0.00". */
  empty: boolean;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const frameRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);

  const series = empty ? flatSeries(range) : salesSeries;
  const values = series.map((point) => point.revenueCents);
  const side = empty ? "left" : heroSide(values);
  const box = useHeadlineBox(frameRef, headlineRef, side);

  const plot = bleedPlot(HERO_CHART_HEIGHT);
  const footprint: HeroFootprint = box
    ? {
        from: box.start / box.width,
        to: box.end / box.width,
        depth: (box.bottom - plot.top) / plot.height,
      }
    : assumedFootprint(side);
  const ceiling = heroCeiling(values, footprint);

  const monthly = isMonthlySeries(series.map((point) => point.date));
  const title = t("sales.revenue.title");
  const figure = formatCents(revenueCents, currency, locale);

  return (
    <div
      ref={frameRef}
      className="relative"
      data-analytics-panel="trend"
      data-analytics-source="sales"
      data-analytics-state={empty ? "empty" : "live"}
    >
      {series.length === 0 ? (
        // No buckets at all (all time, before the first sale): there are no
        // dates to draw, so only the baseline is. Same height as the chart,
        // so changing the range never resizes the page.
        <div className={cn(heroChartHeightClass, "border-b border-border")} />
      ) : (
        <LineChart
          data={series}
          xKey="date"
          series={[
            {
              key: "revenueCents",
              label: t("sales.revenue.series"),
              // Green is money earned. A range that earned none is not green.
              colorIndex: empty ? TONE.faint : TONE.money,
            },
          ]}
          variant="area"
          bleed
          valueSide={side === "left" ? "right" : "left"}
          yDomain={[0, ceiling > 0 ? ceiling : FLAT_CEILING]}
          yTicks={ceiling > 0 ? niceTicks(ceiling, CENTS_PER_UNIT) : [0]}
          height={HERO_CHART_HEIGHT}
          valueFormatter={moneyExact(currency, locale)}
          axisValueFormatter={moneyCompact(currency, locale)}
          xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
          ariaLabel={t("sales.revenue.ariaLabel")}
        />
      )}

      {/* Where the gridlines stop: a page-coloured patch from the figure out to
          the edge of the screen. The line is never under it (heroCeiling), so
          all it interrupts is the grid. */}
      {!empty && box && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bg-background"
          style={
            side === "left"
              ? { left: 0, width: box.end, height: box.bottom }
              : { left: box.start, width: box.width - box.start, height: box.bottom }
          }
        />
      )}

      {/* Lined up with the page column, not with the screen edge, so the figure
          sits over the cards below it. Pointer events pass through to the
          chart: only the "?" takes them back. */}
      <div
        className={cn(
          pageGutterClass,
          "pointer-events-none absolute inset-x-0 top-0 flex",
          side === "right" && "justify-end",
        )}
      >
        <div
          ref={headlineRef}
          className={cn("min-w-0", side === "right" && "text-right")}
          {...metricDataAttributes({
            metric: "sales.revenue",
            value: revenueCents,
            unit: "currency_cents",
            currency,
            source: "sales",
          })}
        >
          <div className={cn("flex items-center gap-1.5", side === "right" && "justify-end")}>
            <h3 className={eyebrowClass}>{t("tiles.revenue")}</h3>
            <InfoTip label={t("chart.howToRead", { title })} className="pointer-events-auto">
              {t("sales.revenue.description")}
            </InfoTip>
          </div>
          {empty ? (
            <p className="mt-1 text-base font-medium text-muted-foreground">
              {t("chart.emptyDefault")}
            </p>
          ) : (
            <>
              {/* The settled figure holds the box's width while the visible one
                  counts up over it. Otherwise the box would grow on every
                  frame, and the chart would re-fit itself around it each time. */}
              <p className="relative mt-1 whitespace-nowrap text-4xl font-bold tabular-nums text-success sm:text-5xl">
                <CountUp value={figure} className="absolute inset-0" />
                <span aria-hidden="true" className="invisible">
                  {figure}
                </span>
              </p>
              <p className={cn(infoTextClass, "mt-1")}>
                {t("tiles.afterFees", {
                  amount: formatCents(netRevenueCents, currency, locale),
                })}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
