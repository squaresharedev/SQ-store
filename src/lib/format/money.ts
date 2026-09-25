// THE single cents→display formatter for the product UI (client-safe).
// The dashboard formatter delegates here. Money is integer cents everywhere
// else; the division cents→major units happens ONLY inside formatCents below.

import type { Locale } from "@/i18n/locales";
import { formatPrice } from "@/lib/format";
import { intlTag, numberFormat } from "@/lib/format/intl";
import type { Currency } from "@/types/product";

/** Normalise an arbitrary currency string to a known Currency token.
 *  "USD" → "USD"; anything else → "EUR" (primary market). */
export function toCurrency(value: string): Currency {
  return value === "USD" ? "USD" : "EUR";
}

/** Format an integer cents amount as a display string, e.g. `1400, "EUR", "en"` → `"€14.00"`
 *  (`"14,00 €"` in Czech). The currency comes from the data; only its presentation follows the locale. */
export function formatCents(amountCents: number, currency: string, locale: Locale): string {
  return formatPrice(amountCents / 100, toCurrency(currency), locale);
}

/** The bare sign for a currency ("€" for EUR), or the code where there is no narrow sign. */
export function currencySymbol(currency: string, locale: Locale): string {
  try {
    return (
      numberFormat(intlTag(locale, "en-IE"), {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}
