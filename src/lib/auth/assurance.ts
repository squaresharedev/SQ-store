import type { Factor, User } from "@supabase/supabase-js";

/**
 * How strongly THIS session has proven who it is, read from its access token.
 *
 * Pure on purpose (no request context, no network): lib/auth/session.ts feeds
 * it the user GoTrue just validated plus that same session's access token, and
 * everything that decides "may this session do X?" reads the result. Keeping
 * the rules here means they are unit-tested directly rather than through a
 * mocked Supabase client.
 *
 * WHY THE TOKEN IS TRUSTED. It is only ever decoded AFTER `getUser()` has sent
 * it to GoTrue and had it accepted, so the signature has already been checked
 * by the only party that holds the key. Decoding without that step would be
 * reading a claim anyone can write.
 */

/** Unix seconds. */
type Seconds = number;

/** A second factor the account can actually sign in with. */
export type VerifiedFactor = {
  id: string;
  /** What the person called it, e.g. "Pixel 8". Never empty. */
  name: string;
  type: "totp";
  createdAt: string;
};

export type SessionAssurance = {
  /** The account has at least one VERIFIED second factor (2FA is on). */
  enrolled: boolean;
  /** The session's authenticator assurance level. A missing claim is aal1. */
  level: "aal1" | "aal2";
  /** When this session last passed a second factor, or null if it never has. */
  secondFactorAt: Seconds | null;
  /** When this session last passed a FIRST factor (password, Google, link). */
  signedInAt: Seconds | null;
  /** Verified TOTP factors, oldest first. */
  factors: VerifiedFactor[];
};

/**
 * How long a second-factor check counts as "just now" for sensitive actions
 * (the "sudo" window). Ten minutes: long enough that changing a password and
 * then an email does not ask twice, short enough that a laptop left open at
 * lunch is not a free pass to delete the account.
 */
export const STEP_UP_WINDOW_SECONDS = 10 * 60;

/**
 * Cookie telling the BROWSER when the step-up window now closes, set by the
 * server whenever a step-up code goes through. A UI hint only: it lets the
 * next sensitive form (possibly on another page, under a settings layout that
 * does not re-render on navigation) know not to show a code box it no longer
 * needs. The server never reads it. The window itself lives in the session
 * token's `amr` claim, which the browser can neither read nor forge.
 */
export const STEP_UP_HINT_COOKIE = "ss_step_up_until";

/**
 * How recent a first-factor sign-in must be to count, on its own, as proof of
 * ownership when turning 2FA on (instead of re-typing a password). Someone
 * holding a stolen session could otherwise enrol their OWN phone and lock the
 * owner out, so "you signed in within the last 10 minutes" is the bar: the
 * same length as the step-up window, and short enough that a session left
 * open, or lifted, an hour ago does not qualify. "Confirm with Google" and
 * "Sign in again" both work by resetting this clock.
 */
export const RECENT_SIGN_IN_SECONDS = 10 * 60;

/**
 * AMR methods that are a SECOND factor. GoTrue names TOTP "totp" (older
 * servers) or "mfa/totp"; the other two are listed so a future phone or
 * passkey factor is not mistaken for a first-factor sign-in.
 */
const SECOND_FACTOR_METHODS = new Set([
  "totp",
  "mfa/totp",
  "mfa/phone",
  "mfa/webauthn",
]);

/**
 * The payload of a JWT, or null for anything that is not one. No signature
 * check: see the module comment for why that is correct here and nowhere else.
 */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type AmrEntry = { method: string; timestamp: Seconds };

/** `amr` as {method, timestamp} pairs. GoTrue emits objects; the RFC 8176
 *  string form carries no timestamp, so it can prove nothing about WHEN and is
 *  ignored for every freshness decision. */
function amrEntries(payload: Record<string, unknown> | null): AmrEntry[] {
  const raw = payload?.amr;
  if (!Array.isArray(raw)) return [];
  const entries: AmrEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { method, timestamp } = item as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string") continue;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    entries.push({ method, timestamp });
  }
  return entries;
}

function latest(entries: AmrEntry[]): Seconds | null {
  let best: Seconds | null = null;
  for (const entry of entries) {
    if (best === null || entry.timestamp > best) best = entry.timestamp;
  }
  return best;
}

/** The account's usable TOTP factors, from the user GoTrue returned. */
export function verifiedFactors(user: Pick<User, "factors">): VerifiedFactor[] {
  const factors: Factor[] = user.factors ?? [];
  return factors
    .filter((factor) => factor.status === "verified" && factor.factor_type === "totp")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((factor, index) => ({
      id: factor.id,
      name: factor.friendly_name?.trim() || `Authenticator app ${index + 1}`,
      type: "totp" as const,
      createdAt: factor.created_at,
    }));
}

/**
 * Whether the account has ANY verified second factor, of any type. Wider than
 * `verifiedFactors` on purpose: GoTrue raises the session requirement to aal2
 * for a verified phone or passkey too, and the gate must agree with GoTrue
 * (and with public.mfa_session_ok()) rather than only with the factor types
 * this app knows how to show.
 */
export function hasVerifiedFactor(user: Pick<User, "factors"> | null | undefined): boolean {
  return (user?.factors ?? []).some((factor) => factor.status === "verified");
}

export function assuranceFrom(
  user: Pick<User, "factors">,
  accessToken: string | null | undefined,
): SessionAssurance {
  const payload = decodeJwtPayload(accessToken);
  const entries = amrEntries(payload);
  return {
    enrolled: hasVerifiedFactor(user),
    level: payload?.aal === "aal2" ? "aal2" : "aal1",
    secondFactorAt: latest(entries.filter((e) => SECOND_FACTOR_METHODS.has(e.method))),
    signedInAt: latest(entries.filter((e) => !SECOND_FACTOR_METHODS.has(e.method))),
    factors: verifiedFactors(user),
  };
}

/**
 * The account has 2FA on and this session has not passed it yet. Such a
 * session is treated as NOT SIGNED IN everywhere except the challenge page.
 */
export function needsSecondFactor(assurance: SessionAssurance | null): boolean {
  return Boolean(assurance?.enrolled && assurance.level !== "aal2");
}

/** Now, in the unit the tokens use. */
export function nowSeconds(): Seconds {
  return Math.floor(Date.now() / 1000);
}

/**
 * Has this session passed its second factor within `maxAgeSeconds`?
 * Always false for an account without 2FA (there is nothing to be fresh ON);
 * callers decide separately what such an account needs.
 *
 * A timestamp from the future (clock skew between GoTrue and this Worker) is
 * accepted up to a minute and refused beyond it, so a skewed or forged-looking
 * claim can never extend the window indefinitely.
 */
export function secondFactorIsFresh(
  assurance: SessionAssurance | null,
  maxAgeSeconds: number,
  now: Seconds = nowSeconds(),
): boolean {
  if (!assurance?.enrolled || assurance.level !== "aal2") return false;
  const at = assurance.secondFactorAt;
  if (at === null) return false;
  if (at > now + 60) return false;
  return now - at <= maxAgeSeconds;
}

/**
 * The moment the current sudo window closes, for the UI to know when to start
 * asking for a code. Null when the account has no 2FA (never asks).
 */
export function stepUpFreshUntil(assurance: SessionAssurance | null): Seconds | null {
  if (!assurance?.enrolled) return null;
  if (assurance.level !== "aal2" || assurance.secondFactorAt === null) return 0;
  return assurance.secondFactorAt + STEP_UP_WINDOW_SECONDS;
}

/** Did this session sign in (first factor) within `maxAgeSeconds`? */
export function signedInRecently(
  assurance: SessionAssurance | null,
  maxAgeSeconds: number,
  now: Seconds = nowSeconds(),
): boolean {
  const at = assurance?.signedInAt ?? null;
  if (at === null || at > now + 60) return false;
  return now - at <= maxAgeSeconds;
}
