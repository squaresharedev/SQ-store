import type { AnalyticsRange } from "@/lib/analytics/types";

// TIME BUCKETING, shared by every series on the analytics page.
//
// Extracted so revenue and signals cannot disagree about what a bucket is. Two
// charts stacked on one screen, one showing daily views and one showing
// monthly revenue for the same range, is a bug that reads as a data problem.
//
// The rules, unchanged from the revenue trend they came from: UTC everywhere
// (a bare date::timestamptz would follow the server timezone), day buckets up
// to MAX_DAILY_SPAN_DAYS and month buckets beyond, and empty buckets kept as
// zeros so a quiet week is a flat line rather than a gap.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Ranges up to ~3 months bucket by day; anything longer buckets by month. */
export const MAX_DAILY_SPAN_DAYS = 92;

/** Mon-first weekday labels; SQL returns ISO dow (1 = Monday .. 7 = Sunday). */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** UTC ms for an ISO "YYYY-MM-DD" day start. Deterministic, no locale. */
export function dayStartUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ISO "YYYY-MM-DD" for a UTC ms timestamp. */
export function toIsoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** ISO "YYYY-MM-DD" of the first day of the month containing `isoDate`. */
export function toMonthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** The bucket calendar for a range: ordered keys plus which grain they are. */
export type BucketPlan = {
  /** Bucket start dates, oldest first, ISO "YYYY-MM-DD". */
  keys: string[];
  /** True when the keys are month starts rather than days. */
  byMonth: boolean;
};

/**
 * Build the (empty) bucket calendar a series will be poured into.
 *
 * `anchor` is where an unbounded range starts, the first row the series
 * actually has. Callers pass the first PAID order for revenue and the first
 * signal for signals, because a series that begins with weeks of leading zeros
 * before anything existed reads as a decline that never happened.
 *
 * Returns an empty plan when there is nothing to anchor to, which is the
 * caller's cue to render the empty state rather than an axis with no data.
 */
export function planBuckets(
  range: AnalyticsRange,
  anchor: string | null,
): BucketPlan {
  const start = range.from ?? anchor;
  if (!start) return { keys: [], byMonth: false };

  const end = range.to ?? toIsoDay(Date.now());
  const startMs = dayStartUtc(start);
  const endMs = dayStartUtc(end);
  if (endMs < startMs) return { keys: [], byMonth: false };

  const spanDays = Math.floor((endMs - startMs) / DAY_MS);
  const byMonth = spanDays > MAX_DAILY_SPAN_DAYS;
  const keys: string[] = [];

  if (byMonth) {
    const [endY, endM] = toMonthStart(end).split("-").map(Number);
    let [y, m] = toMonthStart(start).split("-").map(Number);
    while (y < endY || (y === endY && m <= endM)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) keys.push(toIsoDay(ms));
  }

  return { keys, byMonth };
}

/** Which bucket an ISO day belongs to under a plan. */
export function bucketKeyFor(plan: BucketPlan, isoDay: string): string {
  return plan.byMonth ? toMonthStart(isoDay) : isoDay;
}

/**
 * Inclusive days a range covers, anchored at `anchor` when unbounded.
 * 0 when there is nothing to measure.
 */
export function rangeDayCount(
  range: AnalyticsRange,
  anchor: string | null,
): number {
  const start = range.from ?? anchor;
  if (!start) return 0;
  const end = range.to ?? toIsoDay(Date.now());
  const span = Math.floor((dayStartUtc(end) - dayStartUtc(start)) / DAY_MS);
  return span < 0 ? 0 : span + 1;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Deterministic short label for a bucket key. No Intl: server and client must
 *  render identical text or hydration reports a mismatch. */
export function formatBucketLabel(date: string, monthly: boolean): string {
  const [year, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return monthly ? `${name} ${year}` : `${name} ${Number(day)}`;
}

/** Month-grained series? Detected from the gap between the first two buckets,
 *  so a chart can label itself without being told the plan. */
export function isMonthlySeries(dates: string[]): boolean {
  if (dates.length < 2) return false;
  return dayStartUtc(dates[1]) - dayStartUtc(dates[0]) >= 28 * DAY_MS;
}
