"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHART, ChartDataTable, CompareLegend, ScrubChart } from "@/components/charts";
import { ChangeChip } from "@/components/ui/ChangeChip";
import { infoTextClass } from "@/components/ui/control-styles";
import { formatBucketLabel, isMonthlySeries } from "@/lib/analytics/buckets";
import { cn } from "@/lib/utils";
import { changeRatio } from "@/components/analytics/compare";
import type { ScrubLine } from "@/components/analytics/look";

/** The figure's size: the page's headline, or a card's own figure. */
const FIGURE_SIZE = {
  lead: "text-4xl sm:text-5xl",
  card: "text-2xl sm:text-3xl",
} as const;

/**
 * A figure over the line that makes it, read by moving along the line: the
 * Payments tab's earnings chart, for any trend on the analytics page.
 *
 * At rest the figure is the range's own, with its change on the period before
 * as a chip ("▲ 12%", grey rather than red when it fell: on this page red is
 * for refunds). Move along the line and the figure reads out the point under
 * the pointer, the chip's line saying which ("On 12 Sep", or "Up to 12 Sep"
 * for a running line); leave and it goes back. No tooltip box, no value axis:
 * the figure IS the readout, and the dates sit at the two ends and the middle.
 * Every plotted value is also in an sr-only table, as on every kit chart.
 *
 * The line is the caller's (look.ts: sumLine, averageLine), already daily or
 * running; this draws it and reads it out.
 *
 * The change is published on the row that states it, as `data-analytics-change`
 * (the ratio at full precision, docs/analytics-datapoints.md), and stays put
 * while the row reads out a date instead.
 */
export function ScrubTrend({
  values,
  compare,
  dates,
  line,
  total,
  before,
  beforeRange,
  show,
  showText,
  color,
  height,
  size,
  figureClassName,
  emptyText,
  legend,
  ariaLabel,
  children,
}: {
  /** One value per bucket, null where there is none (an average of nothing). */
  values: (number | null)[];
  /** The period before, bucket for bucket, or null when there is none. */
  compare: (number | null)[] | null;
  /** Each bucket's start, "YYYY-MM-DD". */
  dates: string[];
  line: ScrubLine;
  /** The figure at rest: the range's own. */
  total: number;
  /** The period before's figure, for the chip; null without a period before
   *  that had any (a store that did not exist yet did not earn zero). */
  before: number | null;
  /** The dates the period before covers, said under the chip so "before"
   *  is never a guess. */
  beforeRange?: { from: string; to: string } | null;
  /** A figure as the headline prints it. */
  show: (value: number) => ReactNode;
  /** A figure inside a sentence ("vs €80.00 before"). */
  showText: (value: number) => string;
  color: string;
  height: number;
  size: keyof typeof FIGURE_SIZE;
  figureClassName?: string;
  /** Words over a flat line, in place of the figure: a zero is said, never
   *  printed as a headline. */
  emptyText?: string | null;
  /** The two lines' names, keyed over the chart when there is a comparison. */
  legend?: { now: string; before: string };
  ariaLabel: string;
  /** More lines under the figure's (the revenue lead's "after fees"). */
  children?: ReactNode;
}) {
  const t = useTranslations("Analytics");
  const tCharts = useTranslations("Common.charts");
  const locale = useLocale();
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbed = scrub !== null && scrub < dates.length ? scrub : null;
  const monthly = isMonthlySeries(dates);
  const dateOf = (index: number) => formatBucketLabel(dates[index], monthly, locale);
  const scrubValue = scrubbed === null ? null : values[scrubbed];
  const middle = Math.floor((dates.length - 1) / 2);
  const change = before !== null ? changeRatio(total, before) : null;

  return (
    <div className="min-w-0">
      {!emptyText && (
        <p
          className={cn(FIGURE_SIZE[size], "font-semibold tracking-tight text-foreground", figureClassName)}
          data-scrub-figure=""
        >
          {scrubbed === null ? (
            show(total)
          ) : scrubValue === null ? (
            <span className="text-muted-foreground">{t("scrub.noSales")}</span>
          ) : (
            show(scrubValue)
          )}
        </p>
      )}
      {/* One row for the change and for the date being read, so the chart
          under the pointer never moves while it is scrubbed. */}
      {!emptyText && (
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2" data-analytics-change={change ?? undefined}>
          {scrubbed !== null ? (
            <span className={infoTextClass}>
              {t(line === "running" ? "scrub.upTo" : monthly ? "scrub.inMonth" : "scrub.on", {
                date: dateOf(scrubbed),
              })}
            </span>
          ) : (
            before !== null &&
            before > 0 && (
              <>
                <ChangeChip current={total} previous={before} calm />
                <span className={infoTextClass}>{tCharts("vsBefore", { amount: showText(before) })}</span>
              </>
            )
          )}
        </div>
      )}
      {!emptyText && change !== null && beforeRange && (
        <p className={cn(infoTextClass, "mt-0.5", scrubbed !== null && "invisible")}>
          {beforeRange.from === beforeRange.to
            ? formatBucketLabel(beforeRange.from, false, locale)
            : t("compare.previousPeriodDates", {
                from: formatBucketLabel(beforeRange.from, false, locale),
                to: formatBucketLabel(beforeRange.to, false, locale),
              })}
        </p>
      )}
      {children}

      {compare && legend && !emptyText && (
        <CompareLegend className="mt-4" now={legend.now} before={legend.before} color={color} />
      )}

      <div className={cn("relative", compare && legend && !emptyText ? "mt-2" : "mt-5")}>
        {emptyText && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-inter text-sm text-muted-foreground">
            {emptyText}
          </p>
        )}
        <ScrubChart
          values={values}
          compare={compare}
          color={color}
          height={height}
          guides
          active={scrubbed}
          onScrub={emptyText ? undefined : setScrub}
          ariaLabel={ariaLabel}
        />
      </div>

      {dates.length > 0 && (
        // One date sits under its point, which is the middle of the plot.
        <div className={cn(infoTextClass, "mt-2 flex gap-2", dates.length === 1 ? "justify-center" : "justify-between")}>
          <span>{dateOf(0)}</span>
          {dates.length > 2 && <span>{dateOf(middle)}</span>}
          {dates.length > 1 && <span>{dateOf(dates.length - 1)}</span>}
        </div>
      )}

      {/* Not for an empty range: a row of zeros is the "0.00" the words
          over the line are there to avoid. */}
      {!emptyText && (
        <ChartDataTable
          data={dates.map((date, index) => ({ date, now: values[index], before: compare?.[index] ?? null }))}
          xKey="date"
          series={[
            { key: "now", label: legend?.now ?? ariaLabel, resolvedColor: color },
            ...(compare ? [{ key: "before", label: legend?.before ?? "", resolvedColor: CHART.series3 }] : []),
          ]}
          caption={ariaLabel}
          xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
          valueFormatter={showText}
        />
      )}
    </div>
  );
}
