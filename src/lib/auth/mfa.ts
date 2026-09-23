import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import {
  alertSecurityEvent,
  recordSecurityEvent,
  type SecurityEvent,
} from "@/lib/security/events";
import { getSessionState } from "@/lib/auth/session";
import {
  STEP_UP_HINT_COOKIE,
  STEP_UP_WINDOW_SECONDS,
  secondFactorIsFresh,
  type SessionAssurance,
} from "@/lib/auth/assurance";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/auth/recovery-codes";
import {
  RECOVERY_CODE_INPUT_MAX,
  factorIdSchema,
  totpCodeSchema,
} from "@/lib/validation/mfa";

// SERVER ONLY, and deliberately NOT a "use server" module: nothing in here is
// meant to be callable from the browser. The actions that are live in
// lib/auth/mfa-actions.ts and call into this.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Verifying a code
// ---------------------------------------------------------------------------

export type SecondFactorFailure = "invalid" | "rate_limited" | "replayed" | "unavailable";

/** What each failure tells the person. None of them reveals anything about
 *  the account beyond what the person typing already knows. */
export const SECOND_FACTOR_MESSAGES: Record<SecondFactorFailure, string> = {
  invalid: "That code didn't work. Check your authenticator app and try again.",
  rate_limited: "Too many attempts. Wait a few minutes, then try again.",
  replayed: "That code has already been used. Wait for the next one in your app.",
  unavailable: "We couldn't check that code just now. Try again in a moment.",
};

/**
 * Take one second-factor attempt from every budget that covers it. Sequential
 * and short-circuiting, so a request refused by the short window does not also
 * spend the day's allowance.
 */
async function takeVerifyBudget(userId: string): Promise<boolean> {
  const account = `mfa:${userId}`;
  if (!(await rateLimitKey(account, "mfa_verify_user", RATE_LIMITS.mfaVerifyPerUser))) {
    return false;
  }
  if (!(await rateLimitKey(account, "mfa_verify_user_day", RATE_LIMITS.mfaVerifyPerUserDaily))) {
    return false;
  }
  const who = await clientKey(await headers());
  return rateLimitKey(who, "mfa_verify_client", RATE_LIMITS.mfaVerifyPerClient);
}

/**
 * The account is out of attempts at the SIGN-IN challenge, which means
 * someone who knows the password is guessing codes. Worth telling the owner,
 * by email, once an hour at most however long it goes on.
 */
async function alertLockout(userId: string, email: string | null | undefined): Promise<void> {
  const firstThisHour = await rateLimitKey(
    `mfa-lockout:${userId}`,
    "mfa_lockout_alert",
    RATE_LIMITS.mfaLockoutAlert,
  );
  if (!firstThisHour) return;
  await alertSecurityEvent(userId, "mfa.locked_out", {
    title: "Someone is trying to sign in to your account",
    body: "Your password was entered correctly, followed by too many wrong two-factor codes, so sign-in has been paused for a few minutes. If this wasn't you, your password is known to someone else: change it now.",
    href: "/settings/account#password",
    emailTo: email,
  });
}

/**
 * Check a six-digit code against one of the account's factors, on the
 * request's own Supabase client. On success GoTrue re-issues the session with
 * a fresh second-factor timestamp (aal2), and auth-js writes it to the
 * cookies: that IS the upgrade, so callers must use this same client
 * afterwards.
 *
 * Order matters and each step is a reason:
 *   1. budgets first, so a flood is refused before GoTrue is asked anything;
 *   2. the replay guard, so a code already accepted once cannot be accepted
 *      again inside GoTrue's ~90 second acceptance window;
 *   3. challenge + verify at GoTrue, which holds the secret.
 */
/**
 * Spend one second-factor attempt (an authenticator code OR a recovery code:
 * one shared budget, so neither is a way around the limit on the other).
 * False when the account or client is out of attempts; at the sign-in
 * challenge that also alerts the owner.
 */
export async function takeSecondFactorAttempt(
  userId: string,
  email: string | null | undefined,
  context: "sign_in" | "step_up" | "setup",
): Promise<boolean> {
  if (await takeVerifyBudget(userId)) return true;
  if (context === "sign_in") await alertLockout(userId, email);
  return false;
}

export async function verifySecondFactor(input: {
  supabase: ServerClient;
  userId: string;
  email?: string | null;
  factorId: string;
  code: string;
  /** "sign_in" failures are the ones that mean a password is compromised, so
   *  only they are logged and alerted on. */
  context: "sign_in" | "step_up" | "setup";
}): Promise<{ ok: true } | { ok: false; reason: SecondFactorFailure }> {
  const { supabase, userId, email, factorId, code, context } = input;

  if (!(await takeSecondFactorAttempt(userId, email, context))) {
    return { ok: false, reason: "rate_limited" };
  }

  const fresh = await rateLimitKey(
    `mfa-code:${userId}:${code}`,
    "mfa_code_replay",
    RATE_LIMITS.mfaCodeReplay,
  );
  if (!fresh) return { ok: false, reason: "replayed" };

  try {
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      console.warn("[mfa] challenge failed:", challenge.error?.code, challenge.error?.message);
      return { ok: false, reason: failureFrom(challenge.error) };
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (verified.error) {
      const reason = failureFrom(verified.error);
      if (reason === "invalid" && context === "sign_in") {
        await recordSecurityEvent({ userId, event: "mfa.challenge_failed" });
      }
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[mfa] verify threw:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "unavailable" };
  }
}

function failureFrom(error: { code?: string; status?: number } | null | undefined): SecondFactorFailure {
  if (!error) return "unavailable";
  if (error.code === "over_request_rate_limit" || error.status === 429) return "rate_limited";
  if (
    error.code === "mfa_verification_failed" ||
    error.code === "mfa_challenge_expired" ||
    error.code === "mfa_factor_not_found" ||
    error.code === "mfa_verification_rejected" ||
    error.status === 400 ||
    error.status === 422
  ) {
    return "invalid";
  }
  return "unavailable";
}

// ---------------------------------------------------------------------------
// Step-up ("sudo") for sensitive actions
// ---------------------------------------------------------------------------

/**
 * The form fields a step-up adds to any sensitive form. Every action that calls
 * requireStepUp must allow these in its field whitelist.
 */
export const STEP_UP_FIELDS = ["mfa_code", "mfa_factor_id"] as const;

export type StepUpRefusal = {
  error: string;
  /** Tells the form to show (or keep showing) its code field. */
  stepUp?: true;
};

/**
 * Gate a sensitive action on a RECENT second factor, for accounts with 2FA.
 * Returns null when the action may go ahead, or the state to return from it.
 *
 * - No 2FA on the account: null. Whatever the action already asks for (a
 *   password, a typed confirmation) is still its own business.
 * - Second factor passed within `maxAgeSeconds`: null.
 * - Otherwise a code must come WITH this request (`mfa_code`), and is checked
 *   exactly like the sign-in challenge: same budgets, same replay guard.
 *
 * `maxAgeSeconds: 0` demands a code in this very request, whatever happened a
 * minute ago. Used for the 2FA settings themselves: turning the protection off
 * must take the protection, never just a session that once had it.
 */
export async function requireStepUp(
  formData: FormData,
  options: { maxAgeSeconds?: number } = {},
): Promise<StepUpRefusal | null> {
  const state = await getSessionState();
  if (state.kind !== "signed_in") {
    return { error: "Your session expired. Sign in again." };
  }
  const { user, assurance } = state;
  if (!assurance.enrolled) return null;

  const maxAge = options.maxAgeSeconds ?? STEP_UP_WINDOW_SECONDS;
  if (maxAge > 0 && secondFactorIsFresh(assurance, maxAge)) return null;

  const rawCode = String(formData.get("mfa_code") ?? "");
  if (!rawCode.trim()) {
    return {
      error: "Enter the 6-digit code from your authenticator app to confirm it's you.",
      stepUp: true,
    };
  }
  const code = totpCodeSchema.safeParse(rawCode);
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "Check the code and try again.", stepUp: true };
  }

  const factorId = pickFactor(assurance, formData.get("mfa_factor_id"));
  if (!factorId) {
    return { error: "Pick one of your authenticator apps.", stepUp: true };
  }

  const supabase = await createClient();
  const result = await verifySecondFactor({
    supabase,
    userId: user.id,
    email: user.email,
    factorId,
    code: code.data,
    context: "step_up",
  });
  if (!result.ok) return { error: SECOND_FACTOR_MESSAGES[result.reason], stepUp: true };
  await setStepUpHint();
  return null;
}

/** See STEP_UP_HINT_COOKIE: a UI hint for the browser, never read here. */
async function setStepUpHint(): Promise<void> {
  try {
    const until = Math.floor(Date.now() / 1000) + STEP_UP_WINDOW_SECONDS;
    (await cookies()).set(STEP_UP_HINT_COOKIE, String(until), {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Read by client script on purpose, and worthless to anyone who steals it.
      httpOnly: false,
      maxAge: STEP_UP_WINDOW_SECONDS,
    });
  } catch {
    // Outside a writable request (a Server Component render): the form that
    // asked will simply show the field again next time, which the server
    // tolerates.
  }
}

/**
 * The factor a submitted code should be checked against: the one the form
 * named, if (and only if) it is one of THIS account's verified factors,
 * otherwise the account's first. A factor id from the form is never trusted
 * to belong to the caller just because it parses.
 */
export function pickFactor(
  assurance: Pick<SessionAssurance, "factors">,
  requested: FormDataEntryValue | null,
): string | null {
  const parsed = factorIdSchema.safeParse(typeof requested === "string" ? requested : "");
  if (parsed.success) {
    return assurance.factors.some((f) => f.id === parsed.data) ? parsed.data : null;
  }
  // Nothing (or nothing usable) was named: the only unambiguous default is a
  // sole factor. With several, a blank choice is still resolved to the first,
  // which is what the picker shows selected by default.
  if (typeof requested === "string" && requested.trim() !== "") return null;
  return assurance.factors[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Mint a fresh set for `userId`, replacing any previous one in a single
 * transaction, and return the plaintext ONCE for display. Null on failure, in
 * which case the old set (if any) is still in force: the replace is atomic.
 */
export async function issueRecoveryCodes(userId: string): Promise<string[] | null> {
  const codes = generateRecoveryCodes();
  try {
    const hashes = await Promise.all(
      codes.map((code) => hashRecoveryCode(userId, normalizeRecoveryCode(code)!)),
    );
    const admin = createAdminClient();
    const { error } = await admin.rpc("mfa_replace_recovery_codes", {
      p_user_id: userId,
      p_hashes: hashes,
    });
    if (error) {
      console.error("[mfa] storing recovery codes failed:", error.message);
      return null;
    }
    return codes;
  } catch (err) {
    console.error(
      "[mfa] issueRecoveryCodes threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Unused codes left, or null if the count could not be read. */
export async function remainingRecoveryCodes(userId: string): Promise<number | null> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("mfa_recovery_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("used_at", null);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/**
 * Spend one recovery code. Returns the stored hash on success, so a caller
 * that then fails to finish the recovery can hand the code back
 * (restoreRecoveryCode) rather than leave the person one code poorer for
 * nothing. Null for anything that is not an unused code of this account.
 */
export async function spendRecoveryCode(userId: string, input: string): Promise<string | null> {
  if (input.length > RECOVERY_CODE_INPUT_MAX) return null;
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return null;
  try {
    const hash = await hashRecoveryCode(userId, normalized);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("mfa_consume_recovery_code", {
      p_user_id: userId,
      p_hash: hash,
    });
    if (error) {
      console.error("[mfa] consuming a recovery code failed:", error.message);
      return null;
    }
    return data === true ? hash : null;
  } catch {
    return null;
  }
}

/** Undo spendRecoveryCode, for a recovery that could not be completed. */
export async function restoreRecoveryCode(userId: string, hash: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("mfa_recovery_codes")
      .update({ used_at: null })
      .eq("user_id", userId)
      .eq("code_hash", hash);
  } catch {
    // Best-effort: the person can still generate a new set once back in.
  }
}

/** Every code for the account, gone. For when 2FA goes off: codes that could
 *  later "recover" into an account with no second factor mean nothing, and a
 *  set left behind would be revived by the next setup. */
export async function clearRecoveryCodes(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

/**
 * Remove EVERY factor on the account through the admin API. The recovery-code
 * path needs this: its session is aal1 by definition (the person has no
 * working authenticator), and GoTrue only lets a user remove a verified factor
 * from an aal2 session. Returns false if any removal failed.
 */
export async function deleteAllFactors(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error || !data) return false;
    let ok = true;
    for (const factor of data.factors) {
      const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (removed.error) {
        console.error("[mfa] deleting factor failed:", removed.error.message);
        ok = false;
      }
    }
    return ok;
  } catch (err) {
    console.error(
      "[mfa] deleteAllFactors threw:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Drop factors a previous setup started and never finished. Each open setup
 * holds a factor at GoTrue (and its name), so abandoned ones would otherwise
 * pile up against the per-account limit and block reusing a name.
 */
export async function discardPendingFactors(
  supabase: ServerClient,
  factors: { id: string; status: string }[] | undefined,
): Promise<void> {
  for (const factor of factors ?? []) {
    if (factor.status === "verified") continue;
    await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Log + bell + email for a 2FA change. Every one of these goes to the inbox as
 * well as the bell: a change to the second factor is exactly the kind of thing
 * an intruder does right before locking the owner out of the dashboard.
 * Never throws (alertSecurityEvent's contract), so it always runs AFTER the
 * change it reports has succeeded.
 */
export async function alertTwoFactorChange(
  user: { id: string; email?: string | null },
  event: Extract<SecurityEvent, `mfa.${string}`>,
  notice: { title: string; body: string },
): Promise<void> {
  try {
    await alertSecurityEvent(user.id, event, {
      ...notice,
      href: "/settings/security",
      emailTo: user.email ?? null,
    });
  } catch (err) {
    console.error(
      "[mfa] alert failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
