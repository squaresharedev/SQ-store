import type { ValidationKey } from "@/lib/validation/messages";

/**
 * "Is this plausibly a real postal address?": the checks that cost nothing and
 * need no network, for the trader address printed on every product page.
 *
 * WHAT IT CAN AND CANNOT DO. Unlike an email or a phone, a postal address
 * cannot be PROVEN from here: that takes a letter with a code in it, or a
 * paid address-validation service. What this catches is what gets typed to
 * get past a required field: a placeholder, a keyboard mash, a single word.
 *
 * ONLY THE UNAMBIGUOUS. Real addresses are short ("PO Box 12", "1010 Wien"),
 * one-line ("Kaiserweg 12"), digit-free (rural Ireland, named houses) and
 * written in every script, and the publish gate re-runs this on every read, so
 * a false positive does not just refuse a save, it takes a live seller's pages
 * down. Every rule here must be one no real address can trip. Anything short
 * of that is the trader's legal duty to get right, not a guess this makes.
 */

/**
 * Words and phrases that mean "not a real address". Matched as whole words on
 * a lowercased copy, so "Fakenham" (a real town) and "Testerton" survive
 * while "123 Fake Street" does not. No bare labels ("business address"):
 * a seller pasting "Business address: Hauptstraße 5" means the address.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\bfake\b/,
  /\blorem\b/,
  /\bipsum\b/,
  /\bplaceholder\b/,
  /\bexample\b/,
  /\bsample (street|road|address)\b/,
  /\btest (street|road|avenue|lane|address)\b/,
  /\baddress here\b/,
  /\b(asdf|qwerty|qwertz|azerty|zxcv|hjkl)\w*/,
  // The German, Austrian and Swiss form-filler: Max Mustermann, Musterstraße 1.
  /\bmuster(stra(ss|ß)e|str|weg|gasse|stadt|dorf|hausen|mann|frau)\b/,
  /^(n\/?a|none|null|nil|nothing|unknown|tbd|tbc|test|address|street|-+|\.+|x+)$/,
];

/**
 * At most this many distinct letters in the whole address is a mash
 * ("aaaa", "xx yy"). Deliberately tiny: "PO Box 12" has four and is real.
 */
const MASH_MAX_DISTINCT_LETTERS = 2;

/** The one sync verdict: null to accept, or the key of the message to show. */
export function addressQualityProblem(address: string): ValidationKey | null {
  const text = address.trim().toLowerCase().normalize("NFC");
  if (!text) return null; // Presence is the publish gate's question, not this one's.

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
    return "Validation.address.placeholder";
  }

  const letters = new Set(text.match(/\p{L}/gu) ?? []);
  if (letters.size <= MASH_MAX_DISTINCT_LETTERS) return "Validation.address.placeholder";

  // One word and no number at all ("Dublin", "Home") names a place, not an
  // address. Two words, or a single word with a number in it, is accepted.
  const words = text.split(/[\s,;]+/).filter(Boolean);
  if (words.length < 2 && !/\d/.test(text)) return "Validation.address.incomplete";
  return null;
}
