import type { User } from "@supabase/supabase-js";
import { RECENT_SIGN_IN_SECONDS, signedInRecently, type SessionAssurance } from "@/lib/auth/assurance";
import { accountHasPassword } from "@/lib/auth/has-password";
import { checkPassword } from "@/lib/auth/reauth";
import { remainingRecoveryCodes, requireStepUpState } from "@/lib/auth/mfa";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { actionError, failed, invalidInput, type ActionState } from "@/lib/errors";
import { msg } from "@/i18n/types";

// SERVER ONLY, and deliberately NOT a "use server" module: these are the rules
// every "add a second factor" action applies (lib/auth/mfa-actions.ts for an
// authenticator app, lib/auth/passkey-actions.ts for a passkey), kept in one
// place so the two kinds can never drift apart on who may enrol.

/** Refuse any form field the action does not expect, by name. */
export function unknownField(formData: FormData, allowed: readonly string[]): ActionState | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) {
      return failed(invalidInput(msg("Errors.form.unexpectedField", { field: key })));
    }
  }
  return null;
}

/** Does this account sign in with Google? Read from GoTrue's own record of
 *  the account's identities, never from anything the form sends. */
export function signsInWithGoogle(user: {
  identities?: { provider: string }[] | null;
  app_metadata?: { providers?: unknown };
}): boolean {
  if ((user.identities ?? []).some((identity) => identity.provider === "google")) return true;
  const providers = user.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes("google");
}

export type SetupProof = ActionState & {
  /** The account has no password and signed in too long ago: sign in again. */
  reauth?: boolean;
};

/**
 * PROOF OF OWNERSHIP before a new second factor is enrolled, because
 * enrolment is a takeover path in its own right: someone holding a stolen
 * session could enrol THEIR phone and lock the owner out. Null when proven.
 *
 *   - adding to an account that already has 2FA: an existing factor, in this
 *     request (a code, or a passkey);
 *   - first setup, signed in within the last 10 minutes: that sign-in;
 *   - first setup, account has a password: the password;
 *   - otherwise (Google/link-only, older sign-in): sign in again.
 */
export async function proveSetupOwnership(
  formData: FormData,
  user: Pick<User, "id" | "email" | "identities" | "app_metadata">,
  assurance: SessionAssurance,
): Promise<SetupProof | null> {
  if (assurance.enrolled) {
    return requireStepUpState(formData, { maxAgeSeconds: 0 });
  }
  if (signedInRecently(assurance, RECENT_SIGN_IN_SECONDS)) {
    // Signed in (by whatever method this account uses) moments ago: that IS
    // the proof, the same proof the password would give. It is also how a
    // Google account that has a forgotten password on file gets through:
    // "Confirm with Google" signs in again and lands back here.
    return null;
  }
  if (await accountHasPassword(user.id)) {
    const usesGoogle = signsInWithGoogle(user);
    const password = String(formData.get("current_password") ?? "");
    if (!password) {
      return usesGoogle
        ? { ...failed(invalidInput(msg("Errors.mfa.passwordRequiredGoogle"))), reauth: true }
        : failed(invalidInput(msg("Errors.mfa.passwordRequired")));
    }
    if (password.length > 72) return failed(invalidInput(msg("Errors.settings.wrongPassword")));
    // A password oracle, so it spends the same budget as every other re-auth.
    if (!(await rateLimit("password_reauth", RATE_LIMITS.passwordReauth))) {
      return failed(actionError("rate_limited", msg("Errors.settings.passwordReauthRateLimited")));
    }
    const check = await checkPassword(user.email ?? "", password);
    if (check === "unavailable") {
      return failed(actionError("server_error", msg("Errors.mfa.passwordCheckUnavailable")));
    }
    if (check === "incorrect") {
      // The case that actually happened: an account that signs in with
      // Google also has an old password on file, and the person typed the
      // one they know (often their Google password). Point them at the way
      // they really sign in rather than at a password they never use.
      return usesGoogle
        ? { ...failed(invalidInput(msg("Errors.mfa.wrongPasswordGoogle"))), reauth: true }
        : failed(invalidInput(msg("Errors.settings.wrongPassword")));
    }
    return null;
  }
  return {
    ...failed(actionError("session_expired", msg("Errors.mfa.reauthRequired"))),
    reauth: true,
  };
}

/**
 * The checks between "it's you" and "enrol": the setup budget, and, when this
 * turns 2FA ON, that the recovery-code store answers. 2FA must never come on
 * without recovery codes to go with it: a lost phone would then mean a locked
 * account. Adding another factor keeps the existing codes, so it skips that.
 */
export async function readyToEnroll(
  userId: string,
  assurance: Pick<SessionAssurance, "enrolled">,
): Promise<ActionState | null> {
  if (!(await rateLimit("mfa_enroll", RATE_LIMITS.mfaEnroll))) {
    return failed(actionError("rate_limited", msg("Errors.mfa.setupRateLimited")));
  }
  if (!assurance.enrolled && (await remainingRecoveryCodes(userId)) === null) {
    console.error("[mfa] recovery code store unreachable; refusing to start setup");
    return failed(actionError("server_error", msg("Errors.mfa.setupUnavailable")));
  }
  return null;
}
