"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenuePoint } from "@/lib/analytics/types";
import { formatCents, toCurrency } from "@/lib/format/money";
import {
  CHART,
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/analytics/chart-theme";

// Average-order-value-over-time line chart (paid orders). Presentational
// only: the parent fetches via getAnalytics and guarantees a non-empty
// series. Zero-sale buckets carry aovCents 0 and are rendered as gaps
// (connectNulls) rather than misleading dips to zero.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Consecutive buckets ≥ this far apart means the series is month-grained. */
const MONTH_GAP_DAYS = 28;

/** Deterministic short label for an ISO "YYYY-MM-DD" bucket — no locale. */
function formatBucket(date: string, monthly: boolean): string {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return monthly ? `${name} ${year}` : `${name} ${Number(day)}`;
}

/** UTC ms for an ISO "YYYY-MM-DD" day start. */
function dayStartUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Month-grained series? Detected from the gap between the first two points. */
function isMonthly(series: RevenuePoint[]): boolean {
  if (series.length < 2) return false;
  const gap = dayStartUtc(series[1].date) - dayStartUtc(series[0].date);
  return gap >= MONTH_GAP_DAYS * DAY_MS;
}

/** Compact axis label from integer cents, e.g. "€12" / "€1.2k". Display-only
 *  rounding — exact values render in the tooltip via formatCents. */
function compactMoney(cents: number, currency: string): string {
  const symbol = toCurrency(currency) === "USD" ? "$" : "€";
  const units = Math.round(cents / 100);
  if (Math.abs(units) < 1000) return `${symbol}${units}`;
  const thousands = Math.round(units / 100) / 10;
  return `${symbol}${thousands}k`;
}

/** The chart's row shape: aov nulled on zero-sale buckets to break the line. */
type AovPoint = { date: string; aov: number | null; sales: number };

// Structural subset of recharts' tooltip content props — typing only what the
// tooltip reads keeps it compatible with the wide ValueType/NameType generics.
type AovTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
  monthly: boolean;
};

function AovTooltip({ active, payload, currency, monthly }: AovTooltipProps) {
  const point = payload?.[0]?.payload as AovPoint | undefined;
  if (!active || !point || point.aov == null) return null;
  return (
    <div className={tooltipWrapperClass}>
      <p className={tooltipLabelClass}>{formatBucket(point.date, monthly)}</p>
      <p className={tooltipValueClass}>{formatCents(point.aov, currency)}</p>
      <p className={tooltipLabelClass}>
        avg of {point.sales} {point.sales === 1 ? "sale" : "sales"}
      </p>
    </div>
  );
}

export function AovTrendChart({
  series,
  currency,
}: {
  series: RevenuePoint[];
  currency: string;
}) {
  const monthly = isMonthly(series);
  const points: AovPoint[] = series.map((point) => ({
    date: point.date,
    aov: point.sales > 0 ? point.aovCents : null,
    sales: point.sales,
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke={CHART.gridStroke}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={CHART.axisTick}
            tickMargin={8}
            minTickGap={32}
            interval="preserveStartEnd"
            tickFormatter={(date: string) => formatBucket(date, monthly)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART.axisTick}
            tickMargin={8}
            width={56}
            tickFormatter={(cents: number) => compactMoney(cents, currency)}
          />
          <Tooltip
            cursor={{ stroke: CHART.gridStroke }}
            content={({ active, payload }) => (
              <AovTooltip
                active={active}
                payload={payload}
                currency={currency}
                monthly={monthly}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="aov"
            stroke={CHART.series1}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
