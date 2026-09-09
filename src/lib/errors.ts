import { ROLE_LABELS, type TeamRole } from "@/lib/team/permissions";
import {
  TRADER_IDENTITY_HEADLINE,
  traderIdentityFix,
  traderIdentityHref,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";

/**
 * ACTION ERRORS: the ONE user-facing failure shape for server actions.
 *
 * Every failed action returns `{ ok: false, error: ActionError }` where the
 * error always carries BOTH what happened (`message`) and what the user can do
 * about it (`fix`). No bare strings: a message without a next step leaves the
 * user stuck, so the shape makes the fix non-optional.
 *
 * Build errors with the factories below (never object literals at call sites)
 * so wording stays consistent, and render them with
 * `components/ui/ActionErrorNotice` so message + fix always appear together.
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
  /** What happened, in plain language. */
  message: string;
  /** What the user can do next. Always present; never leave them guessing. */
  fix: string;
  /**
   * An in-app destination that RESOLVES this error, when one exists.
   *
   * Only set by errors whose fix is "go to this other page and fill something
   * in" — a message telling someone to open Settings is worth less than a
   * button that opens it. `ActionErrorNotice` renders it as that button; no
   * consumer has to know which codes carry one.
   */
  action?: { href: string; label: string };
}

/** The failure half of an action result. */
export type ActionFailure = { ok: false; error: ActionError };

/** Build the `{ ok: false, error }` result shape in one call. */
export function failure(error: ActionError): ActionFailure {
  return { ok: false, error };
}

export function sessionExpired(): ActionError {
  return {
    code: "session_expired",
    message: "Your session has expired.",
    fix: "Sign in again, then retry. Work you typed in this tab is kept until you leave the page.",
  };
}

/**
 * Role-aware permission error: names the caller's actual role, what it can't
 * do, and who can change it. `what` is the blocked capability as a verb
 * phrase, e.g. "edit products" or "edit storefronts".
 */
export function permissionDenied(
  role: TeamRole | null | undefined,
  what: string,
): ActionError {
  return {
    code: "permission_denied",
    message: role
      ? `Your ${ROLE_LABELS[role]} role can't ${what} in this store.`
      : `You don't have permission to ${what} in this store.`,
    fix: "Only the store owner can change roles. Ask them to upgrade you to Editor in Team settings.",
  };
}

/** `what` is the missing thing as a noun, e.g. "product" or "storefront". */
export function notFound(what: string): ActionError {
  return {
    code: "not_found",
    message: `That ${what} could not be found.`,
    fix: `It may have been deleted, or you may have switched stores. Refresh the page to load the current data.`,
  };
}

export function invalidInput(message: string, fix: string): ActionError {
  return { code: "invalid_input", message, fix };
}

/** Upload verification / transfer failures (message and fix are kind-aware). */
export function uploadFailed(message: string, fix: string): ActionError {
  return { code: "upload_failed", message, fix };
}

/** `what` is the failed operation as a verb phrase, e.g. "save the product". */
/**
 * A signed-in write budget is spent (lib/rate-limit.ts).
 *
 * Deliberately does NOT state the limit or when it resets: the numbers are an
 * implementation detail, and publishing them mainly helps someone pace their
 * requests to sit just under. A real user hitting one of these budgets has
 * almost certainly got a stuck client, which the fix speaks to.
 */
export function rateLimited(what: string): ActionError {
  return {
    code: "rate_limited",
    message: `Too many attempts to ${what} in a short time.`,
    fix: "Wait a few minutes and try again. If nothing is retrying in the background, reload the page first.",
  };
}

/**
 * The publish gate refused: this account has not disclosed the trader details
 * a buyer is entitled to before contracting (lib/settings/trader-identity.ts).
 *
 * Carries an `action` so every surface that renders it — the product form, the
 * embed modal, a toast — offers the same one-click route to the page that
 * fixes it, rather than each one re-deciding where to send the seller.
 */
export function traderIdentityRequired(
  missing: readonly TraderIdentityField[],
): ActionError {
  return {
    code: "trader_identity_required",
    message: TRADER_IDENTITY_HEADLINE,
    fix: traderIdentityFix(missing),
    action: { href: traderIdentityHref(missing), label: "Add seller details" },
  };
}

export function serverError(what: string): ActionError {
  return {
    code: "server_error",
    message: `Could not ${what} because of a problem on our side.`,
    fix: "This is usually temporary. Wait a moment and try again; if it keeps failing, refresh the page.",
  };
}

/** Client-side catch-all (network failures, thrown upload errors, …). */
export function unexpectedError(detail?: string): ActionError {
  return {
    code: "unexpected",
    message: detail || "Something went wrong.",
    fix: "Check your connection and try again. If it keeps happening, refresh the page; your product data is safe on the server.",
  };
}
