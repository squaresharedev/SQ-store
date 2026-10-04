"use client";

import { useTranslations } from "next-intl";
import { HBarChart } from "@/components/charts";
import { ChartCard } from "@/components/analytics/ChartCard";
import { TONE } from "@/components/analytics/palette";
import { MetricTile } from "@/components/dashboard/MetricTile";
import type { DiscountsSummary } from "@/lib/discounts/summary";
import { useDiscountWording } from "./useDiscountWording";

/** Channel names are the seller's own words, and the axis column is finite. */
const MAX_LABEL = 22;

/**
 * WHAT THE DISCOUNTS BROUGHT IN: three figures and the channels ranked by
 * orders. Codes are credited to the channel they were shared on (or the code
 * itself when none was named); automatic sales share one row.
 *
 * Orders, not revenue, rank the channels: "which channel sells" is a count of
 * buyers, and it is the one figure that adds up across currencies.
 */
export function DiscountPerformance({ summary }: { summary: DiscountsSummary }) {
  const t = useTranslations("Discounts.performance");
  const words = useDiscountWording();
  const channels = summary.channels.map((channel) => ({
    channel: channel.label ?? t("automatic"),
    orders: channel.orders,
  }));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="discount-performance" data-discount-performance="">
      <h2 id="discount-performance" className="text-base font-semibold text-foreground">
        {t("title")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile
          label={t("orders")}
          value={String(summary.orders)}
          datapoint={{ metric: "discounts.orders", value: summary.orders, unit: "count", source: "discounts" }}
        />
        <MetricTile
          label={t("revenue")}
          value={summary.revenue.length > 0 ? words.money(summary.revenue) : null}
          zeroText={t("none")}
        />
        <MetricTile
          label={t("given")}
          value={summary.given.length > 0 ? words.money(summary.given) : null}
          zeroText={t("none")}
        />
      </div>
      <ChartCard
        title={t("channelsTitle")}
        description={t("channelsDescription")}
        empty={channels.length === 0}
        emptyText={t("channelsEmpty")}
        panel="channels"
        source="discounts"
        headingLevel="h3"
      >
        <HBarChart
          data={channels}
          xKey="channel"
          series={[{ key: "orders", label: t("series"), colorIndex: TONE.neutral }]}
          categoryWidth={116}
          categoryFormatter={(label) => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label)}
          ariaLabel={t("channelsTitle")}
        />
      </ChartCard>
    </section>
  );
}
