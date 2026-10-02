// Client-safe date display. Every formatter takes the reader's locale, so
// server render and hydration agree; English keeps the locale each surface has
// always used. Do NOT use lib/dashboard/format.ts in client components: it
// transitively imports server-only code.
//
// TIME ZONE: none is passed, exactly as before this took a locale, so a
// timestamp renders in the runtime's zone (the viewer's, in the browser).

import type { Locale } from "@/i18n/locales";
import { dateTimeFormat, intlTag, relativeTimeFormat } from "@/lib/format/intl";

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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago something happened, in the reader's language ("3 hours ago",
 * "yesterday", "10 days ago"). Whole units of the largest size that fits, and
 * "today"/"yesterday" style wording where the language has it.
 *
 * `now` is a parameter so the same instant renders the same text on the server
 * and at hydration, and so a test can pin it. Null for an unparseable date.
 */
export function formatAge(isoDate: string, locale: Locale, now: Date = new Date()): string | null {
  const date = valid(isoDate);
  if (!date) return null;
  const elapsed = now.getTime() - date.getTime();
  const format = relativeTimeFormat(intlTag(locale, "en-IE"), { numeric: "auto" });
  if (elapsed < HOUR_MS) return format.format(-Math.max(0, Math.round(elapsed / MINUTE_MS)), "minute");
  if (elapsed < DAY_MS) return format.format(-Math.round(elapsed / HOUR_MS), "hour");
  return format.format(-Math.floor(elapsed / DAY_MS), "day");
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
