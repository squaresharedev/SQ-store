import { useMemo } from "react";
import { useLocale } from "next-intl";
import { countryName, operatingCountries, type OperatingCountry } from "@/lib/format/country";

export type { OperatingCountry };

/**
 * The countries we operate in, named in the reader's language, sorted the way
 * that language sorts them. The ISO code stays the value everywhere; only the name
 * is localised. The naming itself lives in lib/format/country.ts, shared with
 * the server-rendered product page.
 */
export function useOperatingCountries(): {
  countries: readonly OperatingCountry[];
  countryName: (code: string) => string;
} {
  const locale = useLocale();
  return useMemo(
    () => ({
      countries: operatingCountries(locale),
      countryName: (code: string) => countryName(code, locale) ?? code,
    }),
    [locale],
  );
}
