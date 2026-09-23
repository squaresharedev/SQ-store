/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30-second steps): the algorithm GoTrue and
 * every authenticator app use. Shared by the e2e stack's mock GoTrue (which
 * checks codes) and the Playwright specs (which play the part of the phone),
 * so both sides compute codes exactly the same way. Test infrastructure only.
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

/** RFC 4648 base32, no padding: the form an otpauth:// secret takes. */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`not base32: ${char}`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 (32 characters), like GoTrue mints. */
export function newSecret() {
  return base32Encode(randomBytes(20));
}

function hotp(key, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

/** The time step `ms` falls in. */
export function stepAt(ms = Date.now()) {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** The code for a given step (default: now). */
export function totp(secret, step = stepAt()) {
  return hotp(base32Decode(secret), step);
}

/** GoTrue's rule: the current step, or one either side. */
export function totpValid(secret, code, ms = Date.now()) {
  if (!/^[0-9]{6}$/.test(String(code))) return false;
  const key = base32Decode(secret);
  const step = stepAt(ms);
  return [step - 1, step, step + 1].some((s) => hotp(key, s) === code);
}
