import type { Locale } from "@/i18n/locales";
import { formatPercent, numberFormat } from "@/lib/format/intl";

// Chart number formatters. English is hand-built and deterministic (no Intl), as
// it always was; other locales format through Intl with the locale passed
// explicitly, so server and client still render identical text.

/** Exact value with thousands separators: 1284 → "1,284" ("1 284" in Czech). Tooltip/legend tier. */
export function formatNumber(value: number, locale: Locale): string {
  if (locale !== "en") {
    return numberFormat(locale, { maximumFractionDigits: 20 }).format(value);
  }
  const negative = value < 0;
  const [whole, frac] = String(Math.abs(value)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Compact axis label: 950 → "950", 12_400 → "12.4k", 4_200_000 → "4.2M".
 *  Display-only rounding — exact values render in tooltips via formatNumber. */
export function compactNumber(value: number, locale: Locale): string {
  const abs = Math.abs(value);
  if (abs < 1000) return formatNumber(value, locale);
  if (locale !== "en") {
    return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  const sign = value < 0 ? "-" : "";
  const scaled = (n: number) => {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  if (abs < 1_000_000) return `${sign}${scaled(abs / 1000)}k`;
  if (abs < 1_000_000_000) return `${sign}${scaled(abs / 1_000_000)}M`;
  return `${sign}${scaled(abs / 1_000_000_000)}B`;
}

/** Whole-percent share of a total, safe on zero totals: (3, 12) → "25%" ("25 %" in Czech). */
export function formatShare(value: number, total: number, locale: Locale): string {
  if (total <= 0) return formatPercent(0, locale);
  return formatPercent(Math.round((value / total) * 100), locale);
}
