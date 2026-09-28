// SERVER ONLY. Minting a contact code and the one-way form it is stored in.
//
// WHY AN HMAC AND NOT A PLAIN HASH. A code is 8 digits: 10^8 possibilities,
// which a laptop hashes through in seconds. A plain SHA-256 in the table would
// hand anyone with a dump every live code. Keyed with CONTACT_VERIFICATION_KEY
// (a Worker secret that never reaches the database or the browser), the same
// dump is worthless: every guess needs the key.
//
// WHY THE OWNER AND CHANNEL ARE IN THE MAC. So a digest means one thing only.
// A row copied onto another account, or from the email channel to the phone
// one, stops matching instead of proving something it was never issued for.

import { base64UrlDecode } from "@/lib/auth/passkey-crypto";
import { CONTACT_CODE_LENGTH, type ContactChannel } from "@/lib/contact-verification/policy";

const KEY_ENV = "CONTACT_VERIFICATION_KEY";

/** Versioned, so a future change to what is MACed cannot collide with this. */
const MAC_CONTEXT = "squareshare:contact-verification:v1";

const CODE_SPACE = 10 ** CONTACT_CODE_LENGTH;

/**
 * The largest multiple of the code space that fits in 32 bits. Values at or
 * above it are redrawn, so `% CODE_SPACE` is exactly uniform (no digit string
 * is more likely than another).
 */
const UNBIASED_CEILING = Math.floor(2 ** 32 / CODE_SPACE) * CODE_SPACE;

/** A fresh code: CONTACT_CODE_LENGTH digits from the platform CSPRNG. */
export function mintContactCode(): string {
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    if (draw[0] < UNBIASED_CEILING) {
      return String(draw[0] % CODE_SPACE).padStart(CONTACT_CODE_LENGTH, "0");
    }
  }
}

let cached: { raw: string; key: CryptoKey } | null = null;

/** The secret's 32 bytes, or null when it is missing or malformed. */
function keyBytes(): { raw: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) return null;
  try {
    const bytes = base64UrlDecode(raw);
    return bytes.length === 32 ? { raw, bytes } : null;
  } catch {
    return null;
  }
}

/** Whether codes can be stored at all in this deployment. */
export function contactCodeKeyConfigured(): boolean {
  return keyBytes() !== null;
}

/** The MAC key, or null when the secret is missing or not 32 bytes. */
async function macKey(): Promise<CryptoKey | null> {
  const secret = keyBytes();
  if (!secret) return null;
  const { raw, bytes } = secret;
  if (cached?.raw === raw) return cached.key;
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  cached = { raw, key };
  return key;
}

/**
 * The stored form of a code for one account and channel: 64 hex characters,
 * which is exactly what the table's CHECK admits. Null when the key is not
 * configured, which every caller treats as "cannot verify here" (fail closed).
 */
export async function hashContactCode(
  ownerId: string,
  channel: ContactChannel,
  code: string,
): Promise<string | null> {
  const key = await macKey();
  if (!key) return null;
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${MAC_CONTEXT}:${ownerId}:${channel}:${code}`),
  );
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** "12345678" -> "1234 5678": how a code is written in a message. */
export function formatContactCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, "$1 ");
}
