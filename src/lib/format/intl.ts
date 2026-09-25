import type { Locale } from "@/i18n/locales";

/**
 * THE LOCALE SEAM FOR EVERY DISPLAY FORMATTER.
 *
 * Every formatter in src/lib/format* takes the reader's locale explicitly
 * (`useLocale()` in a component, `await getLocale()` in async server code), so
 * the same function gives the same text on the server and in the browser. A
 * formatter never falls back to the runtime's default locale: that is the
 * server's on the server and the browser's in the browser, which is a hydration
 * mismatch.
 *
 * ENGLISH IS FROZEN. Before this pass each site picked its own English locale
 * ("en-IE" for money and order dates, "en-GB" for long dates, hand-built
 * strings for charts), and specs assert on that output. So each formatter names
 * the English it has always produced, and only the other locales format in
 * their own language.
 *
 * Formatters are memoised per locale and options: constructing an Intl object
 * is far more expensive than using one, and charts format on every tick.
 */

/** The BCP 47 tag to format with: the site's historical English, or the reader's locale. */
export function intlTag(locale: Locale, english: string): string {
  return locale === "en" ? english : locale;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

function memo<T>(cache: Map<string, T>, tag: string, options: object, build: () => T): T {
  const key = `${tag}|${JSON.stringify(options)}`;
  let value = cache.get(key);
  if (!value) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

export function numberFormat(tag: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return memo(numberFormats, tag, options, () => new Intl.NumberFormat(tag, options));
}

export function dateTimeFormat(
  tag: string,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  return memo(dateTimeFormats, tag, options, () => new Intl.DateTimeFormat(tag, options));
}

export function listFormat(tag: string, options: Intl.ListFormatOptions = {}): Intl.ListFormat {
  return memo(listFormats, tag, options, () => new Intl.ListFormat(tag, options));
}

/**
 * A number with exactly `digits` decimals and no grouping, e.g. a rate or an
 * amount in a subtitle. English is `toFixed` verbatim ("2.5"); other locales
 * use their own decimal mark ("2,5").
 */
export function formatFixed(value: number, digits: number, locale: Locale): string {
  if (locale === "en") return value.toFixed(digits);
  return numberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

/**
 * A figure that is ALREADY a percentage (25 means 25%), with `digits`
 * decimals. English keeps the bare "25%" it always had; other locales place
 * the sign and spacing their own way ("25 %" in Czech and German).
 */
export function formatPercent(value: number, locale: Locale, digits = 0): string {
  if (locale === "en") return `${value.toFixed(digits)}%`;
  return numberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

/**
 * Items a person reads as one list, joined the way the reader's language joins
 * a list ("A, B a C" in Czech). English keeps the separator each site has
 * always used, so pass it.
 *
 * `truncated` marks a list the caller cuts short and follows with "and N
 * more": a conjunction before the last shown item would then read as the end
 * of the list, so those join as a plain enumeration instead.
 */
export function formatList(
  items: readonly string[],
  locale: Locale,
  options: { englishSeparator: string; truncated?: boolean },
): string {
  if (locale === "en") return items.join(options.englishSeparator);
  return listFormat(locale, {
    type: options.truncated ? "unit" : "conjunction",
    style: options.truncated ? "short" : "long",
  }).format(items);
}
