import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import {
  alertSecurityEvent,
  recordSecurityEvent,
  type SecurityEvent,
} from "@/lib/security/events";
import type { NotificationMessageRef } from "@/lib/notifications/message";
import { getSessionState } from "@/lib/auth/session";
import {
  STEP_UP_HINT_COOKIE,
  STEP_UP_WINDOW_SECONDS,
  appFactors,
  secondFactorIsFresh,
  type SessionAssurance,
} from "@/lib/auth/assurance";
import { completeFactor, parseCredential, verifyAssertion } from "@/lib/auth/passkeys";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
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
import {
  actionError,
  failed,
  invalidInput,
  type ActionError,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";

// SERVER ONLY, and deliberately NOT a "use server" module: nothing in here is
// meant to be callable from the browser. The actions that are live in
// lib/auth/mfa-actions.ts and call into this.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Verifying a code
// ---------------------------------------------------------------------------

export type SecondFactorFailure = "invalid" | "rate_limited" | "replayed" | "unavailable";

/** What each failure tells the person, wherever a code is checked (sign-in,
 *  setup, step-up). None of them reveals anything about the account beyond
 *  what the person typing already knows. */
export const SECOND_FACTOR_ERRORS: Record<SecondFactorFailure, ActionError> = {
  invalid: invalidInput(msg("Errors.stepUp.invalid")),
  rate_limited: actionError("rate_limited", msg("Errors.stepUp.rateLimited")),
  replayed: invalidInput(msg("Errors.stepUp.replayed")),
  unavailable: actionError("server_error", msg("Errors.stepUp.unavailable")),
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
    title: { key: "Notifications.messages.security.lockedOut.title" },
    body: { key: "Notifications.messages.security.lockedOut.body" },
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
 * requireStepUpState must allow these in its field whitelist.
 */
export const STEP_UP_FIELDS = ["mfa_code", "mfa_factor_id", "mfa_passkey", "mfa_passkey_slip"] as const;

/** Why a sensitive action may not run yet. */
type StepUpProblem =
  | "signed_out"
  | "code_required"
  | "code_malformed"
  | "factor_unknown"
  | "passkey_required"
  | "passkey_invalid"
  | "passkey_expired"
  | SecondFactorFailure;

/**
 * Gate a sensitive action on a RECENT second factor, for accounts with 2FA.
 * Returns null when the action may go ahead, otherwise why not.
 * requireStepUpState below turns the answer into the state an action returns.
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
async function checkStepUp(
  formData: FormData,
  options: { maxAgeSeconds?: number },
): Promise<{ problem: StepUpProblem } | null> {
  const state = await getSessionState();
  if (state.kind !== "signed_in") return { problem: "signed_out" };
  const { user, assurance } = state;
  if (!assurance.enrolled) return null;

  const maxAge = options.maxAgeSeconds ?? STEP_UP_WINDOW_SECONDS;
  if (maxAge > 0 && secondFactorIsFresh(assurance, maxAge)) return null;

  // A passkey, confirmed in the browser just before this submit: its signed
  // assertion rides in the form and counts exactly like a code in the request
  // (maxAgeSeconds: 0 included), because it is one, spent once.
  const rawPasskey = formData.get("mfa_passkey");
  if (typeof rawPasskey === "string" && rawPasskey !== "") {
    return checkStepUpPasskey(rawPasskey, formData.get("mfa_passkey_slip"), user, assurance);
  }

  const rawCode = String(formData.get("mfa_code") ?? "");
  if (!rawCode.trim()) {
    // Asked for in the terms of what the account actually has.
    return { problem: appFactors(assurance.factors).length ? "code_required" : "passkey_required" };
  }
  const code = totpCodeSchema.safeParse(rawCode);
  if (!code.success) return { problem: "code_malformed" };

  const factorId = pickFactor(assurance, formData.get("mfa_factor_id"));
  if (!factorId) return { problem: "factor_unknown" };

  const supabase = await createClient();
  const result = await verifySecondFactor({
    supabase,
    userId: user.id,
    email: user.email,
    factorId,
    code: code.data,
    context: "step_up",
  });
  if (!result.ok) return { problem: result.reason };
  await setStepUpHint();
  return null;
}

/**
 * The passkey half of checkStepUp: the same budgets as a code, then the
 * assertion checked against THIS account's passkeys and the step-up slip,
 * then the factor it unlocks completed at GoTrue (which refreshes the
 * session's second-factor time, reopening the window).
 */
async function checkStepUpPasskey(
  raw: string,
  slip: FormDataEntryValue | null,
  user: { id: string; email?: string | null },
  assurance: SessionAssurance,
): Promise<{ problem: StepUpProblem } | null> {
  const response = parseCredential<AuthenticationResponseJSON>(raw);
  if (!response) return { problem: "passkey_invalid" };
  if (typeof slip !== "string" || !slip) return { problem: "passkey_expired" };
  if (!(await takeSecondFactorAttempt(user.id, user.email, "step_up"))) {
    return { problem: "rate_limited" };
  }
  const assertion = await verifyAssertion({
    userId: user.id,
    purpose: "step_up",
    response,
    slip,
    verifiedFactorIds: assurance.factors.map((factor) => factor.id),
  });
  if (!assertion.ok) {
    if (assertion.reason === "expired") return { problem: "passkey_expired" };
    if (assertion.reason === "invalid") return { problem: "passkey_invalid" };
    return { problem: "unavailable" };
  }
  const supabase = await createClient();
  const completed = await completeFactor(supabase, assertion.factorId, assertion.secret);
  if (!completed.ok) return { problem: "unavailable" };
  await setStepUpHint();
  return null;
}

const STEP_UP_ERRORS: Record<Exclude<StepUpProblem, "signed_out">, ActionError> = {
  code_required: invalidInput(msg("Errors.stepUp.codeRequired")),
  code_malformed: invalidInput(msg("Errors.stepUp.codeMalformed")),
  factor_unknown: invalidInput(msg("Errors.stepUp.factorUnknown")),
  passkey_required: invalidInput(msg("Errors.stepUp.passkeyRequired")),
  passkey_invalid: invalidInput(msg("Errors.stepUp.passkeyInvalid")),
  passkey_expired: invalidInput(msg("Errors.stepUp.passkeyExpired")),
  ...SECOND_FACTOR_ERRORS,
};

/**
 * The step-up gate in the shared form-action shape (lib/errors.ts): what a
 * sensitive action (settings, team, the 2FA controls) returns when it needs a
 * fresh code first.
 */
export async function requireStepUpState(
  formData: FormData,
  options: { maxAgeSeconds?: number } = {},
): Promise<ActionState | null> {
  const refused = await checkStepUp(formData, options);
  if (!refused) return null;
  if (refused.problem === "signed_out") {
    return failed(actionError("session_expired", msg("Errors.form.sessionExpired")));
  }
  return { error: STEP_UP_ERRORS[refused.problem], stepUp: true };
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
  // A typed code can only be from an authenticator APP: a passkey's factor
  // has no code anyone could read (lib/auth/passkeys.ts), so it is never a
  // candidate here, named or by default.
  const apps = appFactors(assurance.factors);
  const parsed = factorIdSchema.safeParse(typeof requested === "string" ? requested : "");
  if (parsed.success) {
    return apps.some((f) => f.id === parsed.data) ? parsed.data : null;
  }
  // Nothing (or nothing usable) was named: the only unambiguous default is a
  // sole factor. With several, a blank choice is still resolved to the first,
  // which is what the picker shows selected by default.
  if (typeof requested === "string" && requested.trim() !== "") return null;
  return apps[0]?.id ?? null;
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
  notice: { title: NotificationMessageRef; body: NotificationMessageRef },
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
