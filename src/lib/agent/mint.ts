import type { User } from "@supabase/supabase-js";

/**
 * The user JWT one agent request runs under.
 *
 * WHY MINT AT ALL. Row level security decides who can touch what, and it reads
 * a user's JWT. The assistant's own credential is an opaque token (lib/agent/
 * oauth), deliberately NOT a JWT: a real Supabase token in a client's hands
 * would work directly against the database and ignore every scope. So the
 * token stays a lookup key, and each request gets a short JWT of its own that
 * goes from this server to Supabase and nowhere else.
 *
 * WHY aal2. mfa_session_ok() refuses aal1 for an account with 2FA on. Creating
 * a grant requires that account's second factor (lib/agent/consent-actions.ts),
 * so a grant has passed it; and the actions that demand a FRESH code refuse an
 * agent outright (checkStepUp in lib/auth/mfa.ts), so this cannot stand in for
 * one.
 *
 * THE KEY is a dedicated one, imported into Supabase's signing keys, so
 * revoking it stops agent access and nothing else. Its JWK is the Worker secret
 * AGENT_JWT_SIGNING_KEY. An "oct" JWK signs HS256, which is what the test stack
 * trusts; anything else in production would be a mistake the database refuses.
 */

/** How long a minted JWT lives. Longer than any request, and no longer. */
const JWT_LIFETIME_SECONDS = 5 * 60;

type SigningKey = { key: CryptoKey; alg: "ES256" | "HS256"; kid?: string };

let cached: { raw: string; signing: SigningKey } | null = null;

async function signingKey(): Promise<SigningKey> {
  const raw = process.env.AGENT_JWT_SIGNING_KEY;
  if (!raw) throw new Error("AGENT_JWT_SIGNING_KEY is not set.");
  if (cached?.raw === raw) return cached.signing;

  const jwk = JSON.parse(raw) as JsonWebKey & { kid?: string };
  const signing: SigningKey =
    jwk.kty === "oct"
      ? {
          alg: "HS256",
          kid: jwk.kid,
          key: await crypto.subtle.importKey("jwk", jwk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
        }
      : {
          alg: "ES256",
          kid: jwk.kid,
          key: await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
        };
  cached = { raw, signing };
  return signing;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Sign a user JWT for this request. Throws when no signing key is set. */
export async function mintAgentJwt(user: Pick<User, "id" | "email">, grantId: string): Promise<string> {
  const { key, alg, kid } = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg, typ: "JWT", ...(kid ? { kid } : {}) });
  const payload = encodeJson({
    iss: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
    sub: user.id,
    aud: "authenticated",
    role: "authenticated",
    aal: "aal2",
    email: user.email,
    iat: now,
    exp: now + JWT_LIFETIME_SECONDS,
    is_anonymous: false,
    agent_grant_id: grantId,
  });
  const input = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    alg === "HS256" ? "HMAC" : { name: "ECDSA", hash: "SHA-256" },
    key,
    input,
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}
