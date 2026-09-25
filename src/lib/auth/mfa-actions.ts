"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionState, revokeOtherSessions } from "@/lib/auth/session";
import { RECENT_SIGN_IN_SECONDS, signedInRecently } from "@/lib/auth/assurance";
import { accountHasPassword } from "@/lib/auth/has-password";
import { checkPassword } from "@/lib/auth/reauth";
import {
  SECOND_FACTOR_ERRORS,
  STEP_UP_FIELDS,
  alertTwoFactorChange,
  clearRecoveryCodes,
  deleteAllFactors,
  discardPendingFactors,
  issueRecoveryCodes,
  pickFactor,
  remainingRecoveryCodes,
  requireStepUpState,
  restoreRecoveryCode,
  spendRecoveryCode,
  takeSecondFactorAttempt,
  verifySecondFactor,
} from "@/lib/auth/mfa";
import { recordSecurityEvent } from "@/lib/security/events";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { readLocaleCookieValue, writeLocaleCookie } from "@/i18n/cookie";
import { localeForSignedInBrowser } from "@/i18n/sign-in";
import {
  RECOVERY_CODE_INPUT_MAX,
  factorIdSchema,
  factorNameSchema,
  totpCodeSchema,
} from "@/lib/validation/mfa";
import { firstIssue } from "@/lib/validation/messages";
import {
  actionError,
  failed,
  invalidInput,
  succeeded,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import type { z } from "zod";

/**
 * Two-factor actions: the sign-in challenge, recovery-code sign-in, and the
 * Settings › Security controls. The rules they lean on (budgets, replay guard,
 * step-up, recovery-code storage) live in lib/auth/mfa.ts.
 *
 * Every action starts from getSessionState() and checks the state it NEEDS:
 * the challenge actions only run for a session that still owes its second
 * factor, and the settings actions only for a fully signed-in one. Neither
 * trusts anything the form says about who is asking.
 *
 * Every state is the shared ActionState (lib/errors.ts): errors and successes
 * are message keys, resolved in the reader's language where they render.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const SESSION_EXPIRED: ActionState = failed(
  actionError("session_expired", msg("Errors.mfa.signInExpired")),
);
const UNREACHABLE: ActionState = failed(actionError("server_error", msg("Errors.mfa.unreachable")));
const FACTOR_UNKNOWN: ActionState = failed(invalidInput(msg("Errors.stepUp.factorUnknown")));
const TOO_MANY_CHANGES: ActionState = failed(
  actionError("rate_limited", msg("Errors.form.tooManyChanges")),
);
/** Deliberately the same words for a wrong code and for one too long to be a
 *  code at all: neither says anything about what the account holds. */
const RECOVERY_CODE_INVALID: ActionState = failed(
  invalidInput(msg("Errors.mfa.recoveryCodeInvalid")),
);
const FACTOR_NAME_TAKEN: ActionState = failed(invalidInput(msg("Errors.mfa.factorNameTaken")));
const SETUP_FAILED: ActionState = failed(actionError("server_error", msg("Errors.mfa.setupFailed")));
const SETUP_EXPIRED: ActionState = failed(invalidInput(msg("Errors.mfa.setupExpired")));

function unknownField(formData: FormData, allowed: readonly string[]): ActionState | null {
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
function signsInWithGoogle(user: {
  identities?: { provider: string }[] | null;
  app_metadata?: { providers?: unknown };
}): boolean {
  if ((user.identities ?? []).some((identity) => identity.provider === "google")) return true;
  const providers = user.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes("google");
}

/** A code that did not parse as six digits, in the schema's own words. */
function malformedCode(error: z.ZodError): ActionState {
  return failed(invalidInput(firstIssue(error, msg("Errors.mfa.enterCode"))));
}

/**
 * Copy the account's saved language onto a browser that has none, once the
 * challenge completes a sign-in. Best-effort: never fails the sign-in.
 */
async function syncAccountLocale(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  try {
    const accountLocale = await localeForSignedInBrowser(
      supabase,
      userId,
      await readLocaleCookieValue(),
    );
    if (accountLocale) await writeLocaleCookie(accountLocale);
  } catch (err) {
    console.warn(
      "[locale] challenge sync failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Where to go after the challenge. Never back to a sign-in page (a loop), and
 * never off-site (safeInternalPath resolves the value the way a browser would).
 */
function afterChallenge(raw: FormDataEntryValue | null): string {
  const next = safeInternalPath(typeof raw === "string" ? raw : null);
  return next.startsWith("/login") ? "/" : next;
}

// ---------------------------------------------------------------------------
// Sign-in challenge
// ---------------------------------------------------------------------------

export type ChallengeState = ActionState & {
  /** The half-signed-in session is gone; the page offers "sign in again". */
  expired?: boolean;
};

/** The half-signed-in session is gone: say so, and offer "sign in again". */
function challengeExpired(): ChallengeState {
  return { ...SESSION_EXPIRED, expired: true };
}

/**
 * The second half of signing in: a code from the authenticator app. Only for a
 * session that has passed its first factor and still owes this one.
 */
export async function verifyTwoFactorSignIn(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const rejected = unknownField(formData, ["code", "factor_id", "next"]);
  if (rejected) return rejected;
  const next = afterChallenge(formData.get("next"));

  const state = await getSessionState();
  if (state.kind === "unreachable") return UNREACHABLE;
  if (state.kind === "signed_out") return challengeExpired();
  // Already through (a second tab finished first): nothing to verify.
  if (state.kind === "signed_in") redirect(next);

  const code = totpCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!code.success) return malformedCode(code.error);
  const factorId = pickFactor(state.assurance, formData.get("factor_id"));
  if (!factorId) return FACTOR_UNKNOWN;

  const supabase = await createClient();
  const result = await verifySecondFactor({
    supabase,
    userId: state.user.id,
    email: state.user.email,
    factorId,
    code: code.data,
    context: "sign_in",
  });
  if (!result.ok) return failed(SECOND_FACTOR_ERRORS[result.reason]);

  // Sign-in is complete only now, so this is where a browser with no language
  // of its own picks up the account's (the first-factor step skipped it: that
  // aal1 session could not read the profile).
  await syncAccountLocale(supabase, state.user.id);

  // Outside every try/catch: redirect() works by throwing.
  redirect(next);
}

/**
 * Sign in with a recovery code instead of the authenticator app.
 *
 * WHAT IT DOES TO THE ACCOUNT, deliberately: a recovery code is for "my phone
 * is gone", so the old authenticators are removed (they are presumed lost or
 * in someone else's hands), the remaining codes are voided with them, every
 * other session is signed out, and the owner is emailed. The person lands on
 * Settings › Security with setup already open, because the account is now
 * protected by its password alone until they finish it.
 */
export async function signInWithRecoveryCode(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const rejected = unknownField(formData, ["recovery_code", "next"]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind === "unreachable") return UNREACHABLE;
  if (state.kind === "signed_out") return challengeExpired();
  if (state.kind === "signed_in") redirect(afterChallenge(formData.get("next")));

  const raw = String(formData.get("recovery_code") ?? "");
  if (!raw.trim()) return failed(invalidInput(msg("Errors.mfa.recoveryCodeRequired")));
  if (raw.length > RECOVERY_CODE_INPUT_MAX) return RECOVERY_CODE_INVALID;

  const { user } = state;
  // The SAME budget as authenticator codes. A recovery code is a second
  // factor too, so it must not be a way around the limit on guessing one.
  if (!(await takeSecondFactorAttempt(user.id, user.email, "sign_in"))) {
    return failed(SECOND_FACTOR_ERRORS.rate_limited);
  }

  const spent = await spendRecoveryCode(user.id, raw);
  if (!spent) {
    await recordSecurityEvent({ userId: user.id, event: "mfa.challenge_failed" });
    return RECOVERY_CODE_INVALID;
  }

  // The code is spent, so from here a failure hands it back rather than leave
  // the person locked out AND a code poorer.
  if (!(await deleteAllFactors(user.id))) {
    await restoreRecoveryCode(user.id, spent);
    return failed(actionError("server_error", msg("Errors.mfa.recoveryIncomplete")));
  }
  await clearRecoveryCodes(user.id);

  const supabase = await createClient();
  // Whoever else is signed in may be the reason the phone is "lost".
  await revokeOtherSessions(supabase);

  await recordSecurityEvent({ userId: user.id, event: "mfa.disabled" });
  // Signed in now, as in verifyTwoFactorSignIn. With every factor gone, this
  // session may read the profile.
  await syncAccountLocale(supabase, user.id);

  await alertTwoFactorChange(user, "mfa.recovery_code_used", {
    title: { key: "Notifications.messages.security.recoveryCodeUsed.title" },
    body: { key: "Notifications.messages.security.recoveryCodeUsed.body" },
  });

  redirect("/settings/security?recovered=1");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** `stepUp` (from ActionState): adding a SECOND authenticator needs a code
 *  from an existing one. */
export type BeginSetupState = ActionState & {
  /** The account has no password and signed in too long ago: sign in again. */
  reauth?: boolean;
  enrollment?: {
    factorId: string;
    /** An <img>-safe data: URL of the QR code. */
    qrCode: string;
    /** The same secret as text, for "can't scan it? type this in". */
    secret: string;
    /** otpauth:// link: on a phone, tapping it opens the authenticator app. */
    uri: string;
  };
};

/**
 * GoTrue's QR code arrives as `data:image/svg+xml;utf-8,<svg...>` with the SVG
 * NOT percent-encoded, so any `#` in it would end the URL early. Re-encoded as
 * base64 here. Only accepted if it is actually an SVG: rendered through <img>,
 * an SVG cannot run script, but there is no reason to pass on anything else.
 */
function qrDataUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const svg = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  // Real GoTrue renders with SVGo, whose output opens with an XML declaration
  // AND a comment: `<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n<svg`.
  // Refusing the comment refused every real QR code (setup always failed in
  // production while the e2e mock, which sent a bare <svg>, passed).
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) return null;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * Step 1 of turning 2FA on (or adding another authenticator): prove it is the
 * owner, then have GoTrue mint a new, UNVERIFIED factor and hand back its QR
 * code. Nothing is protected by it until step 2 proves the phone has it.
 *
 * PROOF OF OWNERSHIP FIRST, because enrolment is a takeover path in its own
 * right: someone holding a stolen session could enrol THEIR phone and lock
 * the owner out of their own account. So:
 *   - adding to an account that already has 2FA: a code from an existing
 *     authenticator, in this request;
 *   - first setup, account has a password: the password;
 *   - first setup, Google/link-only account: a sign-in in the last 15 minutes.
 */
export async function beginTwoFactorSetup(
  _prev: BeginSetupState,
  formData: FormData,
): Promise<BeginSetupState> {
  const rejected = unknownField(formData, ["name", "current_password", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;

  const name = factorNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!name.success) {
    return failed(invalidInput(firstIssue(name.error, msg("Errors.mfa.factorNameRequired"))));
  }
  if (assurance.factors.some((f) => f.name.toLowerCase() === name.data.toLowerCase())) {
    return FACTOR_NAME_TAKEN;
  }

  if (assurance.enrolled) {
    const refused = await requireStepUpState(formData, { maxAgeSeconds: 0 });
    if (refused) return refused;
  } else if (signedInRecently(assurance, RECENT_SIGN_IN_SECONDS)) {
    // Signed in (by whatever method this account uses) moments ago: that IS
    // the proof, the same proof the password would give. It is also how a
    // Google account that has a forgotten password on file gets through:
    // "Confirm with Google" signs in again and lands back here.
  } else if (await accountHasPassword(user.id)) {
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
  } else {
    return {
      ...failed(actionError("session_expired", msg("Errors.mfa.reauthRequired"))),
      reauth: true,
    };
  }

  if (!(await rateLimit("mfa_enroll", RATE_LIMITS.mfaEnroll))) {
    return failed(actionError("rate_limited", msg("Errors.mfa.setupRateLimited")));
  }

  // Turning 2FA ON must never succeed without recovery codes to go with it:
  // a lost phone would then mean a locked account. So before anything is
  // enrolled, make sure the code store answers at all (it will not if the
  // database migration has not been applied yet). Adding a second
  // authenticator keeps the existing codes, so it does not need this.
  if (!assurance.enrolled && (await remainingRecoveryCodes(user.id)) === null) {
    console.error("[mfa] recovery code store unreachable; refusing to start setup");
    return failed(actionError("server_error", msg("Errors.mfa.setupUnavailable")));
  }

  const supabase = await createClient();
  await discardPendingFactors(supabase, user.factors);

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: name.data,
    issuer: "Square Share",
  });
  if (error || !data || data.type !== "totp") {
    if (error?.code === "mfa_factor_name_conflict") return FACTOR_NAME_TAKEN;
    if (error?.code === "too_many_enrolled_mfa_factors") {
      return failed(invalidInput(msg("Errors.mfa.tooManyFactors")));
    }
    console.warn("[mfa] enroll failed:", error?.code, error?.message);
    return SETUP_FAILED;
  }

  const qrCode = qrDataUrl(data.totp.qr_code);
  if (!qrCode || !data.totp.secret) {
    await supabase.auth.mfa.unenroll({ factorId: data.id }).catch(() => undefined);
    return SETUP_FAILED;
  }

  return {
    enrollment: {
      factorId: data.id,
      qrCode,
      secret: data.totp.secret,
      uri: data.totp.uri,
    },
  };
}

export type ConfirmSetupState = ActionState & {
  done?: boolean;
  /** Set when this turned 2FA ON: the recovery codes, shown once. Null if
   *  they could not be created (2FA is still on; the page offers a retry). */
  codes?: string[] | null;
};

/**
 * Step 2: the first code from the new authenticator. Verifying it is what
 * makes the factor real, and it upgrades THIS session to aal2 on the spot.
 */
export async function confirmTwoFactorSetup(
  _prev: ConfirmSetupState,
  formData: FormData,
): Promise<ConfirmSetupState> {
  const rejected = unknownField(formData, ["factor_id", "code"]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;

  const factorId = factorIdSchema.safeParse(String(formData.get("factor_id") ?? ""));
  if (!factorId.success) return SETUP_EXPIRED;
  // Must be THIS account's pending factor: never a verified one (that would
  // make "confirm setup" a way to exercise someone's existing factor) and
  // never someone else's.
  const pending = (user.factors ?? []).find(
    (f) => f.id === factorId.data && f.status !== "verified",
  );
  if (!pending) return SETUP_EXPIRED;

  const code = totpCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!code.success) return malformedCode(code.error);

  const firstFactor = !assurance.enrolled;
  const supabase = await createClient();
  const result = await verifySecondFactor({
    supabase,
    userId: user.id,
    email: user.email,
    factorId: factorId.data,
    code: code.data,
    context: "setup",
  });
  if (!result.ok) {
    return failed(
      result.reason === "invalid"
        ? invalidInput(msg("Errors.mfa.setupCodeMismatch"))
        : SECOND_FACTOR_ERRORS[result.reason],
    );
  }

  // The session in the cookies is now aal2. Every OTHER session is not, and
  // for an account that has just switched 2FA on they are precisely the ones
  // to distrust: sign them all out (GoTrue does this too; doing it here means
  // the guarantee does not rest on a server setting).
  await revokeOtherSessions(supabase);

  let codes: string[] | null | undefined;
  if (firstFactor) {
    codes = await issueRecoveryCodes(user.id);
    await alertTwoFactorChange(user, "mfa.enabled", {
      title: { key: "Notifications.messages.security.twoFactorEnabled.title" },
      body: { key: "Notifications.messages.security.twoFactorEnabled.body" },
    });
  } else {
    await alertTwoFactorChange(user, "mfa.factor_added", {
      title: { key: "Notifications.messages.security.factorAdded.title" },
      body: pending.friendly_name != null
        ? {
            key: "Notifications.messages.security.factorAdded.body",
            values: { name: pending.friendly_name },
          }
        : { key: "Notifications.messages.security.factorAdded.bodyUnnamed" },
    });
  }

  // The whole settings layout, not just this page: it carries the 2FA state
  // every sensitive form reads (StepUpProvider) and the rail's badge.
  revalidatePath("/settings", "layout");
  return { done: true, codes };
}

/**
 * For an account with no password whose sign-in is too old to vouch for it:
 * end this session and come back through sign-in, landing on setup again.
 * Only this session ("local"): nothing else about the account changes.
 */
export async function signOutToReauthenticate(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(`/login?next=${encodeURIComponent("/settings/security?setup=1")}`);
}

/**
 * Abandon a setup that was started and not finished (the modal was closed).
 * Only ever removes an UNVERIFIED factor of the caller's own.
 */
export async function cancelTwoFactorSetup(factorId: string): Promise<void> {
  const state = await getSessionState();
  if (state.kind !== "signed_in") return;
  const parsed = factorIdSchema.safeParse(factorId);
  if (!parsed.success) return;
  const pending = (state.user.factors ?? []).find(
    (f) => f.id === parsed.data && f.status !== "verified",
  );
  if (!pending) return;
  const supabase = await createClient();
  await supabase.auth.mfa.unenroll({ factorId: pending.id }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Managing it
// ---------------------------------------------------------------------------

export type ManageState = ActionState & {
  /** Fresh recovery codes, shown once. */
  codes?: string[];
};

/**
 * Remove one authenticator. Removing the last one turns 2FA off, which also
 * voids the recovery codes. Always needs a code in the request itself.
 */
export async function removeAuthenticator(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const rejected = unknownField(formData, ["factor_id", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;

  const factorId = factorIdSchema.safeParse(String(formData.get("factor_id") ?? ""));
  const target = factorId.success
    ? assurance.factors.find((f) => f.id === factorId.data)
    : undefined;
  if (!target) return failed(actionError("not_found", msg("Errors.mfa.factorNotOnAccount")));

  const refused = await requireStepUpState(formData, { maxAgeSeconds: 0 });
  if (refused) return refused;

  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) return TOO_MANY_CHANGES;

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: target.id });
  if (error) {
    console.warn("[mfa] unenroll failed:", error.code, error.message);
    return failed(actionError("server_error", msg("Errors.mfa.removeFailed")));
  }

  const wasLast = assurance.factors.length === 1;
  if (wasLast) {
    await clearRecoveryCodes(user.id);
    await alertTwoFactorChange(user, "mfa.disabled", {
      title: { key: "Notifications.messages.security.twoFactorDisabled.title" },
      body: { key: "Notifications.messages.security.twoFactorDisabled.body" },
    });
  } else {
    await alertTwoFactorChange(user, "mfa.factor_removed", {
      title: { key: "Notifications.messages.security.factorRemoved.title" },
      body: {
        key: "Notifications.messages.security.factorRemoved.body",
        values: { name: target.name },
      },
    });
  }

  // The whole settings layout, not just this page: it carries the 2FA state
  // every sensitive form reads (StepUpProvider) and the rail's badge.
  revalidatePath("/settings", "layout");
  return succeeded(
    wasLast
      ? msg("Settings.security.success.twoFactorOff")
      : msg("Settings.security.success.factorRemoved", { name: target.name }),
  );
}

/** Replace the recovery codes with a new set. Always needs a code. */
export async function regenerateRecoveryCodes(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const rejected = unknownField(formData, [...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;
  if (!assurance.enrolled) return failed(invalidInput(msg("Errors.mfa.notEnrolled")));

  const refused = await requireStepUpState(formData, { maxAgeSeconds: 0 });
  if (refused) return refused;

  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) return TOO_MANY_CHANGES;

  const codes = await issueRecoveryCodes(user.id);
  if (!codes) return failed(actionError("server_error", msg("Errors.mfa.codesNotCreated")));

  await alertTwoFactorChange(user, "mfa.recovery_codes_regenerated", {
    title: { key: "Notifications.messages.security.recoveryCodesRegenerated.title" },
    body: { key: "Notifications.messages.security.recoveryCodesRegenerated.body" },
  });

  // The whole settings layout, not just this page: it carries the 2FA state
  // every sensitive form reads (StepUpProvider) and the rail's badge.
  revalidatePath("/settings", "layout");
  return { ...succeeded(msg("Settings.security.success.codesRegenerated")), codes };
}

/**
 * A code for its own sake: extends the sudo window before a sensitive action
 * that is not a form of ours (the data export download). Nothing else.
 */
export async function confirmIdentity(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const rejected = unknownField(formData, [...STEP_UP_FIELDS]);
  if (rejected) return rejected;
  const refused = await requireStepUpState(formData);
  if (refused) return refused;
  return succeeded(msg("Settings.security.success.confirmed"));
}
