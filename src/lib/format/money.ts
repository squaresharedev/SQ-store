// THE single cents→display formatter for the product UI (client-safe).
// The dashboard formatter delegates here. Money is integer cents everywhere
// else; the division cents→major units happens ONLY inside formatCents below.

import type { Locale } from "@/i18n/locales";
import { ENGLISH_PRICE_LOCALE, formatPrice } from "@/lib/format";
import { intlTag, numberFormat } from "@/lib/format/intl";
import type { Currency } from "@/types/product";

/** Normalise an arbitrary currency string to a known Currency token.
 *  "USD" → "USD"; anything else → "EUR" (primary market). */
export function toCurrency(value: string): Currency {
  return value === "USD" ? "USD" : "EUR";
}

/** Format an integer cents amount as a display string, e.g. `1400, "EUR", "en"` → `"€14.00"`
 *  (`"14,00 €"` in Czech). The currency comes from the data; only its presentation follows the locale.
 *
 *  `wholeUnits` drops the ".00" from a whole amount ("€15", but still "€12.50"), for headline
 *  prices such as a plan's; amounts on orders and receipts keep their cents. */
export function formatCents(
  amountCents: number,
  currency: string,
  locale: Locale,
  options: { wholeUnits?: boolean } = {},
): string {
  if (options.wholeUnits && amountCents % 100 === 0) {
    return numberFormat(intlTag(locale, ENGLISH_PRICE_LOCALE), {
      style: "currency",
      currency: toCurrency(currency),
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amountCents / 100);
  }
  return formatPrice(amountCents / 100, toCurrency(currency), locale);
}

/** The bare sign for a currency ("€" for EUR), or the code where there is no narrow sign. */
export function currencySymbol(currency: string, locale: Locale): string {
  try {
    return (
      numberFormat(intlTag(locale, ENGLISH_PRICE_LOCALE), {
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

/**
 * Whether the currency sign goes BEFORE the number in this language ("€1,000"
 * in English) or after it ("1 000 €" in Czech or German): where a field that
 * shows the sign beside its digits should put it.
 */
export function currencySymbolLeads(currency: string, locale: Locale): boolean {
  try {
    const parts = numberFormat(intlTag(locale, ENGLISH_PRICE_LOCALE), { style: "currency", currency }).formatToParts(1);
    return parts.findIndex((part) => part.type === "currency") < parts.findIndex((part) => part.type === "integer");
  } catch {
    return true;
  }
}

/** A whole number grouped the reader's way ("10,000", "10 000"), no sign. */
export function formatWholeNumber(value: number, locale: Locale): string {
  return numberFormat(intlTag(locale, ENGLISH_PRICE_LOCALE), { maximumFractionDigits: 0 }).format(value);
}
