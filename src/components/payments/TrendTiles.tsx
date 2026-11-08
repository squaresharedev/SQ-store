"use client";

import { useLocale, useTranslations } from "next-intl";
import { CHART, formatNumber, SCRUB, ScrubChart } from "@/components/charts";
import { MoneyFigure } from "@/components/ui/MoneyFigure";
import { joinedCellClass } from "@/components/ui/surface-styles";
import { formatCents } from "@/lib/format/money";
import { type PaymentsRangeView, type PaymentsTotals } from "@/lib/payments/history";
import { runningTotal } from "@/lib/series";
import type { PaymentsDay } from "@/lib/payments/types";
import { cn } from "@/lib/utils";
import { ChangeChip } from "@/components/ui/ChangeChip";

type Tile = {
  key: "gross" | "sales" | "costs" | "paidOut";
  of: (totals: PaymentsTotals) => number;
  perDay: (day: PaymentsDay) => number;
  money: boolean;
  /** A cost: falling is the good news. */
  downIsGood?: boolean;
};

const TILES: readonly Tile[] = [
  { key: "gross", of: (totals) => totals.grossCents, perDay: (day) => day.grossCents, money: true },
  { key: "sales", of: (totals) => totals.sales, perDay: (day) => day.sales, money: false },
  { key: "costs", of: (totals) => totals.costsCents, perDay: (day) => day.costsCents, money: true, downIsGood: true },
  { key: "paidOut", of: (totals) => totals.paidOutCents, perDay: (day) => day.paidOutCents, money: true },
];

/**
 * The period's four figures beside the earnings chart: what sold, how many
 * times, what came off it, and what went to the bank. Each against the period
 * before (when there was one) and with its own running line, so a tile shows
 * how it got there and not only where it ended. Same period as the chart, and
 * joined to it with no gap (cells of PaymentsPage's joined block).
 */
export function TrendTiles({ view, currency }: { view: PaymentsRangeView; currency: string }) {
  const t = useTranslations("Payments.trends");
  const tCharts = useTranslations("Common.charts");
  const locale = useLocale();
  return (
    <div className="grid grid-cols-2 gap-px lg:grid-cols-4" data-trend-tiles="">
      {TILES.map((tile) => {
        const label = t(tile.key);
        const value = tile.of(view.totals);
        const before = view.before ? tile.of(view.before) : null;
        const show = (amount: number) => (tile.money ? formatCents(amount, currency, locale) : formatNumber(amount, locale));
        return (
          <section key={tile.key} className={cn(joinedCellClass, "flex flex-col overflow-hidden p-4 pb-0")}>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <h3 className="font-inter text-xs font-medium text-muted-foreground">{label}</h3>
              {before !== null && <ChangeChip current={value} previous={before} downIsGood={tile.downIsGood} />}
            </div>
            <p className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">
              {tile.money ? (
                <MoneyFigure cents={value} currency={currency} fit />
              ) : (
                <span className="tabular-nums">{show(value)}</span>
              )}
            </p>
            <p className="mt-0.5 font-inter text-xs text-muted-foreground">
              {before === null ? t("noBefore") : tCharts("vsBefore", { amount: show(before) })}
            </p>
            <ScrubChart
              values={runningTotal(view.days.map(tile.perDay))}
              color={CHART.earnings}
              height={SCRUB.sparkHeight}
              strokeWidth={SCRUB.sparkStroke}
              baseline={false}
              className="-mx-4 mt-3"
              ariaLabel={tCharts("spark", { label })}
            />
          </section>
        );
      })}
    </div>
  );
}
