"use client";

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
} from "recharts";
import { cn } from "@/lib/utils";
import {
  CHART,
  CHART_ANIMATION,
  MARK,
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
  valueFormatter = formatNumber,
  axisValueFormatter = compactNumber,
  xFormatter,
  yAxisWidth = 44,
  animate = true,
  ariaLabel = "Line chart",
  className,
}: LineChartProps) {
  const resolved = resolveSeries(series);
  const { highlighted, setHighlighted } = useSeriesHighlight();
  const reducedMotion = useReducedMotion();
  const animationActive = animate && !reducedMotion;
  const gradientId = useId().replace(/:/g, "");

  const colorFor = (key: string) =>
    resolved.find((s) => s.key === key)?.resolvedColor;

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={CHART.gridStroke} />
      <XAxis
        dataKey={xKey}
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
        minTickGap={32}
        interval="preserveStartEnd"
        tickFormatter={xFormatter}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
        width={yAxisWidth}
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
    activeDot: { r: 4.5, fill: s.resolvedColor, stroke: CHART.surface, strokeWidth: 2 },
    isAnimationActive: animationActive,
    animationDuration: CHART_ANIMATION.duration,
    animationEasing: CHART_ANIMATION.easing,
  });

  const margin = { top: 8, right: 8, bottom: 0, left: 0 };
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
              <stop offset="0%" stopColor={s.resolvedColor} stopOpacity={0.12} />
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
