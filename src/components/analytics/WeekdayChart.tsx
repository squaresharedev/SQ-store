"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeekdaySlice } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import {
  CHART,
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/analytics/chart-theme";

// Paid sales by day of week (Mon..Sun) — a rhythm read: which days the store
// actually sells. Presentational only: the parent fetches via getAnalytics
// and always passes all 7 weekdays, zeros included. Sharp rectangular bars
// (no radius) match the brand's square identity.

// Structural subset of recharts' tooltip content props — typing only what the
// tooltip reads keeps it compatible with the wide ValueType/NameType generics.
type WeekdayTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
};

function WeekdayTooltip({ active, payload, currency }: WeekdayTooltipProps) {
  const slice = payload?.[0]?.payload as WeekdaySlice | undefined;
  if (!active || !slice) return null;
  return (
    <div className={tooltipWrapperClass}>
      <p className={tooltipLabelClass}>{slice.weekday}</p>
      <p className={tooltipValueClass}>
        {slice.sales} {slice.sales === 1 ? "sale" : "sales"}
      </p>
      <p className={tooltipLabelClass}>
        {formatCents(slice.revenueCents, currency)}
      </p>
    </div>
  );
}

export function WeekdayChart({
  weekdays,
  currency,
}: {
  weekdays: WeekdaySlice[];
  currency: string;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weekdays} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke={CHART.gridStroke}
          />
          <XAxis
            dataKey="weekday"
            axisLine={false}
            tickLine={false}
            tick={CHART.axisTick}
            tickMargin={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART.axisTick}
            tickMargin={8}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload }) => (
              <WeekdayTooltip active={active} payload={payload} currency={currency} />
            )}
          />
          <Bar
            dataKey="sales"
            fill={CHART.series1}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
