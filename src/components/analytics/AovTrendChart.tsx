"use client";

import { useTranslations, useLocale } from "next-intl";
import { LineChart } from "@/components/charts";
import { formatBucketLabel, isMonthlySeries } from "@/lib/analytics/buckets";
import type { RevenuePoint } from "@/lib/analytics/types";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { alignPrevious } from "@/components/analytics/compare";
import { TONE } from "@/components/analytics/palette";

// Average order value over time, on the shared chart kit (/dev/charts).
//
// Buckets with NO sales are dropped rather than plotted as zero: an AOV of
// nothing is not an average of zero, it is the absence of one, and a line
// dragged to the axis on a quiet Sunday reads as a collapse in order value
// that never happened. `connectNulls` bridges the gap so the trend stays one
// readable line, and the sr-only table twin still lists every bucket.
//
// When the period before the range had sales, its average is drawn under this
// one as a dashed reference: "are orders getting bigger" is a question about
// two periods, and one line cannot answer it.

export function AovTrendChart({
  series,
  currency,
  previous,
}: {
  series: RevenuePoint[];
  currency: string;
  /** The same buckets for the period before the range, if it had sales. */
  previous?: RevenuePoint[];
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const monthly = isMonthlySeries(series.map((point) => point.date));
  const average = (point: RevenuePoint) => (point.sales > 0 ? point.aovCents : null);
  const before = alignPrevious(series.length, (previous ?? []).map(average));
  const data = series.map((point, index) => ({
    date: point.date,
    aovCents: average(point),
    previousCents: before?.[index] ?? null,
  }));

  return (
    <LineChart
      data={data}
      xKey="date"
      series={[
        { key: "aovCents", label: t("sales.aov.series"), colorIndex: TONE.money },
        ...(before
          ? [
              {
                key: "previousCents",
                label: t("compare.previous"),
                colorIndex: TONE.quiet,
                reference: true,
              },
            ]
          : []),
      ]}
      height={CHART_HEIGHT}
      connectNulls
      valueFormatter={moneyExact(currency, locale)}
      axisValueFormatter={moneyCompact(currency, locale)}
      xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
      ariaLabel={t("sales.aov.ariaLabel")}
    />
  );
}
