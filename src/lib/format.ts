import type { Currency } from "@/types/product";

// Shared display formatters (products list, storefront designer, future
// storefront embed all render prices the same way).

// EUR-primary market, so format with a European English locale for consistent
// grouping between server render and client.
const PRICE_LOCALE = "en-IE";

/** Format a major-unit amount as a currency string, e.g. `formatPrice(9.5, "EUR")` -> "€9.50". */
export function formatPrice(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(PRICE_LOCALE, {
    style: "currency",
    currency,
  }).format(amount);
}

/** Human-readable file size for upload previews, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}
