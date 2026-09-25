import { useTranslations, useLocale } from "next-intl";
import { MetricTile } from "@/components/dashboard/MetricTile";
import { formatCents } from "@/lib/format/money";
import { formatFixed, formatPercent } from "@/lib/format/intl";
import { formatNumber } from "@/components/charts";
import type { AnalyticsTotals } from "@/lib/analytics/types";

/**
 * The headline sales metrics for the selected range.
 *
 * Money renders only via formatCents from integer cents; zero sales shows the
 * calm zero state instead of a fake "0.00".
 *
 * Every tile also publishes its RAW figure through `datapoint`, integer cents
 * for money, a plain count otherwise, so the numbers a person reads and the
 * numbers a machine reads are the same numbers. See
 * docs/analytics-datapoints.md.
 *
 * The old Views and Clicks tiles are gone from here: they were honest
 * "coming soon" placeholders, and now that the signal pipeline exists they are
 * real figures living in their own sections further down the page, where they
 * come with a trend and a breakdown rather than a bare number.
 */
export function AnalyticsTiles({ totals }: { totals: AnalyticsTotals }) {
  const t = useTranslations("Analytics.tiles");
  const locale = useLocale();
  const hasSales = totals.sales > 0;
  // Refund rate over settled outcomes (paid + refunded) — display-only math,
  // never money. "0.0%" with real orders is a true, earned zero.
  const settled = totals.sales + totals.refundedCount;
  const refundRate = settled > 0 ? (totals.refundedCount / settled) * 100 : null;
  // Sales velocity across the window the data actually covers.
  const salesPerDay =
    hasSales && totals.rangeDays > 0 ? totals.sales / totals.rangeDays : null;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <MetricTile
        label={t("revenue")}
        value={hasSales ? formatCents(totals.revenueCents, totals.currency, locale) : null}
        hint={
          hasSales
            ? t("afterFees", {
                amount: formatCents(totals.netRevenueCents, totals.currency, locale),
              })
            : undefined
        }
        zeroText={t("noSales")}
        datapoint={{
          metric: "sales.revenue",
          value: totals.revenueCents,
          unit: "currency_cents",
          currency: totals.currency,
          source: "sales",
        }}
      />
      <MetricTile
        label={t("sales")}
        value={hasSales ? formatNumber(totals.sales, locale) : null}
        hint={
          salesPerDay != null
            ? t("perDay", { rate: formatFixed(salesPerDay, 1, locale) })
            : undefined
        }
        zeroText={t("noSales")}
        datapoint={{
          metric: "sales.count",
          value: totals.sales,
          unit: "count",
          source: "sales",
        }}
      />
      <MetricTile
        label={t("avgOrder")}
        value={hasSales ? formatCents(totals.aovCents, totals.currency, locale) : null}
        zeroText={t("noSales")}
        datapoint={{
          metric: "sales.aov",
          value: totals.aovCents,
          unit: "currency_cents",
          currency: totals.currency,
          source: "sales",
        }}
      />
      <MetricTile
        label={t("uniqueBuyers")}
        value={hasSales ? formatNumber(totals.uniqueBuyers, locale) : null}
        hint={
          hasSales && totals.repeatBuyers > 0
            ? t("repeatBuyers", { count: totals.repeatBuyers })
            : undefined
        }
        zeroText={t("noBuyers")}
        datapoint={{
          metric: "sales.unique_buyers",
          value: totals.uniqueBuyers,
          unit: "count",
          source: "sales",
        }}
      />
      <MetricTile
        label={t("refundRate")}
        value={refundRate != null ? formatPercent(refundRate, locale, 1) : null}
        hint={
          totals.refundedCount > 0
            ? t("refunded", {
                count: totals.refundedCount,
                amount: formatCents(totals.refundedCents, totals.currency, locale),
              })
            : undefined
        }
        zeroText={t("noOrders")}
        datapoint={{
          metric: "sales.refund_rate",
          // Published at full precision. The tile rounds to one decimal for
          // reading; a machine doing arithmetic should not inherit that.
          value: refundRate ?? 0,
          unit: "percent",
          source: "sales",
        }}
      />
    </div>
  );
}
