/**
 * Credentials for the OAuth server, in one place.
 *
 * A credential is 32 random bytes behind a short prefix, which tells a person
 * reading a log (and a secret scanner) what it is. Only its SHA-256 is stored:
 * these have full entropy, so a slow hash would add nothing.
 */
export const ACCESS_TOKEN_PREFIX = "sqa_";
export const REFRESH_TOKEN_PREFIX = "sqr_";
export const AUTH_CODE_PREFIX = "sqc_";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomCredential(prefix: string): string {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A verifier's S256 challenge (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** RFC 7636: 43 to 128 unreserved characters. */
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url SHA-256: exactly 43 characters. */
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isPkceVerifier(value: string): boolean {
  return PKCE_VERIFIER_PATTERN.test(value);
}

export function isPkceChallenge(value: string): boolean {
  return PKCE_CHALLENGE_PATTERN.test(value);
}
