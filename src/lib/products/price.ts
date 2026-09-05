/**
 * THE SINGLE SOURCE OF PRICE PARSING for Square Share.
 *
 * Two parsers used to live in two files and disagree: the CSV importer accepted
 * "1,50" (correct — a European comma-decimal) while the form rejected it with
 * "Set a price before saving"; the form silently rounded "9.999" to €10.00 via
 * Number("9.999") * 100, while the importer treated it as 9999 cents
 * (thousands interpretation). One file, one algorithm, tested in one place.
 *
 * TWO EXPORTED PARSERS, because the CSV context and the form context genuinely
 * differ in how tolerant they should be:
 *
 *   parsePriceCents    — the TOLERANT version, used by the CSV importer. Treats
 *                        a single separator followed by exactly 3 digits as a
 *                        thousands group ("1,200" = 1200). Re-exported from
 *                        csv.ts so existing callers need no import-path change.
 *
 *   parseFormPriceCents — the STRICT version, used by the product form. Rejects
 *                         3+ fractional digits in any position (a seller typing
 *                         "9.999" made a decimal mistake, not a locale choice).
 *                         Returns a typed PriceParseResult with an error code
 *                         so the form can show a precise, actionable message.
 *
 * WHAT BOTH REJECT:
 *   - Scientific notation ("1e5") and hex ("0xff") — not how anyone writes a
 *     price; Number() silently accepting them was the bug.
 *   - Negative values.
 *
 * WHAT THE FORM PARSER ALSO REJECTS:
 *   - More than 2 fractional digits (after the last separator, when not treated
 *     as a thousands group): "9.999" and "1.505" are both rejected.
 *   - Amounts above PRICE_CENTS_MAX — with a user-facing message in the major
 *     currency unit, not in cents.
 */

import { PRICE_CENTS_MAX } from "@/lib/validation/product";

// ── Tolerant parser (CSV importer) ────────────────────────────────────────────

/**
 * A price cell to integer cents, or null when it is not a valid price.
 *
 * Handles what spreadsheets actually contain: a currency symbol, thousands
 * separators, and either decimal convention ("1,299.00" and "1.299,00" both
 * mean the same money). The rule for telling them apart is the LAST separator
 * present: whichever of "." or "," appears last is the decimal point, because
 * a thousands separator can never be the final one.
 *
 * In addition to the original csv.ts algorithm, this rejects scientific
 * notation and hex notation before any numeric parse.
 */
export function parsePriceCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Scientific and hex notation parse as numbers but are not how anyone writes
  // a price. Reject them before stripping non-numeric characters (stripping
  // first would drop the 'e' from "€1e5" and let it through).
  if (/[eExX]/.test(trimmed)) return null;

  // Keep digits and separators; drop currency symbols, spaces, and the rest.
  const cleaned = trimmed.replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised: string;

  if (lastDot === -1 && lastComma === -1) {
    normalised = cleaned;
  } else {
    const decimalAt = Math.max(lastDot, lastComma);
    const whole = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalAt + 1).replace(/[.,]/g, "");
    // A group of exactly three digits after the last separator with no other
    // separator before it is a thousands group, not cents: "1,200" is 1200.
    normalised =
      fraction.length === 3 && !/[.,]/.test(cleaned.slice(0, decimalAt))
        ? `${whole}${fraction}`
        : `${whole}.${fraction}`;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

// ── Strict parser (product form) ──────────────────────────────────────────────

export type PriceParseError =
  | "empty"
  | "invalid_format"
  | "too_many_decimals"
  | "not_positive"
  | "exceeds_max";

export type PriceParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: PriceParseError };

/**
 * The product form's price parser: locale-flexible but stricter than the CSV
 * importer. No thousands-group interpretation — a form field is interactive and
 * can be corrected, whereas a spreadsheet import has to guess at locale. A
 * seller who wants to list something at €9999 types "9999", not "9,999" or
 * "9.999", and the field can say so rather than silently reinterpreting their
 * input as an amount they did not intend.
 */
export function parseFormPriceCents(raw: string): PriceParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty" };

  // Reject before stripping, so "€1e5" does not survive the currency-symbol
  // strip and then parse as 100000.
  if (/[eExX]/.test(trimmed)) return { ok: false, error: "invalid_format" };

  const cleaned = trimmed.replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return { ok: false, error: "invalid_format" };

  let normalised: string;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (lastDot === -1 && lastComma === -1) {
    // No separator: a whole-number price. "9", "99", "1200" all valid.
    normalised = cleaned;
  } else {
    const decimalAt = Math.max(lastDot, lastComma);
    const whole = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalAt + 1).replace(/[.,]/g, "");

    if (fraction.length > 2) {
      // Any 3+ digit fraction is rejected. The CSV importer treats a single
      // separator + exactly 3 digits as a thousands group, but the form is not
      // an importer: a seller typing "9.999" made a decimal mistake, not a
      // locale choice, and the field should say so rather than silently change
      // the amount they intended.
      return { ok: false, error: "too_many_decimals" };
    }
    normalised = `${whole}.${fraction}`;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false, error: "invalid_format" };
  const cents = Math.round(value * 100);
  if (cents <= 0) return { ok: false, error: "not_positive" };
  if (cents > PRICE_CENTS_MAX) return { ok: false, error: "exceeds_max" };

  return { ok: true, cents };
}

// ── Human-readable error messages ─────────────────────────────────────────────

/**
 * The seller-facing copy for a price parse error. Kept here so the form and
 * any future surface say the same thing for the same problem.
 *
 * `maxCents` is the server's PRICE_CENTS_MAX; `currency` is the ISO code the
 * form is currently set to (for phrasing the ceiling in money, not in cents).
 */
export function priceErrorMessage(
  error: PriceParseError,
  currency: string,
  maxCents: number,
): string {
  switch (error) {
    case "empty":
      return "Set a price before saving.";
    case "invalid_format":
      return "Price must be a number greater than zero.";
    case "too_many_decimals":
      return "Prices can have at most two decimal places.";
    case "not_positive":
      return "Price must be a number greater than zero.";
    case "exceeds_max": {
      const maxMajor = (maxCents / 100).toLocaleString("en", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      return `Price cannot exceed ${currency} ${maxMajor}.`;
    }
  }
}
