"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type YAxisTickContentProps,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  BLEED,
  CHART,
  CHART_ANIMATION,
  MARK,
  PLOT,
  TOOLTIP,
  bleedFade,
  dimmableClass,
  dimmedClass,
} from "@/components/charts/theme";
import { compactNumber, formatNumber } from "@/components/charts/format";
import { resolveSeries, useReducedMotion, useSeriesHighlight } from "@/components/charts/internal";
import { ChartTooltipContent } from "@/components/charts/ChartTooltip";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import type { ChartDatum, ChartSeries } from "@/components/charts/types";

// Trend over time. Subtypes via `variant`:
//   "line" — 2px strokes, hover crosshair, end-to-end comparison of series.
//   "area" — the line plus a soft gradient wash (~12% → 0) under each series;
//            use for a single series or gently overlapping few.
// One series wears the near-black ink; two or more take categorical slots.
// A legend appears automatically at ≥2 series, and an sr-only table twin keeps
// every value reachable without a pointer.
//
// `bleed` is the same chart drawn on the page instead of in a card: the plot
// runs the full width of its box, the value labels move inside it, and both
// ends blur away. The DATA stops short of the ends: what blurs is a level
// tail drawn on from the first and last values (see BLEED in theme.ts).
//
// VERSUS. A series marked `reference` is what the others are read against
// (the previous period): dashed, thin, no wash, drawn behind them.
//
// ONE VALUE. A line needs two points. A series with a single value gets its
// point marked and a dotted level through it instead of an empty plot, so one
// day of data still shows what that day was.

/** The plot height when none is given, and the one a fixed-width chart falls
 *  back to if it is asked to fill a parent it does not have. */
const DEFAULT_HEIGHT = 256;

export interface LineChartProps {
  data: ChartDatum[];
  /** Key into each datum holding the x value (category / date bucket). */
  xKey: string;
  series: ChartSeries[];
  variant?: "line" | "area";
  /** Interpolation: monotone (smooth, default), linear, or step. */
  curve?: "monotone" | "linear" | "step";
  /** Plot height in px (the wrapper also hosts the legend below it), or
   *  "fill" to take the height of the parent, which then has to have one:
   *  for a chart whose height is set in CSS and changes with the screen. */
  height?: number | "fill";
  /** Fixed pixel width — bypasses responsive measuring (tests, sparklines). */
  width?: number;
  /** Mark every data point (sparse series only — dots on dense data are noise). */
  showDots?: boolean;
  /** Bridge gaps where a series value is null. */
  connectNulls?: boolean;
  /** Exact-value formatter (tooltip + table). Defaults to thousands-commas. */
  valueFormatter?: (value: number) => string;
  /** Axis-tick formatter (compact tier). Defaults to 12.4k-style compaction. */
  axisValueFormatter?: (value: number) => string;
  /** Formats x values for ticks, tooltip heading and the table. */
  xFormatter?: (value: string) => string;
  /** The values are counts (sales, views): the value axis steps in whole
   *  numbers. Without it a week with one sale gets gridlines at 0.25, 0.5 and
   *  0.75 of a sale. */
  whole?: boolean;
  /**
   * Run the plot edge to edge of its box, for a chart that sits on the page
   * itself. No side margins and no axis column: value labels sit INSIDE the
   * plot, on their gridlines, and the first and last x labels are tucked
   * inward so the box's edges never clip them.
   */
  bleed?: boolean;
  /** Which edge the inside value labels run down (bleed only). */
  valueSide?: "left" | "right";
  /** Value-axis bounds in data units. Default: fitted to the data. */
  yDomain?: [number, number];
  /** Value-axis tick values, for a caller that set `yDomain` (see niceTicks). */
  yTicks?: number[];
  /** Show the legend under the plot (two or more series). Off for a caller
   *  that names its series somewhere of its own. */
  legend?: boolean;
  animate?: boolean;
  /** Accessible name for the chart region and its table twin. */
  ariaLabel?: string;
  className?: string;
}

export function LineChart({
  data,
  xKey,
  series,
  variant = "line",
  curve = "monotone",
  height = DEFAULT_HEIGHT,
  width,
  showDots = false,
  connectNulls = false,
  valueFormatter: valueFormatterProp,
  axisValueFormatter: axisValueFormatterProp,
  xFormatter,
  whole = false,
  bleed = false,
  valueSide = "left",
  yDomain,
  yTicks,
  legend = true,
  animate = true,
  ariaLabel: ariaLabelProp,
  className,
}: LineChartProps) {
  const t = useTranslations("Common.charts");
  const locale = useLocale();
  const valueFormatter =
    valueFormatterProp ?? ((value: number) => formatNumber(value, locale));
  const axisValueFormatter =
    axisValueFormatterProp ?? ((value: number) => compactNumber(value, locale));
  const ariaLabel = ariaLabelProp ?? t("line");
  const resolved = resolveSeries(series);
  // Reference series are DRAWN first, so everything measured sits over them.
  // The legend, the readout and the table keep the caller's order.
  const drawn = [...resolved].sort(
    (a, b) => Number(Boolean(b.reference)) - Number(Boolean(a.reference)),
  );
  const orderOf = (key: unknown) => resolved.findIndex((s) => s.key === String(key));
  // Series with exactly one value: no line can be drawn through one point.
  const lone = resolved.flatMap((s) => {
    const values = data.map((datum) => datum[s.key]).filter((v) => typeof v === "number");
    return values.length === 1 ? [{ series: s, value: values[0] as number }] : [];
  });
  const isLone = (key: string) => lone.some((entry) => entry.series.key === key);
  const { highlighted, setHighlighted } = useSeriesHighlight();
  const reducedMotion = useReducedMotion();
  const animationActive = animate && !reducedMotion;
  const gradientId = useId().replace(/:/g, "");
  const fill = height === "fill";

  // The chart's own size in px. A bled plot needs it: its tails are a number
  // of px wide, and they are drawn down to the plot's floor.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const size = width ? { width, height: fill ? DEFAULT_HEIGHT : height } : measured;
  const tail = bleed && size ? bleedFade(size.width) : 0;
  const floor = size ? size.height - PLOT.xAxisHeight : 0;

  // THE ENDS OF A BLED PLOT. Three masks, all running across the full width:
  //   fade   what lies in the tails thins out to nothing at the box's edges
  //          (the gridlines, which have no focus to lose);
  //   sharp  a tail's in-focus copy, gone by BLEED.blurBy of the way out;
  //   soft   its blurred copy, taking over as the sharp one goes, then
  //          thinning out to the edge.
  // So a tail leaves its data point sharp, goes out of focus, and is gone.
  // White and its opacity are a mask's own units (white shows, clear hides),
  // not colours anyone sees.
  const fadeId = `${gradientId}-fade`;
  const maskOf = (name: string) => (bleed ? `url(#${fadeId}-${name})` : undefined);
  const blurFilter = `url(#${fadeId}-blur)`;
  const edge = size && size.width > 0 ? tail / size.width : BLEED.fade;
  const turn = edge * (1 - BLEED.blurBy);
  const MASKS: Record<string, [offset: number, opacity: number][]> = {
    fade: [[0, 0], [edge, 1], [1 - edge, 1], [1, 0]],
    sharp: [[turn, 0], [edge, 1], [1 - edge, 1], [1 - turn, 0]],
    soft: [[0, 0], [turn, 1], [edge, 0], [1 - edge, 0], [1 - turn, 1], [1, 0]],
  };
  const fadeDefs = bleed && (
    <>
      {Object.entries(MASKS).map(([name, stops]) => (
        <linearGradient
          key={name}
          id={`${fadeId}-${name}-ramp`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="100%"
          y2="0"
        >
          {stops.map(([offset, opacity], i) => (
            <stop key={i} offset={offset} stopColor="white" stopOpacity={opacity} />
          ))}
        </linearGradient>
      ))}
      {Object.keys(MASKS).map((name) => (
        <mask
          key={name}
          id={`${fadeId}-${name}`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100%"
          height="100%"
        >
          <rect x="0" y="0" width="100%" height="100%" fill={`url(#${fadeId}-${name}-ramp)`} />
        </mask>
      ))}
      {/* Sized to the whole chart, not to what it blurs: a level line has a
          box with no height, and a filter sized to that draws nothing. */}
      <filter id={`${fadeId}-blur`} filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
        <feGaussianBlur stdDeviation={BLEED.blur} />
      </filter>
    </>
  );
  const fadeMask = maskOf("fade");

  const colorFor = (key: string) =>
    resolved.find((s) => s.key === key)?.resolvedColor;

  // A bled plot has no column for its value labels, so each sits on its own
  // gridline, haloed in the page colour so the line can pass behind it.
  const valueTick = (tick: YAxisTickContentProps) => (
    <text
      x={tick.x}
      y={tick.y}
      dy={-BLEED.labelLift}
      textAnchor={tick.textAnchor}
      {...CHART.axisTick}
      stroke={CHART.page}
      strokeWidth={BLEED.labelHalo}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {axisValueFormatter(Number(tick.payload.value))}
    </text>
  );

  const axes = (
    <>
      {/* A bled plot draws a line per value label and nothing else: the
          plot's own top edge would be a second line a hair from the top one. */}
      <CartesianGrid
        vertical={false}
        stroke={CHART.gridStroke}
        syncWithTicks={bleed}
        mask={fadeMask}
      />
      <XAxis
        dataKey={xKey}
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
        minTickGap={32}
        height={PLOT.xAxisHeight}
        // A bled plot keeps its data clear of both ends: the room is the
        // tails', and the first and last dates sit under real points.
        padding={bleed ? { left: tail, right: tail } : undefined}
        interval="preserveStartEnd"
        tickFormatter={xFormatter}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={bleed ? valueTick : CHART.axisTick}
        tickMargin={bleed ? BLEED.inset : 8}
        tickSize={bleed ? 0 : undefined}
        // As wide as its widest label, whatever that is: "800" in English is
        // "1,5 Mio. €" in German, and a fixed column cuts one of them off. A
        // bled plot has no column (its labels are inside, mirrored).
        width={bleed ? BLEED.axisBox : "auto"}
        mirror={bleed}
        orientation={bleed ? valueSide : "left"}
        domain={yDomain}
        ticks={yTicks}
        allowDecimals={!whole}
        tickFormatter={axisValueFormatter}
      />
      <Tooltip
        cursor={{ stroke: CHART.gridStroke }}
        isAnimationActive={TOOLTIP.animated}
        wrapperStyle={TOOLTIP.wrapperStyle}
        content={({ active, payload, label }) => (
          <ChartTooltipContent
            active={active}
            payload={
              payload && [...payload].sort((a, b) => orderOf(a.dataKey) - orderOf(b.dataKey))
            }
            label={label}
            valueFormatter={valueFormatter}
            labelFormatter={xFormatter}
            colorFor={colorFor}
          />
        )}
      />
    </>
  );

  // THE TAILS. Recharts hands every point of a series to its `dot` renderer
  // with the point's position, which is the only place that position is
  // known, so the tails are drawn from there: nothing for a point in the
  // middle, and for the first and last a level run out to the box's edge,
  // with the wash under it for an area. Twice over, sharp and blurred, each
  // under its own mask (see MASKS above).
  const tailsOf = (s: (typeof resolved)[number]) => {
    const numeric = data.flatMap((datum, index) => (typeof datum[s.key] === "number" ? [index] : []));
    const first = numeric[0];
    const last = numeric[numeric.length - 1];
    const wash = variant === "area" && !s.reference ? `url(#${gradientId}-${drawn.indexOf(s)})` : null;
    const TailDot = (point: { cx?: number; cy?: number; index?: number }) => {
      const { cx, cy, index } = point;
      if (!size || cx == null || cy == null || (index !== first && index !== last)) {
        return <g key={index} />;
      }
      const to = index === first ? 0 : size.width;
      const x = Math.min(cx, to);
      const run = Math.abs(to - cx);
      const drawing = (
        <>
          {/* Gives the group a box with a height, which a level line alone
              does not have, and without one a mask is not applied to it. */}
          <rect x={x} y={BLEED.top} width={run} height={Math.max(0, floor - BLEED.top)} fill="none" />
          {wash && (
            <rect
              x={x}
              y={cy}
              width={run}
              height={Math.max(0, floor - cy)}
              fill={wash}
              fillOpacity={MARK.areaFillOpacity}
            />
          )}
          <line
            x1={cx}
            y1={cy}
            x2={to}
            y2={cy}
            stroke={s.resolvedColor}
            strokeWidth={s.reference ? MARK.referenceWidth : MARK.lineWidth}
            strokeDasharray={s.reference ? MARK.referenceDash : undefined}
          />
        </>
      );
      return (
        <g key={index} data-chart-tail={index === first ? "start" : "end"} aria-hidden="true">
          <g mask={maskOf("sharp")}>{drawing}</g>
          <g mask={maskOf("soft")} filter={blurFilter}>
            {drawing}
          </g>
        </g>
      );
    };
    return TailDot;
  };

  const markProps = (s: (typeof resolved)[number]) => ({
    type: curve,
    dataKey: s.key,
    name: s.label,
    stroke: s.resolvedColor,
    strokeWidth: s.reference ? MARK.referenceWidth : MARK.lineWidth,
    strokeDasharray: s.reference ? MARK.referenceDash : undefined,
    // Legend hover dims siblings via CSS opacity on the series layer — an
    // interruptible 180ms fade rather than an instant attribute swap.
    className: cn(dimmableClass, highlighted !== null && highlighted !== s.key && dimmedClass),
    connectNulls,
    // Persistent dots ≥8px with a surface ring so they stay legible where
    // they cross a line; the hover dot is a touch larger.
    dot: isLone(s.key)
      ? {
          r: MARK.loneDotRadius,
          fill: s.resolvedColor,
          // An area hands its wash's opacity down to its dots; this one is
          // the whole chart, so it is drawn at full strength.
          fillOpacity: 1,
          stroke: bleed ? CHART.page : CHART.surface,
          strokeWidth: 2,
          // A dot's own outline must not inherit a reference series' dashes.
          strokeDasharray: "none",
        }
      : showDots
        ? { r: 4, fill: s.resolvedColor, stroke: CHART.surface, strokeWidth: 2 }
        : tail > 0
          ? tailsOf(s)
          : false,
    activeDot: {
      r: 4.5,
      fill: s.resolvedColor,
      stroke: bleed ? CHART.page : CHART.surface,
      strokeWidth: 2,
      strokeDasharray: "none",
    },
    isAnimationActive: animationActive,
    animationDuration: CHART_ANIMATION.duration,
    animationEasing: CHART_ANIMATION.easing,
  });

  // The dotted level through each lone point, in its series' colour.
  const loneLevels = lone.map(({ series: s, value }) => (
    <ReferenceLine
      key={s.key}
      y={value}
      stroke={s.resolvedColor}
      strokeDasharray={MARK.loneLevelDash}
      strokeOpacity={MARK.loneLevelOpacity}
      mask={fadeMask}
    />
  ));

  const margin = bleed
    ? { top: BLEED.top, right: 0, bottom: 0, left: 0 }
    : { top: PLOT.top, right: PLOT.right, bottom: 0, left: 0 };
  const areaWash = bleed ? BLEED.areaWash : MARK.areaWash;
  // Standalone charts (fixed `width`) need explicit dimensions; inside
  // ResponsiveContainer the container injects them.
  const renderChart = (dims?: { width: number; height: number }) =>
    variant === "area" ? (
      <AreaChart data={data} margin={margin} {...dims}>
        <defs>
          {fadeDefs}
          {drawn.map((s, i) => (
            <linearGradient
              key={s.key}
              id={`${gradientId}-${i}`}
              x1="0"
              x2="0"
              // A bled plot's wash is measured against the PLOT, top to floor,
              // not against the area's own box, so the tails' washes (their
              // own, smaller boxes) meet the area's without a seam.
              {...(tail > 0
                ? { gradientUnits: "userSpaceOnUse", y1: BLEED.top, y2: floor }
                : { y1: "0", y2: "1" })}
            >
              <stop offset="0%" stopColor={s.resolvedColor} stopOpacity={areaWash} />
              <stop offset="100%" stopColor={s.resolvedColor} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {axes}
        {loneLevels}
        {drawn.map((s, i) => (
          <Area
            key={s.key}
            {...markProps(s)}
            fill={s.reference ? "none" : `url(#${gradientId}-${i})`}
            fillOpacity={MARK.areaFillOpacity}
          />
        ))}
      </AreaChart>
    ) : (
      <RLineChart data={data} margin={margin} {...dims}>
        {fadeDefs && <defs>{fadeDefs}</defs>}
        {axes}
        {loneLevels}
        {drawn.map((s) => (
          <Line key={s.key} {...markProps(s)} />
        ))}
      </RLineChart>
    );

  return (
    <div className={cn("w-full", fill && "h-full", className)} role="group" aria-label={ariaLabel}>
      <div style={{ height: fill ? "100%" : height, width }} className={width ? undefined : "w-full"}>
        {width ? (
          renderChart({ width, height: fill ? DEFAULT_HEIGHT : height })
        ) : (
          <ResponsiveContainer
            width="100%"
            height="100%"
            onResize={
              bleed
                ? (nextWidth, nextHeight) =>
                    setMeasured((current) =>
                      current && current.width === nextWidth && current.height === nextHeight
                        ? current
                        : { width: nextWidth, height: nextHeight },
                    )
                : undefined
            }
          >
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
      {legend && <ChartLegend series={resolved} onHighlight={setHighlighted} />}
      <ChartDataTable
        data={data}
        xKey={xKey}
        series={resolved}
        caption={ariaLabel}
        xFormatter={xFormatter}
        valueFormatter={valueFormatter}
      />
    </div>
  );
}
