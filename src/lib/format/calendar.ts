// Pure, timezone-safe date helpers for the Calendar / DatePicker primitives.
// Everything is handled as a LOCAL calendar date (never a UTC instant): an ISO
// "YYYY-MM-DD" round-trips to the exact day the seller sees, in any timezone.
// Display strings take the reader's locale; English keeps en-IE to match
// lib/format/date.ts (EUR-primary market).
// This file is arithmetic + labels only — no React, safe on client and server.

import type { Locale } from "@/i18n/locales";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ENGLISH_WEEKDAY_LABELS = [
  "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
] as const;

const ENGLISH_WEEKDAY_FULL = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;

/** A local date known to be a Monday (1 January 2024), for naming weekdays. */
const MONDAY = { year: 2024, month: 0, day: 1 };

function weekdayNames(locale: Locale, weekday: "short" | "long"): readonly string[] {
  const format = dateTimeFormat(locale, { weekday });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(MONDAY.year, MONDAY.month, MONDAY.day + index)),
  );
}

/** Monday-first weekday column headers: "Mon".."Sun" in English. */
export function weekdayLabels(locale: Locale): readonly string[] {
  return locale === "en" ? ENGLISH_WEEKDAY_LABELS : weekdayNames(locale, "short");
}

/** Monday-first full weekday names: "Monday".."Sunday" in English. */
export function weekdayFullNames(locale: Locale): readonly string[] {
  return locale === "en" ? ENGLISH_WEEKDAY_FULL : weekdayNames(locale, "long");
}

/** Month heading, e.g. "July 2026". */
export function monthLabel(date: Date, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), { month: "long", year: "numeric" }).format(date);
}

/** Screen-reader label for a single day cell, e.g. "Saturday, 4 July 2026". */
export function fullDateLabel(date: Date, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Trigger display, e.g. "4 Jul 2026". */
export function formatDisplayDate(date: Date, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * A fixed "YYYY-MM-DD" calendar date spelled out, e.g. "9 September 2026".
 * Read as a local date, so no timezone can move it to the day before. Anything
 * that is not a strict ISO date comes back unchanged.
 */
export function formatLongCalendarDate(isoDate: string, locale: Locale): string {
  const date = fromISODate(isoDate);
  if (!date) return isoDate;
  return dateTimeFormat(intlTag(locale, "en-IE"), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a strict "YYYY-MM-DD" into a local Date, rejecting junk and rollovers
 *  (e.g. 2026-02-30). Returns null for empty/invalid input. */
export function fromISODate(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

export function isSameDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a && !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isBefore(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

export function isAfter(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() > startOfDay(b).getTime();
}

/** Is `date` outside the optional [min, max] bounds (inclusive)? */
export function isOutsideRange(
  date: Date,
  min: Date | null,
  max: Date | null,
): boolean {
  return (!!min && isBefore(date, min)) || (!!max && isAfter(date, max));
}

/** Clamp a date into the optional [min, max] bounds. */
export function clampDate(date: Date, min: Date | null, max: Date | null): Date {
  if (min && isBefore(date, min)) return startOfDay(min);
  if (max && isAfter(date, max)) return startOfDay(max);
  return startOfDay(date);
}

/** A rectangular 6-week (42-cell) Monday-first grid covering `month`. Cells
 *  outside the month are included so every row is full. */
export function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // JS getDay(): 0=Sun..6=Sat → Monday-first column offset.
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
