/**
 * RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second steps): the algorithm GoTrue
 * checks authenticator codes with.
 *
 * SERVER ONLY. The only caller is the passkey path (lib/auth/passkeys.ts):
 * each passkey is backed by a GoTrue TOTP factor whose secret the SERVER holds,
 * sealed, and only a verified passkey assertion makes the server compute the
 * current code and hand it to GoTrue. Web Crypto rather than node:crypto so it
 * runs unchanged on the Cloudflare Worker.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

/** RFC 4648 base32 (the form an otpauth:// secret takes), no padding needed. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("not base32");
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The code for time step `step` (default: now). */
export async function totpCode(
  secret: string,
  step: number = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}
