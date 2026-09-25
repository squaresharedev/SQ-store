/**
 * The UI languages this app ships, and the pure helpers that narrow untrusted
 * input to one of them.
 *
 * Importable from client and server: no cookies, no headers, no secrets. The
 * request-scoped resolution (cookie, then Accept-Language) lives in
 * `./request.ts`; this module only knows what a valid locale IS.
 *
 * Adding a language: add the code here and its name to LOCALE_NAMES, then add
 * `messages/<code>/` with every namespace file. The parity test fails until
 * every key exists in the new locale.
 *
 * A code is a full BCP 47 tag whenever the bare language would mean the wrong
 * variety. Portuguese is `pt-PT`: plain `pt` is Brazilian to every Intl API,
 * which counts 0 as singular and prints "€ 1.234,50" where Portugal writes
 * "1234,50 €".
 */

export const LOCALES = [
  "en",
  "cs",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "pl",
  "pt-PT",
  "sk",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Each language named in ITSELF, never translated. A reader who cannot read the
 * current UI language must still be able to find their own in the list.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  "pt-PT": "Português",
  sk: "Slovenčina",
};

/** Narrow a cookie value, form field or DB column to a supported locale. */
export function parseLocale(value: unknown): Locale | null {
  return typeof value === "string"
    ? (LOCALES.find((locale) => locale === value) ?? null)
    : null;
}

/** The shipped locale for a bare language subtag ("pt" is "pt-PT"), or null. */
function localeForLanguage(language: string | undefined): Locale | null {
  if (!language) return null;
  return LOCALES.find((locale) => locale.split("-")[0] === language) ?? null;
}

/**
 * Longest Accept-Language header worth reading. Real browsers send well under
 * 200 bytes; anything past this is either a bot or an attempt to make the
 * parser work, and the first few preferences are all that ever decide.
 */
const MAX_ACCEPT_LANGUAGE = 512;

/**
 * Pick the best supported locale from an Accept-Language header, or null when
 * none of the browser's preferences is one we ship.
 *
 * Matches on the primary language (`cs-CZ` means `cs`, and `pt`, `pt-BR` and
 * `pt-PT` all mean `pt-PT`, the one Portuguese shipped), honours q-values, and
 * treats `q=0` as "not acceptable" per RFC 9110.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .slice(0, MAX_ACCEPT_LANGUAGE)
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        locale: localeForLanguage(tag.split("-")[0]?.toLowerCase()),
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((entry) => entry.locale !== null && entry.weight > 0)
    // Stable on ties: the header's own order breaks them.
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  return ranked[0]?.locale ?? null;
}
