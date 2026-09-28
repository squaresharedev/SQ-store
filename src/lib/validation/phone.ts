// SERVER ONLY (it carries libphonenumber's full metadata, which has no business
// in a browser bundle). The seller's buyer-facing phone number: is it a real,
// textable number we are allowed to text, and what is its one canonical form?
//
// WHY THIS IS STRICTER THAN "LOOKS LIKE DIGITS". A phone number on a product
// page is a promise to a buyer that someone answers it, and the only way this
// platform can keep that promise is to text a code to it and have the seller
// type it back (lib/contact-verification). So a number is accepted only if
// that proof is possible at all:
//
//   * it exists in its country's numbering plan (libphonenumber's full ranges,
//     which also refuse reserved fiction such as the UK's 07700 900xxx);
//   * it can receive a text (mobile, or a plan where mobile and fixed line
//     cannot be told apart), since a landline could never be proven and would
//     never be shown;
//   * it is in SMS_REGIONS, the SMS-pumping fence (see policy.ts).
//
// Stored as E.164 ("+353871234567"): one spelling per number, so "is this the
// number the code went to" is a string comparison, in SQL and here alike.

import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import { SMS_REGIONS } from "@/lib/contact-verification/policy";
import type { ValidationKey } from "@/lib/validation/messages";

/** Number types a text message can reach. */
const TEXTABLE_TYPES: ReadonlySet<string> = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

export type PhoneCheck =
  | { ok: true; e164: string }
  | { ok: false; problem: ValidationKey };

/** "0044 20…" is how much of Europe dials abroad; libphonenumber wants "+". */
function internationalPrefix(raw: string): string {
  return raw.trim().replace(/^00(?=[1-9])/, "+");
}

/**
 * Normalise a typed number to E.164, or say why it cannot be a seller's
 * contact number.
 *
 * `defaultRegion` (the seller's country) lets "087 123 4567" mean an Irish
 * mobile. Without one, only an international number ("+353 …") can be read,
 * because the same national digits are a different number in every country.
 */
export function normalizeSellerPhone(
  raw: string,
  defaultRegion?: string | null,
): PhoneCheck {
  const typed = internationalPrefix(raw);
  const region =
    defaultRegion && isSupportedCountry(defaultRegion)
      ? (defaultRegion as CountryCode)
      : undefined;
  if (!typed.startsWith("+") && !region) {
    return { ok: false, problem: "Validation.phone.needsCountryCode" };
  }

  const parsed = parsePhoneNumberFromString(typed, region);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, problem: "Validation.phone.invalid" };
  }
  if (!parsed.country || !SMS_REGIONS.has(parsed.country)) {
    return { ok: false, problem: "Validation.phone.unsupportedRegion" };
  }
  const type = parsed.getType();
  if (!type || !TEXTABLE_TYPES.has(type)) {
    return { ok: false, problem: "Validation.phone.notMobile" };
  }
  return { ok: true, e164: parsed.number };
}

/**
 * How a stored number is shown to a person: "+353 87 123 4567". Anything that
 * does not parse (a value saved before numbers were normalised) is shown as
 * it was typed rather than hidden from its own owner.
 */
export function formatPhoneInternational(stored: string): string {
  return parsePhoneNumberFromString(stored)?.formatInternational() ?? stored;
}
