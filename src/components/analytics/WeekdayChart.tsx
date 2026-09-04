"use client";

import { BarChart } from "@/components/charts";
import type { WeekdaySlice } from "@/lib/analytics/types";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { countWithNoun } from "@/components/analytics/chart-format";
import { TONE } from "@/components/analytics/palette";

// Sales by weekday, on the shared chart kit (/dev/charts).
//
// COUNT, not revenue: the question this answers is "when do people buy", and
// one large order on a Tuesday would otherwise make Tuesday look like the busy
// day. Revenue by time is already the chart above this one.
//
// Presentational only: the parent always passes all seven days, zeros
// included, Mon first.

export function WeekdayChart({ weekdays }: { weekdays: WeekdaySlice[] }) {
  return (
    <BarChart
      data={weekdays}
      xKey="weekday"
      series={[{ key: "sales", label: "Sales", colorIndex: TONE.money }]}
      height={CHART_HEIGHT}
      valueFormatter={countWithNoun("sale", "sales")}
      ariaLabel="Sales by weekday"
    />
  );
}
