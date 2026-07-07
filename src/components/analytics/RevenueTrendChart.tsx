"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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

// Revenue-over-time area chart (paid orders). Presentational only: the parent
// fetches via getAnalytics and guarantees a non-empty series. One accent
// series, hairline grid, no axis lines — quiet chrome, the data is the ink.

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

/** Compact axis label from integer cents, e.g. "€120" / "€1.2k". Display-only
 *  rounding — exact values render in the tooltip via formatCents. */
function compactMoney(cents: number, currency: string): string {
  const symbol = toCurrency(currency) === "USD" ? "$" : "€";
  const units = Math.round(cents / 100);
  if (Math.abs(units) < 1000) return `${symbol}${units}`;
  const thousands = Math.round(units / 100) / 10;
  return `${symbol}${thousands}k`;
}

// Structural subset of recharts' tooltip content props — typing only what the
// tooltip reads keeps it compatible with the wide ValueType/NameType generics.
type TrendTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
  monthly: boolean;
};

function TrendTooltip({ active, payload, currency, monthly }: TrendTooltipProps) {
  const point = payload?.[0]?.payload as RevenuePoint | undefined;
  if (!active || !point) return null;
  return (
    <div className={tooltipWrapperClass}>
      <p className={tooltipLabelClass}>{formatBucket(point.date, monthly)}</p>
      <p className={tooltipValueClass}>{formatCents(point.revenueCents, currency)}</p>
      <p className={tooltipLabelClass}>
        {point.sales} {point.sales === 1 ? "sale" : "sales"}
      </p>
    </div>
  );
}

export function RevenueTrendChart({
  series,
  currency,
}: {
  series: RevenuePoint[];
  currency: string;
}) {
  const monthly = isMonthly(series);
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="analytics-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.seriesPrimary} stopOpacity={0.12} />
              <stop offset="100%" stopColor={CHART.seriesPrimary} stopOpacity={0} />
            </linearGradient>
          </defs>
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
              <TrendTooltip
                active={active}
                payload={payload}
                currency={currency}
                monthly={monthly}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="revenueCents"
            stroke={CHART.seriesPrimary}
            strokeWidth={2}
            fill="url(#analytics-revenue-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
