"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type XAxisTickContentProps,
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
// runs the full width of its box, and the value labels move inside it.

export interface LineChartProps {
  data: ChartDatum[];
  /** Key into each datum holding the x value (category / date bucket). */
  xKey: string;
  series: ChartSeries[];
  variant?: "line" | "area";
  /** Interpolation: monotone (smooth, default), linear, or step. */
  curve?: "monotone" | "linear" | "step";
  /** Plot height in px (the wrapper also hosts the legend below it). */
  height?: number;
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
  yAxisWidth?: number;
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
  height = 256,
  width,
  showDots = false,
  connectNulls = false,
  valueFormatter: valueFormatterProp,
  axisValueFormatter: axisValueFormatterProp,
  xFormatter,
  yAxisWidth = 44,
  bleed = false,
  valueSide = "left",
  yDomain,
  yTicks,
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
  const { highlighted, setHighlighted } = useSeriesHighlight();
  const reducedMotion = useReducedMotion();
  const animationActive = animate && !reducedMotion;
  const gradientId = useId().replace(/:/g, "");

  const colorFor = (key: string) =>
    resolved.find((s) => s.key === key)?.resolvedColor;

  // A bled plot's first and last points sit ON the box's edges, where a
  // centred label would be cut in half, so those two are anchored inward.
  // From the point's own position (payload.coordinate): `tick.x` is where
  // Recharts has already slid an end label to keep it inside the box, and
  // starting from that would move it twice.
  const edgeTick = (tick: XAxisTickContentProps) => {
    const first = tick.index === 0;
    const last = !first && tick.index === tick.visibleTicksCount - 1;
    const label = String(tick.payload.value);
    const point = tick.payload.coordinate;
    return (
      <text
        x={first ? point + BLEED.inset : last ? point - BLEED.inset : point}
        y={tick.y}
        dy="0.71em"
        textAnchor={first ? "start" : last ? "end" : "middle"}
        {...CHART.axisTick}
      >
        {xFormatter ? xFormatter(label) : label}
      </text>
    );
  };

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
      <CartesianGrid vertical={false} stroke={CHART.gridStroke} syncWithTicks={bleed} />
      <XAxis
        dataKey={xKey}
        axisLine={false}
        tickLine={false}
        tick={bleed ? edgeTick : CHART.axisTick}
        tickMargin={8}
        minTickGap={bleed ? 32 + BLEED.tickGap : 32}
        height={PLOT.xAxisHeight}
        interval="preserveStartEnd"
        tickFormatter={xFormatter}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={bleed ? valueTick : CHART.axisTick}
        tickMargin={bleed ? BLEED.inset : 8}
        tickSize={bleed ? 0 : undefined}
        width={yAxisWidth}
        mirror={bleed}
        orientation={bleed ? valueSide : "left"}
        domain={yDomain}
        ticks={yTicks}
        tickFormatter={axisValueFormatter}
      />
      <Tooltip
        cursor={{ stroke: CHART.gridStroke }}
        isAnimationActive={TOOLTIP.animated}
        wrapperStyle={TOOLTIP.wrapperStyle}
        content={({ active, payload, label }) => (
          <ChartTooltipContent
            active={active}
            payload={payload}
            label={label}
            valueFormatter={valueFormatter}
            labelFormatter={xFormatter}
            colorFor={colorFor}
          />
        )}
      />
    </>
  );

  const markProps = (s: (typeof resolved)[number]) => ({
    type: curve,
    dataKey: s.key,
    name: s.label,
    stroke: s.resolvedColor,
    strokeWidth: MARK.lineWidth,
    // Legend hover dims siblings via CSS opacity on the series layer — an
    // interruptible 180ms fade rather than an instant attribute swap.
    className: cn(dimmableClass, highlighted !== null && highlighted !== s.key && dimmedClass),
    connectNulls,
    // Persistent dots ≥8px with a surface ring so they stay legible where
    // they cross a line; the hover dot is a touch larger.
    dot: showDots
      ? { r: 4, fill: s.resolvedColor, stroke: CHART.surface, strokeWidth: 2 }
      : false,
    activeDot: {
      r: 4.5,
      fill: s.resolvedColor,
      stroke: bleed ? CHART.page : CHART.surface,
      strokeWidth: 2,
    },
    isAnimationActive: animationActive,
    animationDuration: CHART_ANIMATION.duration,
    animationEasing: CHART_ANIMATION.easing,
  });

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
          {resolved.map((s, i) => (
            <linearGradient
              key={s.key}
              id={`${gradientId}-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.resolvedColor} stopOpacity={areaWash} />
              <stop offset="100%" stopColor={s.resolvedColor} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {axes}
        {resolved.map((s, i) => (
          <Area key={s.key} {...markProps(s)} fill={`url(#${gradientId}-${i})`} />
        ))}
      </AreaChart>
    ) : (
      <RLineChart data={data} margin={margin} {...dims}>
        {axes}
        {resolved.map((s) => (
          <Line key={s.key} {...markProps(s)} />
        ))}
      </RLineChart>
    );

  return (
    <div className={cn("w-full", className)} role="group" aria-label={ariaLabel}>
      <div style={{ height, width }} className={width ? undefined : "w-full"}>
        {width ? (
          renderChart({ width, height })
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend series={resolved} onHighlight={setHighlighted} />
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
