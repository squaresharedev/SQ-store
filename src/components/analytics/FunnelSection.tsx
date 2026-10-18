import { useLocale, useTranslations } from "next-intl";
import { Filter } from "lucide-react";
import { MetricTile } from "@/components/dashboard/MetricTile";
import { formatNumber } from "@/components/charts";
import { formatFixed, formatPercent } from "@/lib/format/intl";
import { FUNNEL_MIN_VIEWS } from "@/lib/analytics/funnel/events";
import {
  checkoutAbandonment,
  funnelHasEnoughData,
  ordersPer100Views,
} from "@/lib/analytics/funnel/summary";
import type { FunnelData } from "@/lib/analytics/types";
import { AnalyticsSection } from "@/components/analytics/AnalyticsSection";
import { changeRatio, formatChange } from "@/components/analytics/compare";

/** The section's id: its anchor, its `data-analytics-section` value and the
 *  prefix of every metric it publishes (docs/analytics-datapoints.md). */
export const FUNNEL_SECTION_ID = "funnel";

/**
 * THE BUYER FUNNEL: from a storefront shown on the seller's own site to a paid
 * order. Four counts and two rates (lib/analytics/funnel/summary.ts says where
 * each comes from).
 *
 * THREE RULES THIS HOLDS:
 *
 *   1. A rate never stands alone. Each one carries the two counts it was worked
 *      out from, so "4.0" can always be read as "2 orders, 50 views".
 *   2. Below FUNNEL_MIN_VIEWS views in the range there is no rate at all, only
 *      "Not enough data yet" and the counts.
 *   3. The only comparison is with this seller's own previous period. Nothing
 *      here knows how any other store is doing.
 *
 * The wording is "orders per 100 views", never "per visitor": a view is a
 * storefront being shown, and the same person can be several of them.
 */
export function FunnelSection({
  funnel,
  previous,
}: {
  funnel: FunnelData;
  /** The same funnel for the period before the range, when there is one. */
  previous?: FunnelData;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const count = (value: number) => (value > 0 ? formatNumber(value, locale) : null);

  const enough = funnelHasEnoughData(funnel);
  const conversion = ordersPer100Views(funnel);
  const abandonment = checkoutAbandonment(funnel);
  const notEnough = t("funnel.notEnough");
  const notCounted = t("signal.notCounted");

  // Against the seller's own previous period, and only when both periods have
  // a rate to compare.
  const versus = (current: number | null, before: number | null): string | null => {
    if (current === null || before === null) return null;
    const ratio = changeRatio(current, before);
    return ratio === null ? null : t("compare.vsPrevious", { change: formatChange(ratio, locale) });
  };
  const withChange = (counts: string, change: string | null) => (change ? `${counts} · ${change}` : counts);

  const conversionCounts = t("funnel.conversionCounts", {
    orders: formatNumber(funnel.embedOrders, locale),
    views: formatNumber(funnel.embedViews, locale),
  });
  const abandonmentCounts = t("funnel.abandonmentCounts", {
    expired: formatNumber(funnel.checkoutsExpired, locale),
    started: formatNumber(funnel.checkoutsStarted, locale),
  });

  return (
    <AnalyticsSection
      id={FUNNEL_SECTION_ID}
      title={t("funnel.label")}
      description={t("funnel.description")}
      icon={Filter}
      state="live"
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label={t("funnel.views")}
          value={count(funnel.embedViews)}
          zeroText={t("funnel.viewsEmpty")}
          datapoint={{ metric: "funnel.embed_views", value: funnel.embedViews, unit: "count", source: FUNNEL_SECTION_ID }}
        />
        <MetricTile
          label={t("funnel.opens")}
          value={count(funnel.productOpens)}
          zeroText={t("funnel.opensEmpty")}
          datapoint={{ metric: "funnel.product_opens", value: funnel.productOpens, unit: "count", source: FUNNEL_SECTION_ID }}
        />
        <MetricTile
          label={t("funnel.started")}
          value={funnel.checkoutsAvailable ? count(funnel.checkoutsStarted) : null}
          zeroText={funnel.checkoutsAvailable ? t("funnel.startedEmpty") : notCounted}
          // Not published at all while it cannot be read: a zero would say
          // nobody started a checkout.
          datapoint={
            funnel.checkoutsAvailable
              ? { metric: "funnel.checkouts_started", value: funnel.checkoutsStarted, unit: "count", source: FUNNEL_SECTION_ID }
              : undefined
          }
        />
        <MetricTile
          label={t("funnel.expired")}
          value={funnel.checkoutsAvailable ? count(funnel.checkoutsExpired) : null}
          zeroText={funnel.checkoutsAvailable ? t("funnel.expiredEmpty") : notCounted}
          datapoint={
            funnel.checkoutsAvailable
              ? { metric: "funnel.checkouts_expired", value: funnel.checkoutsExpired, unit: "count", source: FUNNEL_SECTION_ID }
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricTile
          label={t("funnel.conversion")}
          value={conversion !== null ? formatFixed(conversion, 1, locale) : null}
          hint={withChange(conversionCounts, versus(conversion, previous ? ordersPer100Views(previous) : null))}
          zeroText={notEnough}
          // Published at full precision, and only when there is a rate.
          datapoint={
            conversion !== null
              ? { metric: "funnel.orders_per_100_views", value: conversion, unit: "percent", source: FUNNEL_SECTION_ID }
              : undefined
          }
        />
        <MetricTile
          label={t("funnel.abandonment")}
          value={abandonment !== null ? formatPercent(abandonment, locale, 1) : null}
          hint={
            funnel.checkoutsAvailable
              ? withChange(abandonmentCounts, versus(abandonment, previous ? checkoutAbandonment(previous) : null))
              : undefined
          }
          zeroText={!funnel.checkoutsAvailable ? notCounted : enough ? t("funnel.startedEmpty") : notEnough}
          datapoint={
            abandonment !== null
              ? { metric: "funnel.checkout_abandonment", value: abandonment, unit: "percent", source: FUNNEL_SECTION_ID }
              : undefined
          }
        />
      </div>

      {!enough && (
        <p className="font-inter text-xs text-muted-foreground" data-funnel-threshold={FUNNEL_MIN_VIEWS}>
          {t("funnel.notEnoughHint", { min: formatNumber(FUNNEL_MIN_VIEWS, locale) })}
        </p>
      )}
    </AnalyticsSection>
  );
}
