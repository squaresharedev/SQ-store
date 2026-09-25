/**
 * Sealing for the passkey path's two server-side secrets: the TOTP secret a
 * passkey unlocks (stored in public.mfa_passkeys) and the short-lived WebAuthn
 * challenge carried between "get options" and "verify" (an HttpOnly cookie).
 *
 * AES-256-GCM under MFA_PASSKEY_KEY (32 random bytes, base64), a Worker secret
 * that never reaches the browser or the database. The table alone is therefore
 * worthless: a dump of it cannot mint a single code. Every sealed value is
 * bound to its context by GCM's additional data, so a ciphertext copied onto
 * another account's row, or a challenge cookie replayed for another purpose,
 * fails to open instead of meaning something.
 *
 * SERVER ONLY. No key, no passkeys: every caller treats null as "the feature
 * is not configured here" and fails closed.
 */

const KEY_ENV = "MFA_PASSKEY_KEY";

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

let cached: { raw: string; key: CryptoKey } | null = null;

/** The sealing key, or null when MFA_PASSKEY_KEY is missing or not 32 bytes. */
async function sealingKey(): Promise<CryptoKey | null> {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) return null;
  if (cached?.raw === raw) return cached.key;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlDecode(raw);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  cached = { raw, key };
  return key;
}

/** Whether passkeys can work in this deployment at all. */
export async function passkeySealingConfigured(): Promise<boolean> {
  return (await sealingKey()) !== null;
}

/** `plaintext` sealed for `context`, as base64url(iv || ciphertext). */
export async function seal(plaintext: string, context: string): Promise<string | null> {
  const key = await sealingKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return base64UrlEncode(out);
}

/** The plaintext, or null if it was sealed for another context, tampered
 *  with, or under another key. Never throws. */
export async function open(sealed: string, context: string): Promise<string | null> {
  const key = await sealingKey();
  if (!key) return null;
  try {
    const bytes = base64UrlDecode(sealed);
    if (bytes.length < 13) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(0, 12),
        additionalData: new TextEncoder().encode(context),
      },
      key,
      bytes.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
