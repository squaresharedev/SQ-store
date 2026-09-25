import { useMemo } from "react";
import { useLocale } from "next-intl";
import { countryName, euCountries, type EuCountry } from "@/lib/format/country";

export type { EuCountry };

/**
 * The EU member states named in the reader's language, sorted the way that
 * language sorts them. The ISO code stays the value everywhere; only the name
 * is localised. The naming itself lives in lib/format/country.ts, shared with
 * the server-rendered product page.
 */
export function useEuCountries(): {
  countries: readonly EuCountry[];
  countryName: (code: string) => string;
} {
  const locale = useLocale();
  return useMemo(
    () => ({
      countries: euCountries(locale),
      countryName: (code: string) => countryName(code, locale) ?? code,
    }),
    [locale],
  );
}
