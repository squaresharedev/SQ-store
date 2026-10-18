import type { Locale } from "@/i18n/locales";
import { formatPercent } from "@/lib/format/intl";

// THIS PERIOD VERSUS THE ONE BEFORE IT.
//
// The trend charts on the analytics page can draw the previous period under
// the current one (a dashed reference line, see ChartSeries.reference), and the
// revenue hero states the change as a figure. The arithmetic for both lives
// here, so every chart lines the two periods up the same way and nothing
// claims a change against a period that had nothing in it.

/**
 * The previous period's values laid under the current buckets, first bucket on
 * first bucket: day 1 of this period against day 1 of the last.
 *
 * Null where the previous period has no bucket to offer (a month-bucketed
 * range can be one bucket longer than the one before it). Null altogether when
 * there is nothing to compare against, which is the caller's cue to draw no
 * comparison at all.
 */
export function alignPrevious(length: number, previous: (number | null)[]): (number | null)[] | null {
  if (previous.length === 0 || length === 0) return null;
  return Array.from({ length }, (_, index) => previous[index] ?? null);
}

/**
 * The change from `previous` to `current` as a ratio: 0.12 is up 12%.
 *
 * Null when the previous figure is zero. "Up from nothing" has no percentage,
 * and printing one ("+100%", or worse) would be a number made up to fill a
 * line.
 */
export function changeRatio(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return (current - previous) / previous;
}

/** Under ten percent a decimal is worth reading; past it, it is noise. */
const DECIMAL_BELOW = 10;

/** A change as people write it: "+12%", "-8.4%", and "0%" with no sign. */
export function formatChange(ratio: number, locale: Locale): string {
  const percent = Math.abs(ratio) * 100;
  const digits = percent < DECIMAL_BELOW ? 1 : 0;
  const rounded = Number(percent.toFixed(digits));
  const sign = rounded === 0 ? "" : ratio > 0 ? "+" : "-";
  return `${sign}${formatPercent(rounded, locale, rounded === 0 ? 0 : digits)}`;
}
