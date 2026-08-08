"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { FormStatus } from "@/components/settings/FormStatus";
import {
  changePassword,
  sendPasswordReset,
  type SettingsActionState,
} from "@/lib/settings/actions";

const INITIAL: SettingsActionState = {};

/**
 * The one place a password is set from settings.
 *
 * Two views, because there are genuinely two situations and mixing them into a
 * single form asks people to ignore half of it:
 *
 *   - "change": you know your current password. Re-authentication is required,
 *     and that is not negotiable from the client: `changePassword` verifies the
 *     old password server-side before Supabase is asked to set the new one.
 *   - "reset": you do not know it, or the account has never had one (an OAuth
 *     signup). A link goes to the account's OWN address, read from the session
 *     server-side. The form has no email field on purpose, so there is nothing
 *     to point at somebody else's inbox.
 *
 * An account with no password only ever sees "reset": there is no current
 * password to ask for, and pretending otherwise would be a dead end.
 */
export function PasswordModal({
  open,
  onClose,
  hasPassword,
  email,
}: {
  open: boolean;
  onClose: () => void;
  /** Resolved server-side from the password hash, not from `identities`. */
  hasPassword: boolean;
  email: string;
}) {
  // Initialised once per mount. PasswordCard keys this component on `open`, so
  // reopening remounts and lands back on the right view with no stale message
  // from the previous attempt. That beats resetting from an effect, which would
  // set state during render and cascade.
  const [view, setView] = React.useState<"change" | "reset">(
    hasPassword ? "change" : "reset",
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Hard corners, deliberately against the modal default. styles.md puts
      // modals on --radius-lg, but the auth surfaces are the documented
      // exception (see the "hard corners" auth card on /login) and this is one
      // of them. Scoped to this instance rather than the shared primitive, so
      // the invite modals keep following the design system. rounded-none is a
      // token (--radius-none), not a raw value.
      className="rounded-none sm:rounded-none"
      title={hasPassword ? "Change your password" : "Set a password"}
      description={
        view === "reset"
          ? `We'll email a link to ${email}. It expires shortly after it arrives.`
          : "Enter your current password, then the new one."
      }
    >
      {view === "change" ? (
        <ChangeView onForgot={() => setView("reset")} onDone={onClose} />
      ) : (
        <ResetView
          hasPassword={hasPassword}
          onBack={hasPassword ? () => setView("change") : undefined}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function ChangeView({
  onForgot,
  onDone,
}: {
  onForgot: () => void;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(changePassword, INITIAL);

  // Closing on success keeps the modal from sitting there looking unfinished.
  // The card underneath re-renders from the server with the new state.
  React.useEffect(() => {
    if (!state.success) return;
    const timer = setTimeout(onDone, 1200);
    return () => clearTimeout(timer);
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="current_password">Current password</Label>
        <PasswordInput
          id="current_password"
          name="current_password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="new_password">New password</Label>
        <PasswordInput
          id="new_password"
          name="new_password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
        {/* The ACTUAL rule, so the form does not invite a password it will
            then reject. Mirrors passwordProblem() in lib/auth/password.ts. */}
        <p className="font-inter text-xs text-muted-foreground">
          At least 8 characters, mixing cases, numbers or symbols (or a
          passphrase of 16+).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
      </div>

      <p className="font-inter text-xs text-muted-foreground">
        Every other device will be signed out.
      </p>

      <FormStatus state={state} showSuccess />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* type="button" matters: this sits INSIDE the change form, and a bare
            <button> would default to submit and fire changePassword instead of
            switching views. */}
        <Button type="button" variant="secondary" onClick={onForgot}>
          Forgot password?
        </Button>
        <Button type="submit" disabled={isPending} suppressHydrationWarning>
          {isPending ? (
            <>
              <Spinner />
              Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </div>
    </form>
  );
}

/**
 * How long the button stays shut after a link goes out.
 *
 * This is a UX guard, not the rate limit: the real budgets are server-side and
 * unbypassable (5/hour per user AND 5/hour per client in `sendPasswordReset`).
 * What this stops is someone clicking four times in ten seconds because the
 * mail has not landed yet, spending an hour's allowance on one impatient
 * minute and getting an error instead of an inbox.
 */
const RESEND_COOLDOWN_SECONDS = 60;
/** Survives the modal being closed and reopened, and a page reload with it;
 *  a cooldown you can skip by pressing Escape is not a cooldown. */
const LAST_SENT_KEY = "sq:password-reset-sent-at";

function readCooldown(): number {
  if (typeof window === "undefined") return 0;
  try {
    const at = Number(sessionStorage.getItem(LAST_SENT_KEY));
    if (!at) return 0;
    const left = RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - at) / 1000);
    return Math.max(0, left);
  } catch {
    return 0; // Storage can be disabled; the server limit still holds.
  }
}

function ResetView({
  hasPassword,
  onBack,
  onClose,
}: {
  hasPassword: boolean;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    sendPasswordReset,
    INITIAL,
  );
  // Seeded from storage at mount, so reopening the modal picks the countdown
  // up where it left off. Safe to read during render here: the modal returns
  // null while closed, so this view only ever renders in the browser.
  const [cooldown, setCooldown] = React.useState(readCooldown);
  const [sent, setSent] = React.useState(cooldown > 0);

  // Start the clock when a submission FINISHES successfully. Watching
  // `state.success` alone would not do: a resend returns the same string, so
  // the value never changes and the effect would not fire a second time.
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (wasPending.current && !isPending && state.success) {
      try {
        sessionStorage.setItem(LAST_SENT_KEY, String(Date.now()));
      } catch {
        // Non-fatal: the countdown just will not survive a reload.
      }
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
    wasPending.current = isPending;
  }, [isPending, state.success]);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const waiting = cooldown > 0;
  const label = isPending
    ? "Sending…"
    : waiting
      ? `Resend in ${cooldown}s`
      : sent
        ? "Resend email"
        : "Email me a link";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {!hasPassword && (
        <p className="font-inter text-sm text-muted-foreground">
          This account signs in with Google. Setting a password lets you sign in
          with your email or username as well, and does not remove Google.
        </p>
      )}

      <FormStatus state={state} showSuccess />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack ?? onClose}>
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button
          type="submit"
          disabled={isPending || waiting}
          suppressHydrationWarning
        >
          {isPending && <Spinner />}
          {label}
        </Button>
      </div>
    </form>
  );
}
