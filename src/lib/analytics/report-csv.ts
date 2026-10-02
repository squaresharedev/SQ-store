import { BRAND_NAME } from "@/lib/brand";
import { centsToDecimal, toCsv, type CsvValue } from "@/lib/format/csv";
import { SIGNAL_KINDS, type SignalKind } from "@/lib/analytics/signals";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";

/**
 * THE ANALYTICS REPORT: the analytics page's figures for the chosen range as
 * a CSV, one row per period (day, or month for long ranges, exactly the
 * buckets the charts draw). A Pro plan perk (PLANS[..].perks.analyticsExport).
 *
 * Built in the browser from the page's own snapshot (AnalyticsSnapshot), the
 * payload the charts were drawn from, so the file and the screen can never
 * disagree and no second read is needed. Nothing in it is more than the page
 * already shows the same person: the plan decides who gets the download, not
 * who may see the numbers.
 *
 * The header row is a data contract (snake_case, English, never translated).
 * Add columns at the end; never rename or reorder one. Signal columns appear
 * only for kinds this store has ever recorded, in SIGNAL_KINDS order, so a
 * store without a booking embed gets no column of zeros for it.
 */

/** The fixed columns, in file order; signal columns follow them. */
export const ANALYTICS_REPORT_COLUMNS = ["period_start", "sales", "revenue", "average_order", "currency"] as const;

/** The column a signal kind's counts land in ("storefront_view" -> "storefront_views"). */
export function signalColumn(kind: SignalKind): string {
  return `${kind}s`;
}

/** The whole report for one snapshot. */
export function analyticsReportCsv(snapshot: AnalyticsSnapshot): string {
  const { sales, signals, currency } = snapshot;
  const kinds = SIGNAL_KINDS.filter((kind) => signals.everRecorded.includes(kind));

  // Sales and signals are bucketed by the same rules, so a date is the join.
  const counts = new Map<string, Partial<Record<SignalKind, number>>>();
  for (const kind of kinds) {
    for (const point of signals.byKind[kind]?.series ?? []) {
      counts.set(point.date, { ...counts.get(point.date), [kind]: point.count });
    }
  }
  const dates = [...new Set([...sales.series.map((point) => point.date), ...counts.keys()])].sort();
  const byDate = new Map(sales.series.map((point) => [point.date, point]));

  const rows: CsvValue[][] = dates.map((date) => {
    const point = byDate.get(date);
    return [
      date,
      point?.sales ?? 0,
      centsToDecimal(point?.revenueCents ?? 0),
      centsToDecimal(point?.aovCents ?? 0),
      currency,
      ...kinds.map((kind) => counts.get(date)?.[kind] ?? 0),
    ];
  });
  return toCsv([...ANALYTICS_REPORT_COLUMNS, ...kinds.map(signalColumn)], rows);
}

/** "square-share-analytics-2026-09-01-to-2026-09-30.csv", from the range the
 *  figures cover (open ends fall back to the day the report was made). */
export function analyticsReportFileName(snapshot: AnalyticsSnapshot): string {
  const brand = BRAND_NAME.toLowerCase().replace(/\s+/g, "-");
  const made = snapshot.generatedAt.slice(0, 10);
  const from = snapshot.range.from ?? made;
  const to = snapshot.range.to ?? made;
  return `${brand}-analytics-${from}-to-${to}.csv`;
}
