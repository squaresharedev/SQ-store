// Display formatting for plans and fees. Client-safe, locale explicit (see
// lib/format/intl.ts for why every formatter takes the locale).

import type { Locale } from "@/i18n/locales";
import { formatPercent } from "@/lib/format/intl";

/**
 * A fee rate in basis points as a percentage, with only the decimals it
 * needs: 300 -> "3%", 150 -> "1.5%", 125 -> "1.25%" (localised: "3 %" in
 * German and Czech).
 */
export function formatFeeRate(bps: number, locale: Locale): string {
  const digits = bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2;
  return formatPercent(bps / 100, locale, digits);
}
