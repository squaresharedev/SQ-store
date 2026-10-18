"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { LineChart, bleedFade, bleedPlot, niceTicks } from "@/components/charts";
import { metricDataAttributes } from "@/components/dashboard/MetricTile";
import { CountUp } from "@/components/ui/CountUp";
import { FitText } from "@/components/ui/FitText";
import { InfoTip } from "@/components/ui/InfoTip";
import { infoTextClass } from "@/components/ui/control-styles";
import { eyebrowClass } from "@/components/ui/surface-styles";
import { formatBucketLabel, isMonthlySeries, planBuckets } from "@/lib/analytics/buckets";
import type { AnalyticsRange, RevenuePoint } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { cn } from "@/lib/utils";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { heroChartHeightClass, heroFrameClass } from "@/components/analytics/chart-layout";
import { alignPrevious, changeRatio, formatChange } from "@/components/analytics/compare";
import { TONE } from "@/components/analytics/palette";
import {
  heroCeiling,
  heroSide,
  type HeroFootprint,
  type HeroSide,
} from "@/components/analytics/revenue-hero-layout";

// THE PAGE'S HEADLINE: revenue over time, drawn on the page itself.
//
// Every other chart here is a card: a white panel with a hairline border.
// This one is not, because revenue is the number a seller opens the page for
// and it should not look like one card among twelve. ITS CONTAINER IS FOUR
// CORNER MARKS: no box and no fill, only an ink bracket at each corner, like a
// viewfinder. Square and sharp like the logo, and it frames the graph without
// enclosing it. Inside the frame the line runs from one side to the other and
// blurs away at both ends. The component fills whatever width it is given.
//
// The figure is laid over the plot, in the top corner the line leaves free:
// top left when the graph is going up, top right when it is going down
// (revenue-hero-layout.ts). Three things keep that readable:
//
//   - The value axis is raised just enough that the line never runs under the
//     figure, and no further, so the peak still climbs past it.
//   - A soft page-coloured blur sits behind the figure, so the gridlines melt
//     away under it instead of striking through it.
//   - The value labels run down the OTHER edge, inside the plot, each on its
//     own gridline, so the chart keeps its scale without an axis column.
//
// It is also the Revenue tile: it publishes `sales.revenue` exactly as the
// tile did (docs/analytics-datapoints.md), and the "trend" panel around it.
//
// VERSUS THE PREVIOUS PERIOD. When the period before the range sold anything,
// it is drawn under the line as a dashed grey reference, first day on first
// day, and the change is stated under the figure ("+12% vs previous period").
// When it sold nothing there is no comparison: a store that did not exist yet
// is not a store that earned zero.
//
// A RANGE WITH NO SALES is the same chart lying flat: its dates along the
// bottom, a grey line on zero, and words where the figure would be. Never a
// "0.00" in the headline, and never a blank box that reads as a failed load.

/** How far the blur behind the figure reaches past it before it starts to
 *  thin out, in px. */
const CLEARANCE = 24;

/** The blur's soft edge: how far it takes to thin out to nothing, in px (the
 *  radius of `blur-xl`). The line is kept out from under this too, so no part
 *  of the graph is ever veiled. A single marked point is the whole chart, and
 *  a half-faded one reads as a rendering fault. */
const BLUR_EDGE = 24;

/** How much of the frame's edge the value labels take, in px: the kit's
 *  inset plus the widest label it prints ("€1.5M"). */
const LABEL_COLUMN = 88;

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

/** Where the figure sits over the chart, in px from the hero's own box, and
 *  that box's size. */
type HeadlineBox = { start: number; end: number; bottom: number; width: number; height: number };

/**
 * The box of the blur behind the figure: the figure's footprint, doubled
 * upward and towards the edge of the screen. Its layer clips that half away,
 * which leaves the blur soft on the two sides that face the chart and solid
 * on the two that face nothing, where a soft edge would only spill onto the
 * section heading above.
 */
function blurBox(side: HeroSide, box: HeadlineBox): CSSProperties {
  const reach = side === "left" ? box.end : box.width - box.start;
  return {
    top: -box.bottom,
    height: box.bottom * 2,
    left: side === "left" ? -reach : box.start,
    width: reach * 2,
  };
}

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
        height: Math.round(outer.height),
      };
      setBox((current) =>
        current &&
        current.start === next.start &&
        current.end === next.end &&
        current.bottom === next.bottom &&
        current.width === next.width &&
        current.height === next.height
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

/** The four ink brackets that are the hero's container, one per corner.
 *  Decoration only: nothing reads them and nothing is clicked on them. */
const CORNERS = [
  "left-0 top-0 border-l-2 border-t-2",
  "right-0 top-0 border-r-2 border-t-2",
  "bottom-0 left-0 border-b-2 border-l-2",
  "bottom-0 right-0 border-b-2 border-r-2",
] as const;

/** Which way the figure moved. Green only for up: on this page red means
 *  money refunded (palette.ts), and a slower month is not that. */
function ChangeIcon({ ratio, className }: { ratio: number; className?: string }) {
  const Icon = ratio > 0 ? TrendingUp : ratio < 0 ? TrendingDown : Minus;
  return <Icon className={className} strokeWidth={2} aria-hidden="true" />;
}

export function RevenueHero({
  series: salesSeries,
  range,
  revenueCents,
  netRevenueCents,
  currency,
  empty,
  previous,
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
  /** The period before the range: its revenue and its series, bucketed the
   *  same way. Absent or empty means there is nothing to compare against. */
  previous?: { revenueCents: number; series: RevenuePoint[] } | null;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const frameRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);

  const series = empty ? flatSeries(range) : salesSeries;
  const before = empty
    ? null
    : alignPrevious(series.length, previous?.series.map((point) => point.revenueCents) ?? []);
  const change = before && previous ? changeRatio(revenueCents, previous.revenueCents) : null;
  const data = series.map((point, index) => ({ ...point, previousCents: before?.[index] ?? null }));
  // The figure has to clear whichever line is higher, so both count.
  const values = series.map((point, index) => Math.max(point.revenueCents, before?.[index] ?? 0));
  const side = empty ? "left" : heroSide(values);
  const box = useHeadlineBox(frameRef, headlineRef, side);

  // The chart's height is CSS's to decide (it follows the screen), so the
  // plot is measured along with the figure, never assumed.
  const plot = box ? bleedPlot(box.height) : null;
  // The data does not span the whole box: it stops a tail's width short of
  // each end (the chart kit's bleed), and the tails run on level from the
  // first and last values. So the figure's reach is measured along the DATA,
  // and anything of it over a tail counts as over that end's value.
  const tail = box ? bleedFade(box.width) : 0;
  const along = (x: number) =>
    box ? Math.min(1, Math.max(0, (x - tail) / Math.max(1, box.width - tail * 2))) : 0;
  const footprint: HeroFootprint =
    box && plot && plot.height > 0
      ? {
          from: along(box.start - BLUR_EDGE),
          to: along(box.end + BLUR_EDGE),
          depth: (box.bottom + BLUR_EDGE - plot.top) / plot.height,
        }
      : assumedFootprint(side);
  const ceiling = heroCeiling(values, footprint);
  // On a narrow screen a long figure reaches right across to the edge the
  // value labels run down. A label that high would sit under the figure, so
  // those are left out; their gridlines are behind the figure's blur anyway.
  const reachesLabels =
    box !== null &&
    (side === "left"
      ? box.end + BLUR_EDGE > box.width - LABEL_COLUMN
      : box.start - BLUR_EDGE < LABEL_COLUMN);
  const highestLabel = reachesLabels ? ceiling * (1 - footprint.depth) : Infinity;
  const ticks = niceTicks(ceiling, CENTS_PER_UNIT).filter((tick) => tick <= highestLabel);

  const monthly = isMonthlySeries(series.map((point) => point.date));
  const title = t("sales.revenue.title");
  const figure = formatCents(revenueCents, currency, locale);

  return (
    <div className={heroFrameClass}>
      {CORNERS.map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          data-revenue-corner=""
          className={cn("pointer-events-none absolute size-5 border-foreground", corner)}
        />
      ))}
    {/* The chart's own box, between the marks. Everything laid over the chart
        (the figure, the blur behind it) is measured against THIS, not against
        the frame, whose padding is not part of the plot. */}
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
        <div className={heroChartHeightClass}>
          <LineChart
            data={data}
            xKey="date"
            series={[
              {
                key: "revenueCents",
                label: t("sales.revenue.series"),
                // Green is money earned. A range that earned none is not green.
                colorIndex: empty ? TONE.faint : TONE.money,
              },
              ...(before
                ? [
                    {
                      key: "previousCents",
                      label: t("compare.previous"),
                      colorIndex: TONE.quiet,
                      reference: true,
                    },
                  ]
                : []),
            ]}
            // The line under the figure says what the dashed line is.
            legend={false}
            variant="area"
            bleed
            valueSide={side === "left" ? "right" : "left"}
            yDomain={[0, ceiling > 0 ? ceiling : FLAT_CEILING]}
            yTicks={ceiling > 0 ? ticks : [0]}
            height="fill"
            valueFormatter={moneyExact(currency, locale)}
            axisValueFormatter={moneyCompact(currency, locale)}
            xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
            ariaLabel={t("sales.revenue.ariaLabel")}
          />
        </div>
      )}

      {/* The blur behind the figure: a page-coloured patch, blurred until it
          has no edge, so whatever runs behind the figure (the gridlines) melts
          out under it. In a layer of its own so it can be clipped to the hero
          without clipping the "?" tip's focus ring along with it. */}
      {!empty && box && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-clip">
          <div className="absolute bg-background blur-xl" style={blurBox(side, box)} />
        </div>
      )}

      {/* Stood in from the frame by the page's own gutter (the chart kit's
          labels keep the same distance). Pointer events pass through to the
          chart: only the "?" takes them back. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex px-6",
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
              {/* FitText shrinks a figure too long for the frame (nine digits
                  on a small phone) instead of letting it run off the edge.
                  Inside it, the settled figure holds the box's width while the
                  visible one counts up over it. Otherwise the box would grow on
                  every frame, and the chart would re-fit itself around it each
                  time. */}
              <p className="mt-1 text-4xl font-bold tabular-nums text-success sm:text-5xl">
                <FitText measure={figure}>
                  <span className="relative inline-block">
                    <CountUp value={figure} className="absolute inset-0" />
                    <span aria-hidden="true" className="invisible">
                      {figure}
                    </span>
                  </span>
                </FitText>
              </p>
              {change !== null && (
                <p
                  className={cn(
                    infoTextClass,
                    "mt-1 flex items-center gap-1",
                    side === "right" && "justify-end",
                  )}
                  data-analytics-change={change}
                >
                  <ChangeIcon
                    ratio={change}
                    className={cn("size-3.5 shrink-0", change > 0 && "text-success")}
                  />
                  {t("compare.vsPrevious", { change: formatChange(change, locale) })}
                </p>
              )}
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
    </div>
  );
}
