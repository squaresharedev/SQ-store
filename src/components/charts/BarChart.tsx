"use client";

import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
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
  TOOLTIP_GLIDE,
  dimmableClass,
  dimmedClass,
} from "@/components/charts/theme";
import { compactNumber, formatNumber } from "@/components/charts/format";
import { resolveSeries, useReducedMotion, useSeriesHighlight } from "@/components/charts/internal";
import { ChartTooltipContent } from "@/components/charts/ChartTooltip";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import type { ChartDatum, ChartSeries } from "@/components/charts/types";

// Vertical columns — compare magnitude across categories. Subtypes via
// `variant`:
//   "grouped" — series side by side within each category (2px air between).
//   "stacked" — series stacked on one baseline; segments separated by a 2px
//               surface gap, only the top segment's data-end is rounded.
// Bars stay thin (≤24px) and grow from a square baseline; a legend appears
// automatically at ≥2 series.

export interface BarChartProps {
  data: ChartDatum[];
  /** Key into each datum holding the category label. */
  xKey: string;
  series: ChartSeries[];
  variant?: "grouped" | "stacked";
  height?: number;
  /** Fixed pixel width — bypasses responsive measuring (tests). */
  width?: number;
  maxBarSize?: number;
  valueFormatter?: (value: number) => string;
  axisValueFormatter?: (value: number) => string;
  xFormatter?: (value: string) => string;
  yAxisWidth?: number;
  animate?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function BarChart({
  data,
  xKey,
  series,
  variant = "grouped",
  height = 256,
  width,
  maxBarSize = MARK.maxBarSize,
  valueFormatter = formatNumber,
  axisValueFormatter = compactNumber,
  xFormatter,
  yAxisWidth = 44,
  animate = true,
  ariaLabel = "Bar chart",
  className,
}: BarChartProps) {
  const resolved = resolveSeries(series);
  const { highlighted, setHighlighted } = useSeriesHighlight();
  const reducedMotion = useReducedMotion();
  const animationActive = animate && !reducedMotion;
  const stacked = variant === "stacked";
  const r = MARK.barRadius;

  const colorFor = (key: string) =>
    resolved.find((s) => s.key === key)?.resolvedColor;

  // Standalone charts (fixed `width`) need explicit dimensions; inside
  // ResponsiveContainer the container injects them.
  const renderChart = (dims?: { width: number; height: number }) => (
    <RBarChart
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      barGap={MARK.surfaceGap}
      {...dims}
    >
      <CartesianGrid vertical={false} stroke={CHART.gridStroke} />
      <XAxis
        dataKey={xKey}
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
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
        cursor={{ fill: "var(--muted)" }}
        isAnimationActive={!reducedMotion}
        animationDuration={TOOLTIP_GLIDE.duration}
        animationEasing={TOOLTIP_GLIDE.easing}
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
      {resolved.map((s, i) => {
        const last = i === resolved.length - 1;
        return (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.resolvedColor}
            // Legend hover dims sibling series via CSS opacity (smooth,
            // interruptible); hovering the plot lightens the active bar.
            className={cn(
              dimmableClass,
              highlighted !== null && highlighted !== s.key && dimmedClass,
            )}
            activeBar={{ fillOpacity: 0.85 }}
            stackId={stacked ? "stack" : undefined}
            maxBarSize={maxBarSize}
            // Rounded data-end, square baseline. In a stack only the top
            // segment carries the rounding; interior edges get a 2px surface
            // gap from the stroke (white does the separating, never a border).
            radius={!stacked || last ? ([r, r, 0, 0] as const) : ([0, 0, 0, 0] as const)}
            stroke={stacked ? CHART.surface : undefined}
            strokeWidth={stacked ? MARK.surfaceGap : undefined}
            isAnimationActive={animationActive}
            animationDuration={CHART_ANIMATION.duration}
            animationEasing={CHART_ANIMATION.easing}
          />
        );
      })}
    </RBarChart>
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
