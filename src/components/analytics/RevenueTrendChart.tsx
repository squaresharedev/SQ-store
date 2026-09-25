"use client";

import { useTranslations, useLocale } from "next-intl";
import { LineChart } from "@/components/charts";
import { formatBucketLabel, isMonthlySeries } from "@/lib/analytics/buckets";
import type { RevenuePoint } from "@/lib/analytics/types";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";

// Revenue over time, on the shared chart kit (components/charts, specimens at
// /dev/charts) rather than a hand-rolled Recharts tree.
//
// What the kit brings that the hand-rolled version did not: a legend that syncs
// hover with the plot, a tooltip that lands at the pointer, an sr-only data
// table twin so every number is reachable without a mouse, and entrance
// animation that honours prefers-reduced-motion. Those were four separate
// things to reimplement per chart; now they are the default.
//
// Presentational only: the parent fetches via getAnalytics and guarantees a
// non-empty series.

export function RevenueTrendChart({
  series,
  currency,
}: {
  series: RevenuePoint[];
  currency: string;
}) {
  const t = useTranslations("Analytics.sales.revenue");
  const locale = useLocale();
  const monthly = isMonthlySeries(series.map((point) => point.date));
  return (
    <LineChart
      data={series}
      xKey="date"
      series={[{ key: "revenueCents", label: t("series"), colorIndex: TONE.money }]}
      variant="area"
      height={CHART_HEIGHT}
      valueFormatter={moneyExact(currency, locale)}
      axisValueFormatter={moneyCompact(currency, locale)}
      xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
      yAxisWidth={56}
      ariaLabel={t("ariaLabel")}
    />
  );
}
