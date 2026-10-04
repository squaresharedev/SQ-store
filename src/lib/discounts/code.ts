import { DISCOUNT_CODE_MAX, DISCOUNT_CODE_MIN } from "@/types/discount";

/**
 * DISCOUNT CODES: their shape, how a typed one is read, and how a new one is
 * made. Client-safe.
 *
 * Letters, digits, `-` and `_`, starting with a letter or digit, upper case.
 * Narrow on purpose: a code is said out loud, typed on a phone and printed in
 * a caption, so it holds nothing that looks like something else (no spaces,
 * no lookalike Unicode), and one store's "summer10" and "SUMMER10" are the
 * same code. Mirrors the discounts_code_shape and orders_discount_code_shape
 * CHECKs.
 */
export const DISCOUNT_CODE_PATTERN = new RegExp(
  `^[A-Z0-9][A-Z0-9_-]{${DISCOUNT_CODE_MIN - 1},${DISCOUNT_CODE_MAX - 1}}$`,
);

/** How a typed code is read: surrounding spaces dropped, case folded. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Whether `value` (already normalised) is a code's shape. */
export function isDiscountCode(value: string): boolean {
  return DISCOUNT_CODE_PATTERN.test(value);
}

/** No 0/O or 1/I: a generated code gets read off a screen and typed back.
 *  32 characters, so a random byte maps onto it without bias (256 / 32 = 8). */
const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A fresh random code, for the form's Generate button. */
export function generateDiscountCode(
  length = 8,
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) code += GENERATED_ALPHABET[byte % GENERATED_ALPHABET.length];
  return code;
}
