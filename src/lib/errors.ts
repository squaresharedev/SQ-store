import { msg, type MessageRef } from "@/i18n/types";
import type { TeamRole } from "@/lib/team/permissions";
import {
  TRADER_IDENTITY_HEADLINE,
  traderIdentityFix,
  traderIdentityHref,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";

/**
 * ACTION ERRORS: the ONE user-facing failure shape for server actions.
 *
 * Every failed action returns either `{ ok: false, error: ActionError }` or,
 * for a `useActionState` form, `{ error: ActionError }` (see ActionState). The
 * error carries what happened (`message`) and, wherever there is one, what the
 * user can do about it (`fix`).
 *
 * NOTHING HERE IS ENGLISH. `message`, `fix` and `action.label` are MessageRefs,
 * resolved in the reader's language at the render site
 * (`components/ui/ActionErrorNotice`). `code` is the stable machine-readable
 * half: log it, branch on it, never translate it.
 *
 * Build errors with the factories below (never object literals at call sites)
 * so wording stays consistent.
 *
 * Importable from client and server: pure data + pure functions, no secrets.
 * This module must NOT carry "use server"; these are sync factories, not
 * actions; server-action modules import from here.
 */

export type ActionErrorCode =
  | "session_expired"
  | "permission_denied"
  | "not_found"
  | "invalid_input"
  | "upload_failed"
  | "rate_limited"
  | "server_error"
  | "trader_identity_required"
  | "unexpected";

export interface ActionError {
  /** Stable machine-readable category, for programmatic handling and logs. */
  code: ActionErrorCode;
  /** What happened. */
  message: MessageRef;
  /**
   * What the user can do next. Every factory-built error with a generic
   * message has one. It is optional only because many form errors are a
   * single sentence that already names the next step ("That username is
   * taken. Try another."), and splitting those would change what a reader sees.
   */
  fix?: MessageRef;
  /**
   * An in-app destination that RESOLVES this error, when one exists.
   *
   * Only set by errors whose fix is "go to this other page and fill something
   * in": a message telling someone to open Settings is worth less than a
   * button that opens it. `ActionErrorNotice` renders it as that button; no
   * consumer has to know which codes carry one.
   */
  action?: { href: string; label: MessageRef };
}

/** The failure half of an action result. */
export type ActionFailure = { ok: false; error: ActionError };

/** Build the `{ ok: false, error }` result shape in one call. */
export function failure(error: ActionError): ActionFailure {
  return { ok: false, error };
}

/**
 * What a `useActionState` form action settles into. `{}` is the initial state
 * and also means "nothing to report". A fresh object per dispatch, so a render
 * site can tell two identical results apart by identity.
 */
export type ActionState = {
  error?: ActionError;
  success?: MessageRef;
  /**
   * The action needs a fresh two-factor code before it will run (see
   * requireStepUpState in lib/auth/mfa.ts). The form shows its StepUpField and
   * the person resubmits.
   */
  stepUp?: true;
};

/** `{ error }` for a form action. */
export function failed(error: ActionError): ActionState {
  return { error };
}

/** `{ success }` for a form action. */
export function succeeded(message: MessageRef): ActionState {
  return { success: message };
}

/**
 * An error with its own copy, for the specific refusals a form reports
 * ("That username is taken. Try another."). Prefer a named factory when one
 * fits; this is for the ones that are only ever said in one place.
 */
export function actionError(
  code: ActionErrorCode,
  message: MessageRef,
  fix?: MessageRef,
): ActionError {
  return fix ? { code, message, fix } : { code, message };
}

export function sessionExpired(): ActionError {
  return {
    code: "session_expired",
    message: msg("Errors.sessionExpired.message"),
    fix: msg("Errors.sessionExpired.fix"),
  };
}

/**
 * What a permission error can be ABOUT. A closed set of keys rather than a
 * verb phrase spliced into a sentence: word order and case differ by language,
 * so each capability owns its whole sentence.
 */
export type PermissionCapability =
  | "createProducts"
  | "editProducts"
  | "deleteProducts"
  | "importProducts"
  | "previewProductPages"
  | "createStorefronts"
  | "editStorefronts"
  | "deleteStorefronts"
  | "viewStorefronts"
  | "editThisProduct"
  | "editThisStorefront";

/**
 * Role-aware permission error: names the caller's actual role, what it can't
 * do, and who can change it. The role goes in as DATA (an ICU select), never as
 * a translated label.
 */
export function permissionDenied(
  role: TeamRole | null | undefined,
  capability: PermissionCapability,
): ActionError {
  return {
    code: "permission_denied",
    message: role
      ? msg(`Errors.permissionDenied.${capability}.withRole`, { role })
      : msg(`Errors.permissionDenied.${capability}.noRole`),
    fix: msg("Errors.permissionDenied.fix"),
  };
}

/** What can be missing. Each has its own sentence (see PermissionCapability). */
export type NotFoundEntity = "product" | "storefront" | "item";

export function notFound(entity: NotFoundEntity): ActionError {
  return {
    code: "not_found",
    message: msg(`Errors.notFound.${entity}`),
    fix: msg("Errors.notFound.fix"),
  };
}

export function invalidInput(message: MessageRef, fix?: MessageRef): ActionError {
  return actionError("invalid_input", message, fix);
}

/** Upload verification / transfer failures (message and fix are kind-aware). */
export function uploadFailed(message: MessageRef, fix: MessageRef): ActionError {
  return { code: "upload_failed", message, fix };
}

/** The write a spent budget refused. Each has its own sentence. */
export type RateLimitedOperation =
  | "createProducts"
  | "editProducts"
  | "deleteProducts"
  | "importProducts"
  | "previewProductPages"
  | "createStorefronts"
  | "saveStorefronts"
  | "deleteStorefronts"
  | "rotateEmbedKeys"
  | "updateStock"
  | "readProductPageSettings"
  | "requestReview";

/**
 * A signed-in write budget is spent (lib/rate-limit.ts).
 *
 * Deliberately does NOT state the limit or when it resets: the numbers are an
 * implementation detail, and publishing them mainly helps someone pace their
 * requests to sit just under. A real user hitting one of these budgets has
 * almost certainly got a stuck client, which the fix speaks to.
 */
export function rateLimited(operation: RateLimitedOperation): ActionError {
  return {
    code: "rate_limited",
    message: msg(`Errors.rateLimited.${operation}`),
    fix: msg("Errors.rateLimited.fix"),
  };
}

/**
 * The publish gate refused: this account has not disclosed the trader details
 * a buyer is entitled to before contracting (lib/settings/trader-identity.ts).
 *
 * Carries an `action` so every surface that renders it (the product form, the
 * embed modal, a toast) offers the same one-click route to the page that fixes
 * it, rather than each one re-deciding where to send the seller.
 */
export function traderIdentityRequired(
  missing: readonly TraderIdentityField[],
): ActionError {
  return {
    code: "trader_identity_required",
    message: TRADER_IDENTITY_HEADLINE,
    fix: traderIdentityFix(missing),
    action: {
      href: traderIdentityHref(missing),
      label: msg("Errors.traderIdentityRequired.action"),
    },
  };
}

/** The operation that failed on our side. Each has its own sentence. */
export type ServerErrorOperation =
  | "createProduct"
  | "saveProduct"
  | "deleteProduct"
  | "importProducts"
  | "loadProductPagePreview"
  | "verifyImageUpload"
  | "verifyDocumentUpload"
  | "verifyFileUpload"
  | "verifyFontUpload"
  | "verifyElementUpload"
  | "verifyBackgroundImage"
  | "verifyFont"
  | "verifyImage"
  | "createStorefront"
  | "saveStorefront"
  | "saveEmbedSettings"
  | "deleteStorefront"
  | "rotateEmbedKey"
  | "saveStockSettings"
  | "checkSellerDetails"
  | "loadProductPageSettings"
  | "saveProductPageSettings"
  | "sendForReview";

export function serverError(operation: ServerErrorOperation): ActionError {
  return {
    code: "server_error",
    message: msg(`Errors.serverError.${operation}`),
    fix: msg("Errors.serverError.fix"),
  };
}

/**
 * Client-side catch-all (network failures, thrown upload errors, ...).
 *
 * `detail` is whatever the runtime threw, shown as it was before this module
 * held message keys. It is not our copy and cannot be translated; it goes in as
 * data.
 */
export function unexpectedError(detail?: string): ActionError {
  return {
    code: "unexpected",
    message: detail
      ? msg("Errors.unexpected.detail", { detail })
      : msg("Errors.unexpected.message"),
    fix: msg("Errors.unexpected.fix"),
  };
}
