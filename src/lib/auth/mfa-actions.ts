"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getSessionState, revokeOtherSessions } from "@/lib/auth/session";
import { proveSetupOwnership, readyToEnroll } from "@/lib/auth/setup-guards";
import { unknownField } from "@/lib/validation/form-fields";
import { PASSKEY_FACTOR_PREFIX } from "@/lib/auth/assurance";
import {
  authenticationOptions,
  completeFactor,
  credentialIdsFor,
  forgetPasskey,
  parseCredential,
  passkeysConfigured,
  registrationOptions,
  storePasskey,
  verifyAssertion,
  verifyRegistration,
} from "@/lib/auth/passkeys";
import {
  SECOND_FACTOR_ERRORS,
  STEP_UP_FIELDS,
  alertTwoFactorChange,
  clearRecoveryCodes,
  deleteAllFactors,
  discardPendingFactors,
  issueRecoveryCodes,
  pickFactor,
  requireStepUpState,
  restoreRecoveryCode,
  spendRecoveryCode,
  takeSecondFactorAttempt,
  verifySecondFactor,
} from "@/lib/auth/mfa";
import { recordSecurityEvent } from "@/lib/security/events";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { afterChallenge, syncAccountLocale } from "@/lib/auth/challenge";
import {
  JUST_VERIFIED_SECONDS,
  RECENT_SIGN_IN_SECONDS,
  secondFactorIsFresh,
  signedInRecently,
  type SessionAssurance,
} from "@/lib/auth/assurance";
import { removeApprovalFactor } from "@/lib/auth/sign-in-approval";
import { grantPasskeyOffer, hasPasskeyOffer, spendPasskeyOffer } from "@/lib/auth/passkey-offer";
import { accountFactors, realFactors } from "@/lib/auth/account-factors";
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
  type ActionError,
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

/** A code that did not parse as six digits, in the schema's own words. */
function malformedCode(error: z.ZodError): ActionState {
  return failed(invalidInput(firstIssue(error, msg("Errors.mfa.enterCode"))));
}

// ---------------------------------------------------------------------------
// Sign-in challenge
// ---------------------------------------------------------------------------

export type ChallengeState = ActionState & {
  /** The half-signed-in session is gone; the page offers "sign in again". */
  expired?: boolean;
  /**
   * The second factor went through: this session is aal2 already (the
   * cookies in this response say so). The page shows its moment of success,
   * then goes to `next`, which was sanitised here (afterChallenge) and is
   * never taken from the browser.
   */
  verified?: { next: string };
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
  // This sign-in came through the person's own authenticator app, so this
  // device may be offered a passkey of its own (lib/auth/passkey-offer.ts).
  await grantPasskeyOffer(state.user.id, state.assurance.sessionId);

  return { verified: { next } };
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

  // Who may enrol, and whether enrolling can go ahead at all: the same rules
  // for an app as for a passkey (lib/auth/setup-guards.ts).
  const unproven = await proveSetupOwnership(formData, user, assurance);
  if (unproven) return unproven;
  const notReady = await readyToEnroll(user.id, assurance);
  if (notReady) return notReady;

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
// Passkeys (see lib/auth/passkeys.ts for how a passkey is a second factor)
// ---------------------------------------------------------------------------

const PASSKEYS_UNAVAILABLE: ActionState = failed(
  actionError("server_error", msg("Errors.passkey.unavailable")),
);

export type BeginPasskeySetupState = ActionState & {
  reauth?: boolean;
  /** Step 1 done: what the browser needs to create the passkey. */
  registration?: {
    factorId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  };
};

/**
 * Step 1 of a passkey: the same proof of ownership as an authenticator app
 * (lib/auth/setup-guards.ts), then a pending GoTrue factor whose secret stays
 * on the server, and the options the browser creates the passkey from.
 */
export async function beginPasskeySetup(
  _prev: BeginPasskeySetupState,
  formData: FormData,
): Promise<BeginPasskeySetupState> {
  const rejected = unknownField(formData, ["name", "current_password", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;
  if (!(await passkeysConfigured())) return PASSKEYS_UNAVAILABLE;

  const name = factorNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!name.success) {
    return failed(invalidInput(firstIssue(name.error, msg("Errors.mfa.factorNameRequired"))));
  }
  if (assurance.factors.some((f) => f.name.toLowerCase() === name.data.toLowerCase())) {
    return FACTOR_NAME_TAKEN;
  }

  const unproven = await proveSetupOwnership(formData, user, assurance);
  if (unproven) return unproven;
  const notReady = await readyToEnroll(user.id, assurance);
  if (notReady) return notReady;

  return enrolPasskey(user, name.data, { thisDevice: false });
}

/**
 * A pending passkey factor at GoTrue and the options the browser creates the
 * passkey from. Callers have already proven it is the owner.
 */
async function enrolPasskey(
  user: Pick<User, "id" | "email" | "factors">,
  name: string,
  { thisDevice }: { thisDevice: boolean },
): Promise<BeginPasskeySetupState> {
  const supabase = await createClient();
  await discardPendingFactors(supabase, user.factors);

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `${PASSKEY_FACTOR_PREFIX}${name}`,
    issuer: "Square Share",
  });
  if (error || !data || data.type !== "totp" || !data.totp.secret) {
    if (error?.code === "mfa_factor_name_conflict") return FACTOR_NAME_TAKEN;
    if (error?.code === "too_many_enrolled_mfa_factors") {
      return failed(invalidInput(msg("Errors.mfa.tooManyFactors")));
    }
    console.warn("[passkeys] enroll failed:", error?.code, error?.message);
    return SETUP_FAILED;
  }

  const options = await registrationOptions({
    user,
    factorId: data.id,
    secret: data.totp.secret,
    name,
    excludeCredentialIds: await credentialIdsFor(user.id),
    thisDevice,
  });
  if (!options) {
    await supabase.auth.mfa.unenroll({ factorId: data.id }).catch(() => undefined);
    return SETUP_FAILED;
  }
  return { registration: { factorId: data.id, options } };
}

/**
 * Step 2: the new passkey, straight from the browser. Verified, stored with
 * its factor's secret sealed, and only then is the factor completed at
 * GoTrue, which switches it on and makes THIS session aal2. In that order so
 * that a factor can never be live without the passkey that unlocks it.
 */
export async function confirmPasskeySetup(
  _prev: ConfirmSetupState,
  formData: FormData,
): Promise<ConfirmSetupState> {
  const rejected = unknownField(formData, ["credential"]);
  if (rejected) return rejected;
  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  if (!(await takeSecondFactorAttempt(state.user.id, state.user.email, "setup"))) {
    return failed(SECOND_FACTOR_ERRORS.rate_limited);
  }
  return finishPasskeySetup(state, formData, { signOutOthers: true });
}

/**
 * "Create a passkey on this device", offered at the end of a sign-in that was
 * completed with a code from the person's authenticator app, so that next time
 * this device is one tap.
 *
 * THE PROOF IS THE CHALLENGE JUST PASSED. Adding a factor to an account with
 * 2FA normally takes a second proof in the same request (proveSetupOwnership):
 * a session found or stolen later must not be able to plant its own passkey.
 * Here all of these must hold:
 *   - a ticket minted ONLY by that code challenge, for this session
 *     (lib/auth/passkey-offer.ts). Never after a sign-in approval (someone
 *     talked into approving would hand over a permanent passkey) and never
 *     from a later step-up;
 *   - the second factor passed within JUST_VERIFIED_SECONDS and the password
 *     (or Google, or link) within RECENT_SIGN_IN_SECONDS, both from the
 *     token's amr claim, which the browser cannot forge.
 * The owner is alerted as for any added factor.
 */
export async function beginPasskeyHere(
  _prev: BeginPasskeySetupState,
  formData: FormData,
): Promise<BeginPasskeySetupState> {
  const rejected = unknownField(formData, ["name"]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user, assurance } = state;
  if (
    !assurance.enrolled ||
    !secondFactorIsFresh(assurance, JUST_VERIFIED_SECONDS) ||
    !signedInRecently(assurance, RECENT_SIGN_IN_SECONDS) ||
    !(await hasPasskeyOffer(user.id, assurance.sessionId))
  ) {
    return failed(invalidInput(msg("Errors.passkey.offerExpired")));
  }
  if (!(await passkeysConfigured())) return PASSKEYS_UNAVAILABLE;

  const name = factorNameSchema.safeParse(String(formData.get("name") ?? ""));
  if (!name.success) {
    return failed(invalidInput(firstIssue(name.error, msg("Errors.mfa.factorNameRequired"))));
  }
  if (assurance.factors.some((f) => f.name.toLowerCase() === name.data.toLowerCase())) {
    return FACTOR_NAME_TAKEN;
  }
  const notReady = await readyToEnroll(user.id, assurance);
  if (notReady) return notReady;

  return enrolPasskey(user, name.data, { thisDevice: true });
}

/**
 * Step 2 of beginPasskeyHere, under the same ticket, which it spends. Unlike
 * Settings, the account's other sessions stay signed in: this is the person
 * finishing their own sign-in, not a credential change made in alarm.
 */
export async function confirmPasskeyHere(
  _prev: ConfirmSetupState,
  formData: FormData,
): Promise<ConfirmSetupState> {
  const rejected = unknownField(formData, ["credential"]);
  if (rejected) return rejected;
  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  if (!(await hasPasskeyOffer(state.user.id, state.assurance.sessionId))) {
    return failed(invalidInput(msg("Errors.passkey.offerExpired")));
  }
  if (!(await takeSecondFactorAttempt(state.user.id, state.user.email, "setup"))) {
    return failed(SECOND_FACTOR_ERRORS.rate_limited);
  }
  const result = await finishPasskeySetup(state, formData, { signOutOthers: false });
  if (result.done) await spendPasskeyOffer();
  return result;
}

/**
 * The shared rest of both passkey confirms, for a caller that has already
 * checked the fields and the session and spent a second-factor attempt (each
 * does so in its own body, where the action registry test can see it).
 */
async function finishPasskeySetup(
  { user, assurance }: { user: User; assurance: SessionAssurance },
  formData: FormData,
  { signOutOthers }: { signOutOthers: boolean },
): Promise<ConfirmSetupState> {
  const response = parseCredential<RegistrationResponseJSON>(formData.get("credential"));
  if (!response) return failed(invalidInput(msg("Errors.passkey.createFailed")));

  const result = await verifyRegistration({ userId: user.id, response });
  if (!result.ok) {
    if (result.reason === "expired") return SETUP_EXPIRED;
    if (result.reason === "invalid") return failed(invalidInput(msg("Errors.passkey.createFailed")));
    return SETUP_FAILED;
  }
  const { passkey } = result;
  // THIS account's pending factor, the one the slip was minted for.
  const pending = (user.factors ?? []).find(
    (f) => f.id === passkey.factorId && f.status !== "verified",
  );
  if (!pending) return SETUP_EXPIRED;

  const firstFactor = !assurance.enrolled;
  const supabase = await createClient();
  if (!(await storePasskey(user.id, passkey))) {
    await supabase.auth.mfa.unenroll({ factorId: passkey.factorId }).catch(() => undefined);
    return SETUP_FAILED;
  }
  const completed = await completeFactor(supabase, passkey.factorId, passkey.secret);
  if (!completed.ok) {
    await forgetPasskey(user.id, passkey.factorId);
    await supabase.auth.mfa.unenroll({ factorId: passkey.factorId }).catch(() => undefined);
    return SETUP_FAILED;
  }

  // From here exactly as for an authenticator app (confirmTwoFactorSetup).
  if (signOutOthers) await revokeOtherSessions(supabase);

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
      body: {
        key: "Notifications.messages.security.factorAdded.body",
        values: { name: passkey.name },
      },
    });
  }

  revalidatePath("/settings", "layout");
  return { done: true, codes };
}

export type PasskeyOptionsResult = {
  options?: PublicKeyCredentialRequestOptionsJSON;
  /** Sealed proof of the challenge, posted back with the assertion. */
  slip?: string;
  error?: ActionError;
};

/**
 * Options for the sign-in challenge's "Use your passkey". Only for a session
 * that has passed its first factor and still owes the second.
 */
export async function passkeySignInOptions(): Promise<PasskeyOptionsResult> {
  const state = await getSessionState();
  if (state.kind !== "needs_mfa") return { error: SESSION_EXPIRED.error };
  const challenge = await authenticationOptions({
    userId: state.user.id,
    purpose: "sign_in",
    verifiedFactorIds: state.assurance.factors.map((factor) => factor.id),
  });
  return challenge ?? { error: PASSKEYS_UNAVAILABLE.error };
}

/** Options for confirming a sensitive change with a passkey (StepUpField). */
export async function passkeyStepUpOptions(): Promise<PasskeyOptionsResult> {
  const state = await getSessionState();
  if (state.kind !== "signed_in" || !state.assurance.enrolled) {
    return { error: SESSION_EXPIRED.error };
  }
  const challenge = await authenticationOptions({
    userId: state.user.id,
    purpose: "step_up",
    verifiedFactorIds: state.assurance.factors.map((factor) => factor.id),
  });
  return challenge ?? { error: PASSKEYS_UNAVAILABLE.error };
}

/**
 * The second half of signing in, with a passkey instead of a typed code.
 * Same budgets, same "someone has your password" alerting on failure.
 */
export async function verifyPasskeySignIn(
  _prev: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const rejected = unknownField(formData, ["credential", "slip", "next"]);
  if (rejected) return rejected;
  const next = afterChallenge(formData.get("next"));

  const state = await getSessionState();
  if (state.kind === "unreachable") return UNREACHABLE;
  if (state.kind === "signed_out") return challengeExpired();
  if (state.kind === "signed_in") redirect(next);

  const { user, assurance } = state;
  const response = parseCredential<AuthenticationResponseJSON>(formData.get("credential"));
  if (!response) return failed(invalidInput(msg("Errors.passkey.signInFailed")));
  const slip = formData.get("slip");
  if (typeof slip !== "string" || !slip) return failed(invalidInput(msg("Errors.passkey.expired")));
  if (!(await takeSecondFactorAttempt(user.id, user.email, "sign_in"))) {
    return failed(SECOND_FACTOR_ERRORS.rate_limited);
  }

  const assertion = await verifyAssertion({
    userId: user.id,
    purpose: "sign_in",
    response,
    slip,
    verifiedFactorIds: assurance.factors.map((factor) => factor.id),
  });
  if (!assertion.ok) {
    if (assertion.reason === "invalid") {
      await recordSecurityEvent({ userId: user.id, event: "mfa.challenge_failed" });
      return failed(invalidInput(msg("Errors.passkey.signInFailed")));
    }
    if (assertion.reason === "expired") return failed(invalidInput(msg("Errors.passkey.expired")));
    return failed(SECOND_FACTOR_ERRORS.unavailable);
  }

  const supabase = await createClient();
  const completed = await completeFactor(supabase, assertion.factorId, assertion.secret);
  if (!completed.ok) return failed(SECOND_FACTOR_ERRORS.unavailable);

  await syncAccountLocale(supabase, user.id);
  return { verified: { next } };
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
 *
 * Any factor on the account can be removed here, including one the app does
 * not recognise (lib/auth/account-factors.ts), except the approval factor,
 * which belongs to the sign-in approval switch. "Last" counts only real ways
 * in (apps and passkeys).
 */
export async function removeAuthenticator(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const rejected = unknownField(formData, ["factor_id", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") return SESSION_EXPIRED;
  const { user } = state;

  const factorId = factorIdSchema.safeParse(String(formData.get("factor_id") ?? ""));
  const all = await accountFactors(user);
  if (!all) return failed(actionError("server_error", msg("Errors.mfa.removeFailed")));
  const target = factorId.success
    ? all.find((f) => f.id === factorId.data && f.kind !== "approval")
    : undefined;
  if (!target) return failed(actionError("not_found", msg("Errors.mfa.factorNotOnAccount")));
  const real = realFactors(all);
  const wasLast = real.length === 1 && real[0].id === target.id;
  // Not while a factor the app doesn't know is still there: 2FA would stay on
  // with only that one left to sign in with. It is listed with its own Remove.
  if (wasLast && all.some((f) => f.kind === "unknown")) {
    return failed(invalidInput(msg("Errors.mfa.removeUnknownFirst")));
  }

  const refused = await requireStepUpState(formData, { maxAgeSeconds: 0 });
  if (refused) return refused;

  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) return TOO_MANY_CHANGES;

  // Sign-in approval is never a way in on its own: with no passkey or app
  // left, 2FA is off, and its factor goes too. FIRST, and only on success
  // does the last real factor go: the other order could leave a hidden
  // verified factor as the account's only one (2FA still on, nothing to sign
  // in with, recovery codes cleared).
  if (wasLast && !(await removeApprovalFactor(user.id))) {
    return failed(actionError("server_error", msg("Errors.mfa.removeFailed")));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: target.id });
  if (error) {
    console.warn("[mfa] unenroll failed:", error.code, error.message);
    return failed(actionError("server_error", msg("Errors.mfa.removeFailed")));
  }

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
