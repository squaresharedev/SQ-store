// THE single cents→display formatter for the product UI (client-safe).
// The dashboard formatter delegates here. Money is integer cents everywhere
// else; the division cents→major units happens ONLY inside formatCents below.

import { formatPrice } from "@/lib/format";
import type { Currency } from "@/types/product";

/** Normalise an arbitrary currency string to a known Currency token.
 *  "USD" → "USD"; anything else → "EUR" (primary market). */
export function toCurrency(value: string): Currency {
  return value === "USD" ? "USD" : "EUR";
}

/** Format an integer cents amount as a display string, e.g. `1400, "EUR"` → `"€14.00"`. */
export function formatCents(amountCents: number, currency: string): string {
  return formatPrice(amountCents / 100, toCurrency(currency));
}
