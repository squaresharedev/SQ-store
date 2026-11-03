/**
 * THE KEY TO ONE PREVIEW PAGE, for a browser that has no session: the headless
 * browser that takes a preview's screenshot (lib/agent/preview/snapshot.ts).
 *
 * It names a grant and one record and lives two minutes. The page it opens
 * checks the grant is still live and then reads AS that grant, under row level
 * security, so it can show nothing the assistant could not have read itself.
 * Signed with HMAC under a key DERIVED from the agent signing key (HKDF, its own
 * label): no new secret to manage, and a preview token is no use as a JWT.
 */

/** How long the link a headless browser opens works: long enough to load once. */
export const PREVIEW_TOKEN_SECONDS = 2 * 60;

/** How long the link a preview's view reads works: a look at the result, and a
 *  switch between screens, then a new preview is asked for. */
export const LIVE_PREVIEW_TOKEN_SECONDS = 15 * 60;

export type PreviewSubject = { kind: "storefront"; id: string };

export type PreviewClaims = PreviewSubject & { grantId: string; exp: number };

const encoder = new TextEncoder();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{43}$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

let cached: { raw: string; key: CryptoKey } | null = null;

async function previewKey(): Promise<CryptoKey> {
  const raw = process.env.AGENT_JWT_SIGNING_KEY;
  if (!raw) throw new Error("AGENT_JWT_SIGNING_KEY is not set.");
  if (cached?.raw === raw) return cached.key;
  const jwk = JSON.parse(raw) as JsonWebKey;
  // The key's secret half: an EC key's private scalar, or an HMAC key's bytes.
  const secret = jwk.d ?? jwk.k;
  if (!secret) throw new Error("AGENT_JWT_SIGNING_KEY has no private part.");
  const material = await crypto.subtle.importKey("raw", fromBase64Url(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("square-share agent preview v1") },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  cached = { raw, key };
  return key;
}

export async function mintPreviewToken(
  subject: PreviewSubject,
  grantId: string,
  lifetimeSeconds = PREVIEW_TOKEN_SECONDS,
): Promise<string> {
  const claims: PreviewClaims = {
    ...subject,
    grantId,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  };
  const body = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await previewKey(), encoder.encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

/** The claims of a token this server signed and that has not run out, or null. */
export async function verifyPreviewToken(token: string | null | undefined): Promise<PreviewClaims | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const [body, signature] = token.split(".");
  try {
    const valid = await crypto.subtle.verify("HMAC", await previewKey(), fromBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as PreviewClaims;
    if (claims.kind !== "storefront" || typeof claims.id !== "string" || typeof claims.grantId !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
