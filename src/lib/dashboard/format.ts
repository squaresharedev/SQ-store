import { formatPrice } from "@/lib/format";
import type { Currency } from "@/types/product";
import { toCurrency, type MoneyByCurrency } from "./queries";

// Display helpers for dashboard money/dates. Money is ALWAYS integer cents in
// (from the DB) and formatted major units out — never float math on amounts.

/** `1400` + `"EUR"` -> `"€14.00"`. */
export function formatCents(cents: number, currency: string): string {
  return formatPrice(cents / 100, toCurrency(currency));
}

/**
 * Per-currency totals joined for display, e.g. `"€64.00 · US$12.00"`.
 * Returns null when there is nothing to show (caller renders its zero state).
 */
export function formatMoney(money: MoneyByCurrency): string | null {
  const parts = (Object.entries(money) as [Currency, number][])
    // EUR (primary market) first, stable order after.
    .sort(([a], [b]) => (a === b ? 0 : a === "EUR" ? -1 : 1))
    .map(([currency, cents]) => formatCents(cents, currency));
  return parts.length > 0 ? parts.join(" · ") : null;
}

const ORDER_DATE = new Intl.DateTimeFormat("en-IE", {
  day: "numeric",
  month: "short",
});

/** Short order date, e.g. "2 Jul". Server-rendered only (no hydration risk). */
export function formatOrderDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "—" : ORDER_DATE.format(date);
}
