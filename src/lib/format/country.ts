import type { Locale } from "@/i18n/locales";
import { EU_COUNTRIES } from "@/lib/settings/constants";

export type EuCountryCode = (typeof EU_COUNTRIES)[number]["code"];
export type EuCountry = { code: EuCountryCode; name: string };

/**
 * Country names in the reader's language. Pure: usable from client and server.
 *
 * Names come from the runtime's own region data (Intl.DisplayNames) rather
 * than the catalogue, so a new language needs no country keys. English keeps
 * the names in EU_COUNTRIES verbatim: those are deliberate choices ("Czechia"),
 * and older ICU data still says "Czech Republic".
 */

const regionNames = new Map<Locale, Intl.DisplayNames | null>();

function regionsFor(locale: Locale): Intl.DisplayNames | null {
  if (locale === "en") return null;
  if (!regionNames.has(locale)) {
    let regions: Intl.DisplayNames | null = null;
    try {
      regions = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    } catch {
      regions = null;
    }
    regionNames.set(locale, regions);
  }
  return regionNames.get(locale) ?? null;
}

/** The printable name of a country we know, or null for a code we do not. */
export function countryName(code: string | null | undefined, locale: Locale): string | null {
  const known = EU_COUNTRIES.find((country) => country.code === code);
  if (!known) return null;
  return regionsFor(locale)?.of(known.code) ?? known.name;
}

const sortedLists = new Map<Locale, readonly EuCountry[]>();

/** The EU member states named in the reader's language, sorted the way that language sorts. */
export function euCountries(locale: Locale): readonly EuCountry[] {
  let list = sortedLists.get(locale);
  if (!list) {
    list = EU_COUNTRIES.map(({ code }) => ({ code, name: countryName(code, locale) ?? code })).sort(
      (a, b) => a.name.localeCompare(b.name, locale),
    );
    sortedLists.set(locale, list);
  }
  return list;
}
