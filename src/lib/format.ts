import type { Locale } from "@/i18n/locales";
import { formatFixed, intlTag, numberFormat } from "@/lib/format/intl";
import type { Currency } from "@/types/product";

// Shared display formatters (products list, storefront designer, future
// storefront embed all render prices the same way).

// English formats with a European English locale (EUR-primary market); every
// other language formats in its own.
const ENGLISH_PRICE_LOCALE = "en-IE";

/** Format a major-unit amount as a currency string, e.g. `formatPrice(9.5, "EUR", "en")` -> "€9.50". */
export function formatPrice(amount: number, currency: Currency, locale: Locale): string {
  return numberFormat(intlTag(locale, ENGLISH_PRICE_LOCALE), {
    style: "currency",
    currency,
  }).format(amount);
}

/** Human-readable file size for upload previews, e.g. "1.4 MB" ("1,4 MB" in Czech). */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${formatFixed(value, value < 10 ? 1 : 0, locale)} ${units[unitIndex]}`;
}
