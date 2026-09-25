import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { totpCode } from "@/lib/auth/totp";
import {
  base64UrlDecode,
  base64UrlEncode,
  open,
  passkeySealingConfigured,
  seal,
} from "@/lib/auth/passkey-crypto";

/**
 * PASSKEYS AS THE SECOND FACTOR.
 *
 * Each passkey is backed by an ordinary GoTrue TOTP factor whose secret only
 * this server knows (sealed in public.mfa_passkeys, see
 * supabase/migrations/20260925_passkey_factors.sql for why this shape). The
 * browser proves possession of the passkey with a WebAuthn assertion; this
 * module verifies it and then, and only then, computes the factor's current
 * code and hands it to GoTrue, which upgrades the session to aal2 exactly as
 * if the person had typed it. Nothing downstream can tell the difference,
 * which is the point: the app gate, the restrictive RLS and step-up all keep
 * working off aal2 and the `amr` claim.
 *
 * WHAT THE BROWSER NEVER SEES: the TOTP secret (not even sealed) or the
 * factor's code. Each challenge is minted here, bound to the account and the
 * purpose, and spent exactly once:
 *   - registering: the challenge and the pending factor's secret travel in a
 *     sealed, HttpOnly cookie (one setup at a time; the secret stays here);
 *   - signing in and step-up: the challenge travels as a sealed SLIP handed to
 *     the page with the options and posted back with the assertion. Stateless
 *     on purpose: a settings page can show several "confirm with passkey"
 *     boxes at once, and a single cookie would let each one's options
 *     overwrite the others'.
 *
 * SERVER ONLY, and not a "use server" module: the callable actions live in
 * lib/auth/passkey-actions.ts (and step-up in lib/auth/mfa.ts).
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** What the browser shows while asking; also the passkey's label in managers. */
const RP_NAME = "Square Share";

/** Long enough to find a phone and scan a QR code; short enough to be useless later. */
const CEREMONY_TIMEOUT_MS = 3 * 60 * 1000;
const SLIP_SECONDS = 5 * 60;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type RelyingParty = { rpID: string; origins: string[] };

/**
 * Who the passkeys belong to. The origin comes from NEXT_PUBLIC_APP_URL (plus
 * WEBAUTHN_ORIGINS, for a test stack served elsewhere); the RP ID defaults to
 * its hostname, and WEBAUTHN_RP_ID may widen it to a parent domain
 * (production: squareshare.eu, so a passkey outlives a move between
 * subdomains). CHANGING THE RP ID INVALIDATES EVERY PASSKEY: keep it stable.
 */
export function relyingParty(): RelyingParty | null {
  let app: URL;
  try {
    app = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  } catch {
    return null;
  }
  const rpID = process.env.WEBAUTHN_RP_ID?.trim() || app.hostname;
  const extra = (process.env.WEBAUTHN_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = [...new Set([app.origin, ...extra])].filter((origin) => {
    try {
      const host = new URL(origin).hostname;
      return host === rpID || host.endsWith(`.${rpID}`);
    } catch {
      return false;
    }
  });
  return origins.length ? { rpID, origins } : null;
}

/** Whether passkeys can work in this deployment at all (RP + sealing key). */
export async function passkeysConfigured(): Promise<boolean> {
  return relyingParty() !== null && (await passkeySealingConfigured());
}

// ---------------------------------------------------------------------------
// Storage (service role; the table is invisible to every client role)
// ---------------------------------------------------------------------------

type PasskeyRow = {
  id: string;
  factor_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[];
  sealed_secret: string;
  name: string;
};

const TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function knownTransports(values: readonly string[] | undefined): AuthenticatorTransportFuture[] {
  return (values ?? []).filter((value): value is AuthenticatorTransportFuture =>
    TRANSPORTS.has(value as AuthenticatorTransportFuture),
  );
}

/** The sealing context for a stored secret: bound to user AND factor. */
function secretContext(userId: string, factorId: string): string {
  return `passkey-secret:v1:${userId}:${factorId}`;
}

/**
 * The account's passkeys whose GoTrue factor is still verified. A row whose
 * factor is gone cannot exist (the foreign key cascades), but a factor that
 * is not VERIFIED yet must not be offered, so the live list is the filter.
 */
async function livePasskeys(userId: string, verifiedFactorIds: string[]): Promise<PasskeyRow[] | null> {
  if (verifiedFactorIds.length === 0) return [];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("mfa_passkeys")
      .select("id, factor_id, credential_id, public_key, sign_count, transports, sealed_secret, name")
      .eq("user_id", userId)
      .in("factor_id", verifiedFactorIds);
    if (error) {
      console.error("[passkeys] reading passkeys failed:", error.message);
      return null;
    }
    return (data ?? []) as PasskeyRow[];
  } catch (err) {
    console.error("[passkeys] reading passkeys threw:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Challenge slips
// ---------------------------------------------------------------------------

export type PasskeyPurpose = "register" | "sign_in" | "step_up";

type Slip = {
  challenge: string;
  exp: number;
  /** Registration only: the pending factor, its secret, and the chosen name. */
  factorId?: string;
  secret?: string;
  name?: string;
};

function slipCookie(purpose: PasskeyPurpose): string {
  return `ss_webauthn_${purpose}`;
}

/** Bound to purpose AND account: a slip minted for one never opens as another. */
function slipContext(purpose: PasskeyPurpose, userId: string): string {
  return `webauthn-slip:v1:${purpose}:${userId}`;
}

async function writeSlip(purpose: PasskeyPurpose, userId: string, slip: Slip): Promise<boolean> {
  const sealed = await seal(JSON.stringify(slip), slipContext(purpose, userId));
  if (!sealed) return false;
  (await cookies()).set(slipCookie(purpose), sealed, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SLIP_SECONDS,
  });
  return true;
}

/**
 * The registration slip, once: deleted from the cookies as it is read, and
 * opened and spent as in openSlip.
 */
async function takeRegistrationSlip(userId: string): Promise<Slip | null> {
  const jar = await cookies();
  const sealed = jar.get(slipCookie("register"))?.value;
  if (!sealed) return null;
  jar.delete(slipCookie("register"));
  return openSlip("register", userId, sealed);
}

/**
 * A sealed slip opened for `purpose` and account, once: its challenge is
 * recorded as spent, so neither a second submit nor a replayed request can
 * verify against it again. Null for foreign, tampered, expired or spent.
 */
async function openSlip(
  purpose: PasskeyPurpose,
  userId: string,
  sealed: string,
): Promise<Slip | null> {
  if (sealed.length > 4000) return null;
  const plain = await open(sealed, slipContext(purpose, userId));
  if (!plain) return null;
  let slip: Slip;
  try {
    slip = JSON.parse(plain) as Slip;
  } catch {
    return null;
  }
  if (typeof slip.challenge !== "string" || typeof slip.exp !== "number") return null;
  if (slip.exp < Math.floor(Date.now() / 1000)) return null;
  const firstUse = await rateLimitKey(
    `webauthn:${purpose}:${slip.challenge}`,
    "webauthn_challenge",
    RATE_LIMITS.webauthnChallenge,
  );
  return firstUse ? slip : null;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export type PasskeyFailure = "invalid" | "expired" | "unavailable";

/**
 * Options for creating a passkey, for a factor that was JUST enrolled at
 * GoTrue (pending) and whose secret the caller holds. The secret travels to
 * the verify step inside the sealed slip, never through the browser.
 */
export async function registrationOptions(input: {
  user: { id: string; email?: string | null };
  factorId: string;
  secret: string;
  name: string;
  /** Credentials already on the account: the browser refuses to make a
   *  duplicate on an authenticator that holds one of these. */
  excludeCredentialIds: string[];
}): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const rp = relyingParty();
  if (!rp) return null;
  const { user, factorId, secret, name, excludeCredentialIds } = input;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email || user.id,
    userDisplayName: user.email || RP_NAME,
    // The WebAuthn user handle: opaque bytes, never the email (it can change).
    userID: new TextEncoder().encode(user.id),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      // Discoverable where possible, so it shows up (and syncs) in the
      // phone's password manager like any other passkey.
      residentKey: "preferred",
      // Face ID, a fingerprint or the device PIN: possession alone is not
      // enough, the person holding the phone must be able to unlock it.
      userVerification: "required",
    },
  });
  const written = await writeSlip("register", user.id, {
    challenge: options.challenge,
    exp: Math.floor(Date.now() / 1000) + SLIP_SECONDS,
    factorId,
    secret,
    name,
  });
  return written ? options : null;
}

export type NewPasskey = {
  factorId: string;
  secret: string;
  name: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: AuthenticatorTransportFuture[];
  backedUp: boolean;
};

/**
 * Check the browser's new credential against the slip. On success, what to
 * store (storePasskey) and the factor + secret to finish at GoTrue.
 */
export async function verifyRegistration(input: {
  userId: string;
  response: RegistrationResponseJSON;
}): Promise<{ ok: true; passkey: NewPasskey } | { ok: false; reason: PasskeyFailure }> {
  const rp = relyingParty();
  if (!rp) return { ok: false, reason: "unavailable" };
  const slip = await takeRegistrationSlip(input.userId);
  if (!slip?.factorId || !slip.secret || !slip.name) return { ok: false, reason: "expired" };
  try {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: slip.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!result.verified) return { ok: false, reason: "invalid" };
    const { credential, credentialBackedUp } = result.registrationInfo;
    return {
      ok: true,
      passkey: {
        factorId: slip.factorId,
        secret: slip.secret,
        name: slip.name,
        credentialId: credential.id,
        publicKey: base64UrlEncode(credential.publicKey),
        signCount: credential.counter,
        transports: knownTransports(credential.transports ?? input.response.response.transports),
        backedUp: credentialBackedUp,
      },
    };
  } catch (err) {
    // The library throws for every malformed or mismatched response: that is
    // a bad credential, not an outage.
    console.warn("[passkeys] registration refused:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "invalid" };
  }
}

/** Persist a verified passkey, secret sealed. False if it could not be stored. */
export async function storePasskey(userId: string, passkey: NewPasskey): Promise<boolean> {
  const sealed = await seal(passkey.secret, secretContext(userId, passkey.factorId));
  if (!sealed) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("mfa_passkeys").insert({
      user_id: userId,
      factor_id: passkey.factorId,
      credential_id: passkey.credentialId,
      public_key: passkey.publicKey,
      sign_count: passkey.signCount,
      transports: passkey.transports,
      backed_up: passkey.backedUp,
      sealed_secret: sealed,
      name: passkey.name,
    });
    if (error) {
      console.error("[passkeys] storing passkey failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[passkeys] storing passkey threw:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Remove a stored passkey (the setup that made it could not be finished). */
export async function forgetPasskey(userId: string, factorId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("mfa_passkeys").delete().eq("user_id", userId).eq("factor_id", factorId);
  } catch {
    // Best-effort: the foreign key removes it anyway once the factor goes.
  }
}

/** Credential ids already on the account, for excludeCredentials. */
export async function credentialIdsFor(userId: string): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("mfa_passkeys").select("credential_id").eq("user_id", userId);
    return (data ?? []).map((row) => row.credential_id as string);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Authentication (sign-in challenge and step-up)
// ---------------------------------------------------------------------------

export type AuthenticationChallenge = {
  options: PublicKeyCredentialRequestOptionsJSON;
  /** Sealed, account- and purpose-bound; posted back with the assertion. */
  slip: string;
};

/**
 * Options for proving possession of one of the account's passkeys, and the
 * slip that vouches for their challenge. Null when there are none to offer,
 * or passkeys are not configured here.
 */
export async function authenticationOptions(input: {
  userId: string;
  purpose: Exclude<PasskeyPurpose, "register">;
  verifiedFactorIds: string[];
}): Promise<AuthenticationChallenge | null> {
  const rp = relyingParty();
  if (!rp) return null;
  const passkeys = await livePasskeys(input.userId, input.verifiedFactorIds);
  if (!passkeys?.length) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: "required",
    // Named, so the browser offers exactly these (and, on a computer, the
    // "use a phone" QR code for one that lives on a phone).
    allowCredentials: passkeys.map((row) => ({
      id: row.credential_id,
      transports: knownTransports(row.transports),
    })),
  });
  const slip = await seal(
    JSON.stringify({ challenge: options.challenge, exp: Math.floor(Date.now() / 1000) + SLIP_SECONDS }),
    slipContext(input.purpose, input.userId),
  );
  return slip ? { options, slip } : null;
}

/**
 * Verify an assertion from one of the account's OWN live passkeys against its
 * slip for `purpose`. On success, the factor it unlocks and that factor's
 * secret, for completeFactor.
 */
export async function verifyAssertion(input: {
  userId: string;
  purpose: Exclude<PasskeyPurpose, "register">;
  response: AuthenticationResponseJSON;
  slip: string;
  verifiedFactorIds: string[];
}): Promise<{ ok: true; factorId: string; secret: string } | { ok: false; reason: PasskeyFailure }> {
  const rp = relyingParty();
  if (!rp) return { ok: false, reason: "unavailable" };
  const slip = await openSlip(input.purpose, input.userId, input.slip);
  if (!slip) return { ok: false, reason: "expired" };

  const passkeys = await livePasskeys(input.userId, input.verifiedFactorIds);
  if (passkeys === null) return { ok: false, reason: "unavailable" };
  // Looked up among THIS account's passkeys only: a credential registered to
  // anyone else is simply not found, whatever the browser sends.
  const row = passkeys.find((candidate) => candidate.credential_id === input.response.id);
  if (!row) return { ok: false, reason: "invalid" };

  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: slip.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      credential: {
        id: row.credential_id,
        publicKey: base64UrlDecode(row.public_key),
        counter: Number(row.sign_count),
        transports: knownTransports(row.transports),
      },
      requireUserVerification: true,
    });
    if (!result.verified) return { ok: false, reason: "invalid" };
    newCounter = result.authenticationInfo.newCounter;
  } catch (err) {
    console.warn("[passkeys] assertion refused:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "invalid" };
  }

  const secret = await open(row.sealed_secret, secretContext(input.userId, row.factor_id));
  if (!secret) {
    console.error("[passkeys] sealed secret would not open (key changed?)");
    return { ok: false, reason: "unavailable" };
  }

  try {
    const admin = createAdminClient();
    await admin
      .from("mfa_passkeys")
      .update({ sign_count: newCounter, last_used_at: new Date().toISOString() })
      .eq("id", row.id);
  } catch {
    // The counter is a clone detector, not the gate: a missed update only
    // weakens that one heuristic for one use.
  }
  return { ok: true, factorId: row.factor_id, secret };
}

/**
 * Hand GoTrue the factor's current code on the request's own client, which
 * upgrades THIS session to aal2 (auth-js writes the new tokens to the
 * cookies). Only ever called with a secret that a verified passkey unlocked.
 */
export async function completeFactor(
  supabase: ServerClient,
  factorId: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "unavailable" }> {
  try {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      console.warn("[passkeys] challenge failed:", challenge.error?.code, challenge.error?.message);
      return { ok: false, reason: "unavailable" };
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: await totpCode(secret),
    });
    if (verified.error) {
      console.warn("[passkeys] factor verify failed:", verified.error.code, verified.error.message);
      return { ok: false, reason: verified.error.status === 422 ? "invalid" : "unavailable" };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[passkeys] completing factor threw:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "unavailable" };
  }
}

/** Parse the browser's JSON credential, refusing anything oversized. */
export function parseCredential<T>(raw: FormDataEntryValue | null): T | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { id, response, type } = value as { id?: unknown; response?: unknown; type?: unknown };
    if (typeof id !== "string" || !response || typeof response !== "object" || type !== "public-key") {
      return null;
    }
    return value as T;
  } catch {
    return null;
  }
}
