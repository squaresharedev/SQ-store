import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/components/charts";
import type { MetricDatapoint } from "@/components/dashboard/MetricTile";
import type { AnalyticsTotals } from "@/lib/analytics/types";
import { formatFixed, formatPercent } from "@/lib/format/intl";
import { formatCents } from "@/lib/format/money";

/** One sales figure under the revenue headline, whichever way it is drawn. */
export type SalesTile = {
  key: "sales" | "avgOrder" | "uniqueBuyers" | "refundRate";
  label: string;
  /** The figure as it is read; null for the calm zero state. */
  value: string | null;
  hint?: string;
  zeroText: string;
  /** The raw figure, published for readers that are not people. */
  datapoint: MetricDatapoint;
};

/**
 * The sales tiles' facts, ONE list for both ways of drawing them (AnalyticsTiles
 * and SalesTrendTiles), so the two cannot disagree on a figure, its wording or
 * what it publishes.
 *
 * Money renders only via formatCents from integer cents; zero sales gives the
 * calm zero state instead of a fake "0.00". Every tile publishes its RAW figure
 * (integer cents for money, a plain count otherwise), so the numbers a person
 * reads and the numbers a machine reads are the same numbers. See
 * docs/analytics-datapoints.md.
 */
export function useSalesTiles(totals: AnalyticsTotals): SalesTile[] {
  const t = useTranslations("Analytics.tiles");
  const locale = useLocale();
  const hasSales = totals.sales > 0;
  // Refund rate over settled outcomes (paid + refunded): display-only math,
  // never money. "0.0%" with real orders is a true, earned zero.
  const settled = totals.sales + totals.refundedCount;
  const refundRate = settled > 0 ? (totals.refundedCount / settled) * 100 : null;
  // Sales velocity across the window the data actually covers.
  const salesPerDay = hasSales && totals.rangeDays > 0 ? totals.sales / totals.rangeDays : null;

  return [
    {
      key: "sales",
      label: t("sales"),
      value: hasSales ? formatNumber(totals.sales, locale) : null,
      hint: salesPerDay != null ? t("perDay", { rate: formatFixed(salesPerDay, 1, locale) }) : undefined,
      zeroText: t("noSales"),
      datapoint: { metric: "sales.count", value: totals.sales, unit: "count", source: "sales" },
    },
    {
      key: "avgOrder",
      label: t("avgOrder"),
      value: hasSales ? formatCents(totals.aovCents, totals.currency, locale) : null,
      zeroText: t("noSales"),
      datapoint: {
        metric: "sales.aov",
        value: totals.aovCents,
        unit: "currency_cents",
        currency: totals.currency,
        source: "sales",
      },
    },
    {
      key: "uniqueBuyers",
      label: t("uniqueBuyers"),
      value: hasSales ? formatNumber(totals.uniqueBuyers, locale) : null,
      hint: hasSales && totals.repeatBuyers > 0 ? t("repeatBuyers", { count: totals.repeatBuyers }) : undefined,
      zeroText: t("noBuyers"),
      datapoint: { metric: "sales.unique_buyers", value: totals.uniqueBuyers, unit: "count", source: "sales" },
    },
    {
      key: "refundRate",
      label: t("refundRate"),
      value: refundRate != null ? formatPercent(refundRate, locale, 1) : null,
      hint:
        totals.refundedCount > 0
          ? t("refunded", {
              count: totals.refundedCount,
              amount: formatCents(totals.refundedCents, totals.currency, locale),
            })
          : undefined,
      zeroText: t("noOrders"),
      datapoint: {
        metric: "sales.refund_rate",
        // Published at full precision. The tile rounds to one decimal for
        // reading; a machine doing arithmetic should not inherit that.
        value: refundRate ?? 0,
        unit: "percent",
        source: "sales",
      },
    },
  ];
}
