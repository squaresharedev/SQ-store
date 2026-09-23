/**
 * Recovery codes: the way back in when the authenticator app is gone.
 *
 * Pure (no request, no database) and WebCrypto only, so it runs unchanged on
 * Cloudflare Workers and under vitest. Storage and spending live in
 * lib/auth/mfa.ts.
 *
 * THE CODES. Ten of them, each 80 bits from the CSPRNG, written as sixteen
 * characters of Crockford base32 in groups of four (`7k2m-9qpx-r4tb-hc0w`).
 * Crockford because it leaves out i, l, o and u, so a code copied by hand off
 * a printout cannot be misread, and normalisation can quietly repair the
 * confusable ones someone types anyway (see normalizeRecoveryCode).
 *
 * THE HASH. sha256("<user id>:<code>"). A slow password hash would buy nothing
 * here: its job is to make guessing a human-chosen secret expensive, and there
 * is no dictionary for 80 random bits to be guessed from. The user id is the
 * salt, so a digest leaked for one account says nothing about any other.
 */

/** Crockford's base32 alphabet, lowercased. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export const RECOVERY_CODE_COUNT = 10;

/** 16 base32 characters = 80 bits. */
const CODE_LENGTH = 16;

/** Below this many unused codes, the settings page asks for a fresh set. */
export const RECOVERY_CODES_LOW = 3;

function randomCode(): string {
  // 10 bytes = 80 bits = exactly 16 five-bit groups, so no bias and no waste.
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    // Only the low `bits` bits are ever read, and `bits` never exceeds 12,
    // so the mask keeps the accumulator small without losing anything.
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** `abcdefgh...` -> `abcd-efgh-...`, the form people are shown. */
export function formatRecoveryCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join("-") ?? normalized;
}

/** A fresh set, formatted for display. Never persisted in this form. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  // A collision inside one set is a 1-in-2^76 event; the loop is there so the
  // set is guaranteed distinct rather than overwhelmingly likely to be.
  while (codes.size < count) codes.add(randomCode());
  return Array.from(codes, formatRecoveryCode);
}

/**
 * What was typed, reduced to the canonical 16 characters, or null if it cannot
 * be a recovery code at all (in which case it never costs a database lookup).
 *
 * Forgiving about everything a person might reasonably do to a code: spaces,
 * dashes, capitals, and the four letters Crockford leaves out, which map onto
 * the digits they are usually mistaken for (i/l -> 1, o -> 0). A `u` has no
 * such twin and is refused.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

/** The stored form: hex sha256 of "<userId>:<normalized code>". */
export async function hashRecoveryCode(userId: string, normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${userId}:${normalized}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
