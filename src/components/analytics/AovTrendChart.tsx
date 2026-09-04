"use client";

import { LineChart } from "@/components/charts";
import { formatBucketLabel, isMonthlySeries } from "@/lib/analytics/buckets";
import type { RevenuePoint } from "@/lib/analytics/types";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";

// Average order value over time, on the shared chart kit (/dev/charts).
//
// Buckets with NO sales are dropped rather than plotted as zero: an AOV of
// nothing is not an average of zero, it is the absence of one, and a line
// dragged to the axis on a quiet Sunday reads as a collapse in order value
// that never happened. `connectNulls` bridges the gap so the trend stays one
// readable line, and the sr-only table twin still lists every bucket.

export function AovTrendChart({
  series,
  currency,
}: {
  series: RevenuePoint[];
  currency: string;
}) {
  const monthly = isMonthlySeries(series.map((point) => point.date));
  const data = series.map((point) => ({
    date: point.date,
    aovCents: point.sales > 0 ? point.aovCents : null,
  }));

  return (
    <LineChart
      data={data}
      xKey="date"
      series={[{ key: "aovCents", label: "Average order", colorIndex: TONE.money }]}
      height={CHART_HEIGHT}
      connectNulls
      valueFormatter={moneyExact(currency)}
      axisValueFormatter={moneyCompact(currency)}
      xFormatter={(date) => formatBucketLabel(date, monthly)}
      yAxisWidth={56}
      ariaLabel="Average order value over time"
    />
  );
}
