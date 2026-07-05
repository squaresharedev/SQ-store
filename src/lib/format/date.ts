// Client-safe date display for order timestamps. Fixed en-IE locale (EUR
// primary market, matches lib/format.ts money grouping) so server render and
// hydration agree. Do NOT use lib/dashboard/format.ts in client components —
// it transitively imports server-only code.

const ORDER_DATE = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ORDER_DATE_TIME = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `"2026-07-02T14:05:00Z"` -> `"2 Jul 2026"`. */
export function formatOrderDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "—" : ORDER_DATE.format(date);
}

/** `"2026-07-02T14:05:00Z"` -> `"2 Jul 2026, 14:05"` (viewer's timezone). */
export function formatOrderDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "—" : ORDER_DATE_TIME.format(date);
}
