"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSessionState } from "@/lib/auth/session";
import { afterChallenge, syncAccountLocale } from "@/lib/auth/challenge";
import { alertTwoFactorChange, requireStepUpState, STEP_UP_FIELDS } from "@/lib/auth/mfa";
import { completeFactorWithCode } from "@/lib/auth/passkeys";
import { PASSWORD_SETTINGS_PATH } from "@/lib/auth/paths";
import { countryFromHeader, deviceFromUserAgent } from "@/lib/auth/device-label";
import {
  approvalsConfigured,
  approvalsEnabled,
  cancelApprovalRequest,
  collectApproval,
  createApprovalRequest,
  decideApprovalRequest,
  findApprovalRequest,
  isApprovalToken,
  prepareApprovalFactor,
  setApprovalsEnabled,
  waitingStatus,
  type NewApprovalRequest,
} from "@/lib/auth/sign-in-approval";
import { alertSecurityEvent, recordSecurityEvent } from "@/lib/security/events";
import { RATE_LIMITS, clientKey, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { unknownField } from "@/lib/validation/form-fields";
import { uuidField } from "@/lib/validation/inputs";
import {
  actionError,
  failed,
  invalidInput,
  succeeded,
  type ActionError,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import type { ChallengeState } from "@/lib/auth/mfa-actions";

/**
 * Sign-in approval, both halves (see lib/auth/sign-in-approval.ts for the
 * design): the session waiting at the two-factor step asks and collects; a
 * signed-in session of the same account approves or denies. Plus the switch
 * in Settings › Security.
 *
 * Every action starts from getSessionState() and checks the state it NEEDS,
 * exactly like the rest of 2FA: asking and collecting only for a session that
 * still owes its second factor, deciding and switching only for a fully
 * signed-in one. A request id or token from the browser is never trusted to be
 * the caller's own; each lookup is scoped to the caller's account and, for the
 * waiting side, its session.
 */

const SESSION_EXPIRED: ActionError = actionError(
  "session_expired",
  msg("Errors.mfa.signInExpired"),
);
const UNAVAILABLE: ActionError = actionError("server_error", msg("Errors.approval.unavailable"));

/** Only ever parsed for success (a bad id just means "no such request"). */
const requestIdSchema = uuidField();

// ---------------------------------------------------------------------------
// The waiting side
// ---------------------------------------------------------------------------

export type StartApprovalResult = {
  request?: NewApprovalRequest;
  error?: ActionError;
};

/**
 * Show a QR code: a new request for this waiting session (any earlier one of
 * its own is withdrawn). What the phone will be shown about this device is
 * read here, from this request's own headers.
 */
export async function startSignInApproval(): Promise<StartApprovalResult> {
  const state = await getSessionState();
  if (state.kind !== "needs_mfa") return { error: SESSION_EXPIRED };
  const { user, assurance } = state;
  if (!assurance.sessionId) return { error: SESSION_EXPIRED };
  if (!(await approvalsConfigured()) || (await approvalsEnabled(user.id)) !== true) {
    return { error: UNAVAILABLE };
  }

  const head = await headers();
  // Keyed budgets: this session is aal1, so the session-keyed limiter (whose
  // database function refuses a half-signed-in 2FA account) is not an option.
  const withinBudget =
    (await rateLimitKey(`approval:${user.id}`, "mfa_approval_start", RATE_LIMITS.mfaApprovalStart)) &&
    (await rateLimitKey(
      await clientKey(head),
      "mfa_approval_start_client",
      RATE_LIMITS.mfaApprovalStartPerClient,
    ));
  if (!withinBudget) {
    return { error: actionError("rate_limited", msg("Errors.approval.rateLimited")) };
  }

  const request = await createApprovalRequest({
    userId: user.id,
    sessionId: assurance.sessionId,
    device: deviceFromUserAgent(head.get("user-agent")),
    country: countryFromHeader(head.get("cf-ipcountry")),
  });
  return request ? { request } : { error: UNAVAILABLE };
}

export type ApprovalPoll = ChallengeState & {
  /** Still waiting; the page asks again shortly. */
  waiting?: boolean;
  /** The phone said no. */
  denied?: boolean;
  /** The QR code timed out (or was withdrawn): the page offers a new one. */
  lapsed?: boolean;
};

/**
 * Has the phone answered? Asked every few seconds by the waiting page. When
 * the answer is yes, this is also where the sign-in completes: the approval is
 * spent (once), and the approval factor is completed on THIS session's own
 * client, which upgrades it to aal2 and writes the new tokens to the cookies.
 */
export async function checkSignInApproval(
  requestId: string,
  rawNext: string,
): Promise<ApprovalPoll> {
  const next = afterChallenge(rawNext);
  const state = await getSessionState();
  if (state.kind === "unreachable") return { waiting: true };
  if (state.kind === "signed_out") return { error: SESSION_EXPIRED, expired: true };
  // Already through (another tab, or the moment this request itself finished).
  if (state.kind === "signed_in") return { verified: { next } };

  const { user, assurance } = state;
  const id = requestIdSchema.safeParse(requestId);
  if (!id.success || !assurance.sessionId) return { lapsed: true };
  const own = { id: id.data, userId: user.id, sessionId: assurance.sessionId };

  const status = await waitingStatus(own);
  // A blip reading the row is not an answer: keep waiting.
  if (status === null || status === "pending") return { waiting: true };
  if (status === "denied") return { denied: true };
  if (status === "expired" || status === "gone") return { lapsed: true };

  // Approved. Switched off since? Then it no longer counts.
  if ((await approvalsEnabled(user.id)) !== true) return { error: UNAVAILABLE, lapsed: true };
  const collected = await collectApproval(own);
  if (!collected) return { lapsed: true };

  const supabase = await createClient();
  const completed = await completeFactorWithCode(supabase, collected.factorId, collected.code);
  if (!completed.ok) return { error: UNAVAILABLE, lapsed: true };

  await syncAccountLocale(supabase, user.id);
  return { verified: { next } };
}

/** The waiting page moved on (another method, a new code): withdraw its request. */
export async function cancelSignInApproval(requestId: string): Promise<void> {
  const state = await getSessionState();
  if (state.kind !== "needs_mfa" || !state.assurance.sessionId) return;
  const id = requestIdSchema.safeParse(requestId);
  if (!id.success) return;
  await cancelApprovalRequest({
    id: id.data,
    userId: state.user.id,
    sessionId: state.assurance.sessionId,
  });
}

// ---------------------------------------------------------------------------
// The approving side
// ---------------------------------------------------------------------------

export type DecideApprovalState = ActionState & {
  /** What was decided, for the page's closing words. */
  decided?: "approve" | "deny";
};

/**
 * Approve or deny, from the /approve page on a signed-in device. The token is
 * the QR code's own; the request it names must belong to the account signed
 * in HERE and still be open. Approving first prepares the approval factor on
 * this (aal2) session's client, and never verifies anything: see
 * lib/auth/sign-in-approval.ts for why that would sign the waiting device out.
 */
export async function decideSignInApproval(
  _prev: DecideApprovalState,
  formData: FormData,
): Promise<DecideApprovalState> {
  const rejected = unknownField(formData, ["token", "decision"]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") {
    return failed(actionError("session_expired", msg("Errors.form.sessionExpired")));
  }
  const { user } = state;

  const decision = formData.get("decision");
  if (decision !== "approve" && decision !== "deny") {
    return failed(invalidInput(msg("Errors.approval.expired")));
  }
  const token = formData.get("token");
  if (!isApprovalToken(token)) return failed(invalidInput(msg("Errors.approval.expired")));

  if (!(await rateLimit("mfa_approval_decide", RATE_LIMITS.mfaApprovalDecide))) {
    return failed(actionError("rate_limited", msg("Errors.approval.rateLimited")));
  }

  const request = await findApprovalRequest(token);
  if (!request || !request.open) return failed(invalidInput(msg("Errors.approval.expired")));
  if (request.userId !== user.id) return failed(invalidInput(msg("Errors.approval.otherAccount")));

  if (decision === "deny") {
    if (!(await decideApprovalRequest({ id: request.id, userId: user.id, decision }))) {
      return failed(invalidInput(msg("Errors.approval.expired")));
    }
    // The password was right and the person says it was not them: worth the
    // inbox as well as the log, like a lockout.
    await alertSecurityEvent(user.id, "mfa.sign_in_denied", {
      title: { key: "Notifications.messages.security.signInDenied.title" },
      body: { key: "Notifications.messages.security.signInDenied.body" },
      href: PASSWORD_SETTINGS_PATH,
      emailTo: user.email ?? null,
    });
    return { decided: "deny" };
  }

  if ((await approvalsEnabled(user.id)) !== true || !(await approvalsConfigured())) {
    return failed(UNAVAILABLE);
  }
  const supabase = await createClient();
  const prepared = await prepareApprovalFactor(supabase, user);
  if (!prepared) return failed(UNAVAILABLE);
  if (
    !(await decideApprovalRequest({
      id: request.id,
      userId: user.id,
      decision,
      factorId: prepared.factorId,
      code: prepared.code,
    }))
  ) {
    return failed(invalidInput(msg("Errors.approval.expired")));
  }
  // A new device is getting in on this say-so. Told by email too, so an
  // approval someone talked the owner into does not go unnoticed.
  await alertTwoFactorChange(user, "mfa.sign_in_approved", {
    title: { key: "Notifications.messages.security.signInApproved.title" },
    body: { key: "Notifications.messages.security.signInApproved.body" },
  });
  return { decided: "approve" };
}

// ---------------------------------------------------------------------------
// Settings › Security
// ---------------------------------------------------------------------------

/**
 * Turn sign-in approval on or off. Either way it changes which ways in the
 * account has, so it takes a recent second factor (step-up), like the other
 * sensitive settings.
 */
export async function setSignInApproval(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rejected = unknownField(formData, ["enabled", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const state = await getSessionState();
  if (state.kind !== "signed_in") {
    return failed(actionError("session_expired", msg("Errors.form.sessionExpired")));
  }
  const { user, assurance } = state;
  if (!assurance.enrolled) return failed(invalidInput(msg("Errors.mfa.notEnrolled")));

  const refused = await requireStepUpState(formData);
  if (refused) return refused;
  if (!(await rateLimit("mfa_manage", RATE_LIMITS.mfaManage))) {
    return failed(actionError("rate_limited", msg("Errors.form.tooManyChanges")));
  }

  const enabled = formData.get("enabled") === "on";
  if (!(await setApprovalsEnabled(user.id, enabled))) return failed(UNAVAILABLE);

  if (enabled) {
    await alertTwoFactorChange(user, "mfa.approvals_enabled", {
      title: { key: "Notifications.messages.security.approvalsEnabled.title" },
      body: { key: "Notifications.messages.security.approvalsEnabled.body" },
    });
  } else {
    await recordSecurityEvent({ userId: user.id, event: "mfa.approvals_disabled" });
  }

  revalidatePath("/settings", "layout");
  return succeeded(
    enabled
      ? msg("Settings.security.success.approvalsOn")
      : msg("Settings.security.success.approvalsOff"),
  );
}
