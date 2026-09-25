"use client";

import { useTranslations, useLocale } from "next-intl";
import { BarChart, formatNumber } from "@/components/charts";
import { formatWeekdayLabel } from "@/lib/analytics/buckets";
import type { WeekdaySlice } from "@/lib/analytics/types";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
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
  const t = useTranslations("Analytics.sales.weekday");
  const locale = useLocale();
  return (
    <BarChart
      data={weekdays}
      xKey="weekday"
      xFormatter={(weekday) => formatWeekdayLabel(weekday, locale)}
      series={[{ key: "sales", label: t("series"), colorIndex: TONE.money }]}
      height={CHART_HEIGHT}
      valueFormatter={(value) => t("count", { count: value, formatted: formatNumber(value, locale) })}
      ariaLabel={t("ariaLabel")}
    />
  );
}
