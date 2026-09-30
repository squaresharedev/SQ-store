// Verifying that a webhook request really came from Stripe.
//
// Stripe signs `<timestamp>.<raw body>` with HMAC-SHA256 under the endpoint's
// signing secret and sends `Stripe-Signature: t=<timestamp>,v1=<hex>[,v1=...]`.
// A request is genuine when one of its v1 signatures matches ours AND its
// timestamp is recent (a captured request replayed later fails the second
// check even though its signature is real).
//
// WebCrypto only (crypto.subtle), so it runs the same on Workers, in Node and
// in tests. Pure: the secret and the clock are arguments.

/** How far a signature's timestamp may be from now: Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings in time that depends only on their length. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Check a `Stripe-Signature` header against the raw request body.
 *
 * `secrets` may hold more than one signing secret (comma-separated in the
 * env): while a secret is being rotated, Stripe signs with both, and either
 * one verifying is enough.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secrets: readonly string[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SignatureCheck> {
  if (!header || secrets.length === 0) return { ok: false, reason: "missing" };

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim() ?? "");
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const payload = `${timestamp}.${rawBody}`;
  for (const secret of secrets) {
    const expected = await hmacHex(secret, payload);
    if (signatures.some((candidate) => constantTimeEqual(candidate, expected))) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

/** The signing secrets from STRIPE_WEBHOOK_SECRET (comma-separated for rotation). */
export function webhookSecrets(): string[] {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}
