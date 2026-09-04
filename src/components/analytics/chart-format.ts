import { formatCents, toCurrency } from "@/lib/format/money";
import { formatNumber } from "@/components/charts";

// Money formatters for the chart kit, in the two tiers the kit expects:
// `valueFormatter` (tooltips, legends, the sr-only data table) is EXACT, and
// `axisValueFormatter` is compact, because an axis with "€1,204.50" on every
// tick is unreadable at phone width.
//
// Both go through formatCents / toCurrency, so the page never divides by 100
// in more than one place, the rule the money contract is built on.

/** Exact money from integer cents: 120450 → "€1,204.50". */
export function moneyExact(currency: string) {
  return (cents: number) => formatCents(cents, currency);
}

/** Compact money for axis ticks: 120450 → "€1.2k". Display-only rounding. */
export function moneyCompact(currency: string) {
  const symbol = toCurrency(currency) === "USD" ? "$" : "€";
  return (cents: number) => {
    const units = Math.round(cents / 100);
    if (Math.abs(units) < 1000) return `${symbol}${formatNumber(units)}`;
    const thousands = Math.round(units / 100) / 10;
    return `${symbol}${thousands}k`;
  };
}

/** "1 sale" / "12 sales", used wherever a count needs its noun. */
export function countWithNoun(one: string, many: string) {
  return (value: number) => `${formatNumber(value)} ${value === 1 ? one : many}`;
}
