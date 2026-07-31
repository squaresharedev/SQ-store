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

// Horizontal bars — magnitude across categories whose names deserve room
// (products, countries, referrers). This is the "many bars next to each
// other" horizontal subtype; the single divided total-bar lives in
// CompositionBar. Subtypes via `variant`:
//   "grouped" — one bar per series within each category row.
//   "stacked" — series stacked along one row; 2px surface gaps between
//               segments, only the outer data-end rounded.
// Height defaults to the row count (rows stay a readable thickness instead of
// stretching to fill an arbitrary box), and always includes the axis band.

export interface HBarChartProps {
  data: ChartDatum[];
  /** Key into each datum holding the category label (rendered on the y axis). */
  xKey: string;
  series: ChartSeries[];
  variant?: "grouped" | "stacked";
  /** Plot height in px. Default derives from the row count. */
  height?: number;
  /** Fixed pixel width — bypasses responsive measuring (tests). */
  width?: number;
  maxBarSize?: number;
  valueFormatter?: (value: number) => string;
  axisValueFormatter?: (value: number) => string;
  /** Formats category labels (y-axis ticks, tooltip heading, table rows). */
  categoryFormatter?: (value: string) => string;
  /** Width reserved for category labels on the y axis. */
  categoryWidth?: number;
  animate?: boolean;
  ariaLabel?: string;
  className?: string;
}

/** Per-row band: grouped rows grow with the series count so bars keep air. */
function defaultHeight(rows: number, seriesCount: number, grouped: boolean): number {
  const band = grouped ? 16 + seriesCount * (MARK.maxBarSize + 2) : 40;
  const axisBand = 28; // x-axis ticks stay inside the box (no nested scroll)
  return Math.max(Math.max(rows, 1) * band, 96) + axisBand;
}

export function HBarChart({
  data,
  xKey,
  series,
  variant = "grouped",
  height,
  width,
  maxBarSize = MARK.maxBarSize,
  valueFormatter = formatNumber,
  axisValueFormatter = compactNumber,
  categoryFormatter,
  categoryWidth = 96,
  animate = true,
  ariaLabel = "Horizontal bar chart",
  className,
}: HBarChartProps) {
  const resolved = resolveSeries(series);
  const { highlighted, setHighlighted } = useSeriesHighlight();
  const reducedMotion = useReducedMotion();
  const animationActive = animate && !reducedMotion;
  const stacked = variant === "stacked";
  const r = MARK.barRadius;
  const plotHeight =
    height ?? defaultHeight(data.length, resolved.length, !stacked && resolved.length > 1);

  const colorFor = (key: string) =>
    resolved.find((s) => s.key === key)?.resolvedColor;

  // Standalone charts (fixed `width`) need explicit dimensions; inside
  // ResponsiveContainer the container injects them.
  const renderChart = (dims?: { width: number; height: number }) => (
    <RBarChart
      data={data}
      layout="vertical"
      margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
      barGap={MARK.surfaceGap}
      {...dims}
    >
      <CartesianGrid horizontal={false} stroke={CHART.gridStroke} />
      <XAxis
        type="number"
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
        tickFormatter={axisValueFormatter}
      />
      <YAxis
        type="category"
        dataKey={xKey}
        axisLine={false}
        tickLine={false}
        tick={CHART.axisTick}
        tickMargin={8}
        width={categoryWidth}
        tickFormatter={categoryFormatter}
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
            labelFormatter={categoryFormatter}
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
            className={cn(
              dimmableClass,
              highlighted !== null && highlighted !== s.key && dimmedClass,
            )}
            activeBar={{ fillOpacity: 0.85 }}
            stackId={stacked ? "stack" : undefined}
            maxBarSize={maxBarSize}
            // Data-end (the right cap) rounded, baseline square.
            radius={!stacked || last ? ([0, r, r, 0] as const) : ([0, 0, 0, 0] as const)}
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
      <div style={{ height: plotHeight, width }} className={width ? undefined : "w-full"}>
        {width ? (
          renderChart({ width, height: plotHeight })
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
        xFormatter={categoryFormatter}
        valueFormatter={valueFormatter}
      />
    </div>
  );
}
