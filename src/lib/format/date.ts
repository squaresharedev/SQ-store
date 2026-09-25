// Client-safe date display. Every formatter takes the reader's locale, so
// server render and hydration agree; English keeps the locale each surface has
// always used. Do NOT use lib/dashboard/format.ts in client components: it
// transitively imports server-only code.
//
// TIME ZONE: none is passed, exactly as before this took a locale, so a
// timestamp renders in the runtime's zone (the viewer's, in the browser).

import type { Locale } from "@/i18n/locales";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";

const ORDER_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const ORDER_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const LONG_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

function valid(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `"2026-07-02T14:05:00Z"` -> `"2 Jul 2026"` in English. */
export function formatOrderDate(isoDate: string, locale: Locale): string {
  const date = valid(isoDate);
  return date ? dateTimeFormat(intlTag(locale, "en-IE"), ORDER_DATE).format(date) : "—";
}

/** `"2026-07-02T14:05:00Z"` -> `"2 Jul 2026, 14:05"` in English (viewer's timezone). */
export function formatOrderDateTime(isoDate: string, locale: Locale): string {
  const date = valid(isoDate);
  return date ? dateTimeFormat(intlTag(locale, "en-IE"), ORDER_DATE_TIME).format(date) : "—";
}

/** `"2026-07-02T14:05:00Z"` -> `"2 July 2026"` in English (en-GB, month spelled out). */
export function formatLongDate(isoDate: string, locale: Locale): string {
  const date = valid(isoDate);
  // An unparseable value prints what toLocaleDateString always printed for one.
  return date ? dateTimeFormat(intlTag(locale, "en-GB"), LONG_DATE).format(date) : String(new Date(NaN));
}

/**
 * The locale's plain numeric date, `"9/17/2026"` in English. English is en-US,
 * the runtime default this surface used to fall back to (Node, and the
 * Chromium the e2e suite drives, both default to en-US).
 */
export function formatNumericDate(isoDate: string, locale: Locale): string {
  const date = valid(isoDate);
  return date ? dateTimeFormat(intlTag(locale, "en-US")).format(date) : String(new Date(NaN));
}
