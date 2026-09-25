import type { Locale } from "@/i18n/locales";
import { formatCents, toCurrency } from "@/lib/format/money";
import { numberFormat } from "@/lib/format/intl";
import { formatNumber } from "@/components/charts";

// Money formatters for the chart kit, in the two tiers the kit expects:
// `valueFormatter` (tooltips, legends, the sr-only data table) is EXACT, and
// `axisValueFormatter` is compact, because an axis with "€1,204.50" on every
// tick is unreadable at phone width.
//
// Both go through formatCents / toCurrency, so the page never divides by 100
// in more than one place, the rule the money contract is built on.

/** Exact money from integer cents: 120450 → "€1,204.50". */
export function moneyExact(currency: string, locale: Locale) {
  return (cents: number) => formatCents(cents, currency, locale);
}

/** Compact money for axis ticks: 120450 → "€1.2k" ("1,2 tis. €" in Czech). Display-only rounding. */
export function moneyCompact(currency: string, locale: Locale) {
  const code = toCurrency(currency);
  if (locale !== "en") {
    const whole = numberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    });
    const compact = numberFormat(locale, {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return (cents: number) => {
      const units = Math.round(cents / 100);
      if (Math.abs(units) < 1000) return whole.format(units);
      return compact.format((Math.round(units / 100) / 10) * 1000);
    };
  }
  const symbol = code === "USD" ? "$" : "€";
  return (cents: number) => {
    const units = Math.round(cents / 100);
    if (Math.abs(units) < 1000) return `${symbol}${formatNumber(units, locale)}`;
    const thousands = Math.round(units / 100) / 10;
    return `${symbol}${thousands}k`;
  };
}
