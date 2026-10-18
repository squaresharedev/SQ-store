"use client";

import { useTranslations, useLocale } from "next-intl";
import { BarChart, CHART, formatNumber } from "@/components/charts";
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
// EACH BAR IS A STACK OF PRODUCTS. "Saturday is my best day" has a second
// half, best day for what, so a day's sales are split by product: the range's
// best sellers each get a segment, in the same order and tone on every day
// (best seller on the baseline, in ink), and everything else is one grey
// "Other" segment on top. The stack is exactly as tall as the plain bar was.
//
// The split is a separate read and may not be there (see
// lib/analytics/weekday-products.ts). Without it this draws the plain bars.
//
// Presentational only: the parent always passes all seven days, zeros
// included, Mon first.

/** Product titles are user content and a legend row is finite. */
const MAX_LABEL = 28;

/** The data key of the segment for everything outside the named products. */
const OTHER = "other";

export function WeekdayChart({
  weekdays,
  products = [],
}: {
  weekdays: WeekdaySlice[];
  /** The products the bars name, best seller first. Empty: plain bars. */
  products?: string[];
}) {
  const t = useTranslations("Analytics.sales.weekday");
  const tSales = useTranslations("Analytics.sales");
  const tCharts = useTranslations("Common.charts");
  const locale = useLocale();
  const shared = {
    xKey: "weekday",
    xFormatter: (weekday: string) => formatWeekdayLabel(weekday, locale),
    height: CHART_HEIGHT,
    whole: true,
    valueFormatter: (value: number) =>
      t("count", { count: value, formatted: formatNumber(value, locale) }),
    ariaLabel: t("ariaLabel"),
  };

  if (products.length === 0) {
    return (
      <BarChart
        {...shared}
        data={weekdays.map((slice) => ({ weekday: slice.weekday, sales: slice.sales }))}
        series={[{ key: "sales", label: t("series"), colorIndex: TONE.money }]}
      />
    );
  }

  // One key per named product, by rank, so a product keeps its segment and
  // its tone on every day whether or not it sold on that one.
  const keyOf = (title: string | null) => (title === null ? OTHER : `product${products.indexOf(title)}`);
  const data = weekdays.map((slice) => ({
    weekday: slice.weekday,
    ...Object.fromEntries(products.map((title) => [keyOf(title), 0])),
    [OTHER]: 0,
    ...Object.fromEntries(slice.products.map((part) => [keyOf(part.title), part.sales])),
  }));
  const hasOther = weekdays.some((slice) => slice.products.some((part) => part.title === null));

  return (
    <BarChart
      {...shared}
      data={data}
      variant="stacked"
      series={[
        ...products.map((title) => ({
          key: keyOf(title),
          // A product sold with no title still sold: it gets a name, not a
          // blank legend row.
          label:
            title.length > MAX_LABEL
              ? `${title.slice(0, MAX_LABEL - 1)}…`
              : title || tSales("untitledProduct"),
        })),
        // The kit's de-emphasis grey, not a fifth tone: "Other" is not a product.
        ...(hasOther ? [{ key: OTHER, label: tCharts("other"), color: CHART.other }] : []),
      ]}
    />
  );
}
