"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHART, CompareLegend, SCRUB, ScrubChart } from "@/components/charts";
import { MoneyFigure } from "@/components/ui/MoneyFigure";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { eyebrowClass, joinedCellClass } from "@/components/ui/surface-styles";
import { formatDayMonth } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import {
  isQuiet,
  PAYMENTS_RANGES,
  type PaymentsRange,
  type PaymentsRangeView,
} from "@/lib/payments/history";
import type { PaymentsHistory } from "@/lib/payments/types";
import { cn } from "@/lib/utils";
import { ChangeChip } from "@/components/ui/ChangeChip";

/**
 * What the store earned over the chosen period, as a figure and a line that
 * adds it up day by day, with the period before dashed under it. Move along
 * the line and the figure reads out the total up to that day; leave and it
 * goes back to the whole period. The period switch here also sets the trend
 * tiles under it (PaymentsPage holds the choice), and the two sit in one
 * joined block there, so this is a cell of it rather than a card of its own.
 *
 * Earned is what reached the balance: sales less fees, refunds and
 * corrections (lib/payments/history.ts). One currency, the store's main one;
 * a line says so when money also moved in another.
 */
export function EarningsChart({
  history,
  view,
  range,
  onRangeChange,
}: {
  history: PaymentsHistory;
  view: PaymentsRangeView;
  range: PaymentsRange;
  onRangeChange: (range: PaymentsRange) => void;
}) {
  const t = useTranslations("Payments.earnings");
  const locale = useLocale();
  const [scrub, setScrub] = useState<number | null>(null);
  const { days, before, earnedRunning, earnedRunningBefore } = view;
  const scrubbed = scrub !== null && days[scrub] ? scrub : null;

  const label = scrubbed === null ? t("label", { days: range }) : t("labelOn", { date: formatDayMonth(days[scrubbed].day, locale) });
  const figure = scrubbed === null ? view.totals.earnedCents : earnedRunning[scrubbed];
  // A store that has never sold gets the line and the words on it, not a
  // headline "€0.00": a zero state is said, never printed as a figure.
  const neverSold = isQuiet(history.days);
  const flat = earnedRunning.every((value) => value === 0) && !before;
  const emptyText = !flat ? null : neverSold ? t("empty") : t("emptyRange", { days: range });
  const middle = days[Math.floor(days.length / 2)];

  return (
    <section className={cn(joinedCellClass, "p-5 sm:p-6")} data-earnings-chart="">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(eyebrowClass, "tracking-widest")}>{label}</p>
          {!neverSold && (
            <p className="mt-1 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              <MoneyFigure cents={figure} currency={history.currency} />
            </p>
          )}
          {/* Kept in place while scrubbing (only hidden), so the chart under
              the pointer never jumps. */}
          {before && (
            <div className={cn("mt-2 flex flex-wrap items-center gap-2", scrubbed !== null && "invisible")}>
              <ChangeChip current={view.totals.earnedCents} previous={before.earnedCents} />
              <span className="font-inter text-xs text-muted-foreground">
                {t("vsBefore", { amount: formatCents(before.earnedCents, history.currency, locale), days: range })}
              </span>
            </div>
          )}
        </div>
        <SegmentedControl
          ariaLabel={t("range")}
          value={String(range)}
          onChange={(value) => onRangeChange(Number(value) as PaymentsRange)}
          options={PAYMENTS_RANGES.map((days) => ({
            value: String(days),
            label: (
              <>
                <span aria-hidden>{t("rangeShort", { days })}</span>
                <span className="sr-only">{t("rangeLong", { days })}</span>
              </>
            ),
          }))}
        />
      </div>

      {earnedRunningBefore && (
        <CompareLegend
          className="mt-5"
          now={t("legendNow", { days: range })}
          before={t("legendBefore", { days: range })}
          color={CHART.earnings}
        />
      )}

      <div className={cn("relative", earnedRunningBefore ? "mt-2" : "mt-6")}>
        {emptyText && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-inter text-sm text-muted-foreground">
            {emptyText}
          </p>
        )}
        <ScrubChart
          values={earnedRunning}
          compare={earnedRunningBefore}
          color={CHART.earnings}
          height={SCRUB.leadHeight}
          guides
          active={scrubbed}
          onScrub={setScrub}
          ariaLabel={t("label", { days: range })}
        />
      </div>

      {days.length > 0 && (
        <div className="mt-2 flex justify-between font-inter text-xs text-muted-foreground">
          <span>{formatDayMonth(days[0].day, locale)}</span>
          <span>{formatDayMonth(middle.day, locale)}</span>
          <span>{t("today")}</span>
        </div>
      )}

      {history.otherCurrencies && (
        <p className="mt-4 font-inter text-xs text-muted-foreground">
          {t("otherCurrencies", { currency: history.currency })}
        </p>
      )}
    </section>
  );
}
