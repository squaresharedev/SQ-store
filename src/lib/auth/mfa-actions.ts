"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionState, revokeOtherSessions } from "@/lib/auth/session";
import { RECENT_SIGN_IN_SECONDS, signedInRecently } from "@/lib/auth/assurance";
import { accountHasPassword } from "@/lib/auth/has-password";
import { checkPassword } from "@/lib/auth/reauth";
import {
  SECOND_FACTOR_MESSAGES,
  STEP_UP_FIELDS,
  alertTwoFactorChange,
  clearRecoveryCodes,
  deleteAllFactors,
  discardPendingFactors,
  issueRecoveryCodes,
  pickFactor,
  remainingRecoveryCodes,
  requireStepUp,
  restoreRecoveryCode,
  spendRecoveryCode,
  takeSecondFactorAttempt,
  verifySecondFactor,
} from "@/lib/auth/mfa";
import { recordSecurityEvent } from "@/lib/security/events";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/utils/safe-path";
import {
  RECOVERY_CODE_INPUT_MAX,
  factorIdSchema,
  factorNameSchema,
  totpCodeSchema,
} from "@/lib/validation/mfa";

/**
 * Two-factor actions: the sign-in challenge, recovery-code sign-in, and the
 * Settings › Security controls. The rules they lean on (budgets, replay guard,
 * step-up, recovery-code storage) live in lib/auth/mfa.ts.
 *
 * Every action starts from getSessionState() and checks the state it NEEDS:
 * the challenge actions only run for a session that still owes its second
 * factor, and the settings actions only for a fully signed-in one. Neither
 * trusts anything the form says about who is asking.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const SESSION_EXPIRED = "Your sign-in expired. Sign in again.";
const UNREACHABLE = "We couldn't reach the sign-in service. Check your connection and try again.";

function unknownField(formData: FormData, allowed: readonly string[]): string | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) return `Unexpected field "${key}" was rejected.`;
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

export type ChallengeState = {
  error?: string;
  /** The half-signed-in session is gone; the page offers "sign in again". */
  expired?: boolean;
};

/**
 * The second half of signing in: a code from the authenticator app. Only for a
 * session that has passed its first factor and still owes this one.
 */
export async function verifyTwoFactorSignIn(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const rejected = unknownField(formData, ["code", "factor_id", "next"]);
  if (rejected) return { error: rejected };
  const next = afterChallenge(formData.get("next"));

  const state = await getSessionState();
  if (state.kind === "unreachable") return { error: UNREACHABLE };
  if (state.kind === "signed_out") return { error: SESSION_EXPIRED, expired: true };
  // Already through (a second tab finished first): nothing to verify.
  if (state.kind === "signed_in") redirect(next);

  const code = totpCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "Enter the 6-digit code." };
  }
  const factorId = pickFactor(state.assurance, formData.get("factor_id"));
  if (!factorId) return { error: "Pick one of your authenticator apps." };

  const supabase = await createClient();
  const result = await verifySecondFactor({
    supabase,
    userId: state.user.id,
    email: state.user.email,
    factorId,
    code: code.data,
    context: "sign_in",
  });
  if (!result.ok) return { error: SECOND_FACTOR_MESSAGES[result.reason] };

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
  if (rejected) return { error: rejected };

  const state = await getSessionState();
  if (state.kind === "unreachable") return { error: UNREACHABLE };
  if (state.kind === "signed_out") return { error: SESSION_EXPIRED, expired: true };
  if (state.kind === "signed_in") redirect(afterChallenge(formData.get("next")));

  const raw = String(formData.get("recovery_code") ?? "");
  if (!raw.trim()) return { error: "Enter one of your recovery codes." };
  if (raw.length > RECOVERY_CODE_INPUT_MAX) {
    return { error: "That recovery code didn't work. Check it and try again." };
  }

  const { user } = state;
  // The SAME budget as authenticator codes. A recovery code is a second
  // factor too, so it must not be a way around the limit on guessing one.
  if (!(await takeSecondFactorAttempt(user.id, user.email, "sign_in"))) {
    return { error: SECOND_FACTOR_MESSAGES.rate_limited };
  }

  const spent = await spendRecoveryCode(user.id, raw);
  if (!spent) {
    await recordSecurityEvent({ userId: user.id, event: "mfa.challenge_failed" });
    return { error: "That recovery code didn't work. Check it and try again." };
  }

  // The code is spent, so from here a failure hands it back rather than leave
  // the person locked out AND a code poorer.
  if (!(await deleteAllFactors(user.id))) {
    await restoreRecoveryCode(user.id, spent);
    return { error: "We couldn't finish signing you in. Try the same code again in a moment." };
  }
  await clearRecoveryCodes(user.id);

  const supabase = await createClient();
  // Whoever else is signed in may be the reason the phone is "lost".
  await revokeOtherSessions(supabase);

  await recordSecurityEvent({ userId: user.id, event: "mfa.disabled" });
  await alertTwoFactorChange(user, "mfa.recovery_code_used", {
    title: "A recovery code was used to sign in",
    body: "Someone signed in to your account with a recovery code. That turns two-factor authentication off and signs out every other device. If this was you, set up two-factor again in Settings › Security. If it wasn't, change your password now.",
  });

  redirect("/settings/security?recovered=1");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export type BeginSetupState = {
  error?: string;
  /** The account has no password and signed in too long ago: sign in again. */
  reauth?: boolean;
  /** Adding a SECOND authenticator needs a code from an existing one. */
  stepUp?: true;
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
  if (rejected) return { error: rejected };

  const state = await getSessionState();
  if (state.kind !== "signed_in") return { error: SESSION_EXPIRED };
  const { user, assurance } = state;

  const name = factorNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!name.success) {
    return { error: name.error.issues[0]?.message ?? "Give this authenticator a name." };
  }
  if (assurance.factors.some((f) => f.name.toLowerCase() === name.data.toLowerCase())) {
    return { error: "You already have an authenticator with that name. Pick another." };
  }

  if (assurance.enrolled) {
    const refused = await requireStepUp(formData, { maxAgeSeconds: 0 });
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
      return {
        error: usesGoogle
          ? "Enter your Square Share password, or use “Confirm with Google” instead."
          : "Enter your current password to continue.",
        reauth: usesGoogle || undefined,
      };
    }
    if (password.length > 72) return { error: "Current password is incorrect." };
    // A password oracle, so it spends the same budget as every other re-auth.
    if (!(await rateLimit("password_reauth", RATE_LIMITS.passwordReauth))) {
      return { error: "Too many attempts. Wait a few minutes before trying again." };
    }
    const check = await checkPassword(user.email ?? "", password);
    if (check === "unavailable") {
      return { error: "We couldn't check your password just now. Try again in a moment." };
    }
    if (check === "incorrect") {
      // The case that actually happened: an account that signs in with
      // Google also has an old password on file, and the person typed the
      // one they know (often their Google password). Point them at the way
      // they really sign in rather than at a password they never use.
      return usesGoogle
        ? {
            error:
              "That isn't this account's Square Share password. You sign in with Google, so use “Confirm with Google” instead.",
            reauth: true,
          }
        : { error: "Current password is incorrect." };
    }
  } else {
    return {
      error: "For your security, sign in again before turning on two-factor authentication.",
      reauth: true,
    };
  }

  if (!(await rateLimit("mfa_enroll", RATE_LIMITS.mfaEnroll))) {
    return { error: "That's a lot of setup attempts. Try again a bit later." };
  }

  // Turning 2FA ON must never succeed without recovery codes to go with it:
  // a lost phone would then mean a locked account. So before anything is
  // enrolled, make sure the code store answers at all (it will not if the
  // database migration has not been applied yet). Adding a second
  // authenticator keeps the existing codes, so it does not need this.
  if (!assurance.enrolled && (await remainingRecoveryCodes(user.id)) === null) {
    console.error("[mfa] recovery code store unreachable; refusing to start setup");
    return { error: "Two-factor setup isn't available right now. Try again later." };
  }

  const supabase = await createClient();
  await discardPendingFactors(supabase, user.factors);

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: name.data,
    issuer: "Square Share",
  });
  if (error || !data || data.type !== "totp") {
    if (error?.code === "mfa_factor_name_conflict") {
      return { error: "You already have an authenticator with that name. Pick another." };
    }
    if (error?.code === "too_many_enrolled_mfa_factors") {
      return { error: "This account has as many authenticators as it can hold. Remove one first." };
    }
    console.warn("[mfa] enroll failed:", error?.code, error?.message);
    return { error: "We couldn't start setup just now. Try again in a moment." };
  }

  const qrCode = qrDataUrl(data.totp.qr_code);
  if (!qrCode || !data.totp.secret) {
    await supabase.auth.mfa.unenroll({ factorId: data.id }).catch(() => undefined);
    return { error: "We couldn't start setup just now. Try again in a moment." };
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

export type ConfirmSetupState = {
  error?: string;
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
  if (rejected) return { error: rejected };

  const state = await getSessionState();
  if (state.kind !== "signed_in") return { error: SESSION_EXPIRED };
  const { user, assurance } = state;

  const factorId = factorIdSchema.safeParse(String(formData.get("factor_id") ?? ""));
  if (!factorId.success) return { error: "Setup expired. Start again." };
  // Must be THIS account's pending factor: never a verified one (that would
  // make "confirm setup" a way to exercise someone's existing factor) and
  // never someone else's.
  const pending = (user.factors ?? []).find(
    (f) => f.id === factorId.data && f.status !== "verified",
  );
  if (!pending) return { error: "Setup expired. Start again." };

  const code = totpCodeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? "Enter the 6-digit code." };
  }

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
    return {
      error:
        result.reason === "invalid"
          ? "That code didn't match. Make sure your app shows Square Share, then enter the newest code."
          : SECOND_FACTOR_MESSAGES[result.reason],
    };
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
      title: "Two-factor authentication is on",
      body: "Signing in to your account now needs a code from your authenticator app, and every other device was signed out. If this wasn't you, change your password and contact support.",
    });
  } else {
    await alertTwoFactorChange(user, "mfa.factor_added", {
      title: "An authenticator app was added",
      body: `"${pending.friendly_name ?? "Authenticator app"}" can now be used to sign in to your account. If this wasn't you, remove it in Settings › Security and change your password.`,
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

export type ManageState = {
  error?: string;
  success?: string;
  stepUp?: true;
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
  if (rejected) return { error: rejected };

  const state = await getSessionState();
  if (state.kind !== "signed_in") return { error: SESSION_EXPIRED };
  const { user, assurance } = state;

  const factorId = factorIdSchema.safeParse(String(formData.get("factor_id") ?? ""));
  const target = factorId.success
    ? assurance.factors.find((f) => f.id === factorId.data)
    : undefined;
  if (!target) return { error: "That authenticator isn't on your account." };

  const refused = await requireStepUp(formData, { maxAgeSeconds: 0 });
  if (refused) return refused;

  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) {
    return { error: "That's a lot of changes in a short time. Try again a bit later." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: target.id });
  if (error) {
    console.warn("[mfa] unenroll failed:", error.code, error.message);
    return { error: "We couldn't remove that authenticator. Try again." };
  }

  const wasLast = assurance.factors.length === 1;
  if (wasLast) {
    await clearRecoveryCodes(user.id);
    await alertTwoFactorChange(user, "mfa.disabled", {
      title: "Two-factor authentication is off",
      body: "Your last authenticator app was removed, so signing in now needs only your password. If this wasn't you, change your password and turn two-factor back on.",
    });
  } else {
    await alertTwoFactorChange(user, "mfa.factor_removed", {
      title: "An authenticator app was removed",
      body: `"${target.name}" can no longer be used to sign in to your account. If this wasn't you, change your password now.`,
    });
  }

  // The whole settings layout, not just this page: it carries the 2FA state
  // every sensitive form reads (StepUpProvider) and the rail's badge.
  revalidatePath("/settings", "layout");
  return {
    success: wasLast
      ? "Two-factor authentication is off."
      : `Removed "${target.name}".`,
  };
}

/** Replace the recovery codes with a new set. Always needs a code. */
export async function regenerateRecoveryCodes(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const rejected = unknownField(formData, [...STEP_UP_FIELDS]);
  if (rejected) return { error: rejected };

  const state = await getSessionState();
  if (state.kind !== "signed_in") return { error: SESSION_EXPIRED };
  const { user, assurance } = state;
  if (!assurance.enrolled) return { error: "Turn on two-factor authentication first." };

  const refused = await requireStepUp(formData, { maxAgeSeconds: 0 });
  if (refused) return refused;

  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) {
    return { error: "That's a lot of changes in a short time. Try again a bit later." };
  }

  const codes = await issueRecoveryCodes(user.id);
  if (!codes) return { error: "We couldn't create new codes. Your old ones still work." };

  await alertTwoFactorChange(user, "mfa.recovery_codes_regenerated", {
    title: "New recovery codes were generated",
    body: "Your old recovery codes no longer work. If this wasn't you, change your password now.",
  });

  // The whole settings layout, not just this page: it carries the 2FA state
  // every sensitive form reads (StepUpProvider) and the rail's badge.
  revalidatePath("/settings", "layout");
  return { success: "New recovery codes ready. Your old ones no longer work.", codes };
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
  if (rejected) return { error: rejected };
  const refused = await requireStepUp(formData);
  if (refused) return refused;
  return { success: "Confirmed." };
}
