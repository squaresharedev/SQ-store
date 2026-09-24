"use client";

import * as React from "react";
import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { StepUpField } from "@/components/auth/StepUp";
import { RecoveryCodesDisplay } from "@/components/settings/security/RecoveryCodesDisplay";
import {
  beginTwoFactorSetup,
  cancelTwoFactorSetup,
  confirmTwoFactorSetup,
  signOutToReauthenticate,
  type BeginSetupState,
  type ConfirmSetupState,
} from "@/lib/auth/mfa-actions";
import { FACTOR_NAME_MAX } from "@/lib/validation/mfa";

const BEGIN_INITIAL: BeginSetupState = {};
const CONFIRM_INITIAL: ConfirmSetupState = {};

/** Where "Confirm with Google" comes back to: this page, with setup open. */
const SETUP_RETURN = "/settings/security?setup=1";

/** "Authenticator app", or the first numbered variant nobody has used yet. */
function suggestedName(taken: string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has("authenticator app")) return "Authenticator app";
  for (let n = 2; n < 100; n += 1) {
    if (!used.has(`authenticator app ${n}`)) return `Authenticator app ${n}`;
  }
  return "";
}

/** The secret in fours, the way authenticator apps display typed keys. */
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Turning 2FA on, or adding another authenticator. Three steps:
 *
 *   1. Prove it's you (password; or, adding, a code from an existing app; or,
 *      for a Google-only account, a recent sign-in) and name the app.
 *   2. Scan the QR code (or type the key) and enter the first code, which is
 *      what actually switches it on.
 *   3. First time only: the recovery codes, shown once.
 *
 * Closing during step 2 withdraws the half-made factor, so an abandoned setup
 * leaves nothing behind at GoTrue. Keyed on `open` by the caller, so every
 * opening starts clean.
 */
export function TwoFactorSetupModal({
  open,
  onClose,
  adding,
  hasPassword,
  signedInRecently,
  signsInWithGoogle,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  /** 2FA is already on and this adds another authenticator. */
  adding: boolean;
  hasPassword: boolean;
  /** Signed in within the last 10 minutes: that alone proves ownership. */
  signedInRecently: boolean;
  /** The account has a Google identity, so "Confirm with Google" is offered. */
  signsInWithGoogle: boolean;
  existingNames: string[];
}) {
  const toast = useToast();
  // Captured once: the page re-renders with 2FA ON halfway through this flow,
  // and the steps must not change meaning under the person's feet.
  const [mode] = React.useState(adding ? "add" : "enable");
  const [begin, beginAction, beginPending] = useActionState(beginTwoFactorSetup, BEGIN_INITIAL);
  const [confirm, confirmAction, confirmPending] = useActionState(
    confirmTwoFactorSetup,
    CONFIRM_INITIAL,
  );

  const enrollment = begin.enrollment;
  const finished = Boolean(confirm.done);
  const showCodes = finished && confirm.codes !== undefined;
  const step: "start" | "scan" | "codes" = showCodes ? "codes" : enrollment ? "scan" : "start";

  // Adding another authenticator has no codes step: done means done.
  React.useEffect(() => {
    if (finished && confirm.codes === undefined) {
      toast.success("Authenticator added.");
      onClose();
    }
  }, [finished, confirm.codes, onClose, toast]);

  function close() {
    // Withdraw a factor that was created but never verified.
    if (enrollment && !finished) {
      void cancelTwoFactorSetup(enrollment.factorId);
    }
    onClose();
  }

  const title =
    step === "codes"
      ? "Save your recovery codes"
      : mode === "add"
        ? "Add an authenticator app"
        : "Turn on two-factor authentication";

  const description =
    step === "start"
      ? mode === "add"
        ? "Use a second phone or app as a backup way to sign in."
        : "After this, signing in takes your password and a code from an app on your phone."
      : step === "scan"
        ? "Scan the code with your authenticator app, then enter the 6 digits it shows."
        : "Two-factor authentication is on.";

  // How this person proves it's them before a new phone can be enrolled.
  // A sign-in in the last 10 minutes is proof enough on its own. Otherwise a
  // password, if the account has one; and for a Google account, Google itself
  // ("Confirm with Google" signs in again and comes straight back here), which
  // is the way such a person actually signs in and may be the only one they
  // remember.
  const needsFreshSignIn = mode === "enable" && !hasPassword && !signedInRecently;
  const askPassword = mode === "enable" && hasPassword && !signedInRecently;
  const offerGoogle =
    mode === "enable" && !signedInRecently && (signsInWithGoogle || Boolean(begin.reauth));

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      // The auth surfaces keep hard corners (see PasswordModal).
      className="rounded-none sm:rounded-none"
    >
      {step === "start" && needsFreshSignIn && (
        <div className="flex flex-col gap-4">
          <p className={helpTextClass}>
            {signsInWithGoogle
              ? "Confirm it's you with Google first. You'll come straight back here to finish."
              : "For your security, sign in again first. You'll come straight back here to finish."}
          </p>
          {signsInWithGoogle ? (
            <GoogleButton next={SETUP_RETURN} label="Confirm with Google" />
          ) : (
            <form action={signOutToReauthenticate}>
              <Button type="submit" className="w-full">
                Sign in again
              </Button>
            </form>
          )}
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      )}

      {step === "start" && !needsFreshSignIn && (
        <form action={beginAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="factor-name">Name this authenticator</Label>
            <Input
              id="factor-name"
              name="name"
              defaultValue={suggestedName(existingNames)}
              maxLength={FACTOR_NAME_MAX}
              autoComplete="off"
              required
            />
            <p className={infoTextClass}>
              So you can tell your apps apart later, e.g. &ldquo;Pixel 8&rdquo;.
            </p>
          </div>

          {mode === "add" ? (
            <StepUpField
              id="setup-step-up"
              state={begin}
              always
              description="Enter a code from an authenticator you already use, to confirm it's you."
            />
          ) : askPassword ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="setup-password">
                {signsInWithGoogle ? "Square Share password" : "Current password"}
              </Label>
              <PasswordInput
                id="setup-password"
                name="current_password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
              <p className={infoTextClass}>
                {signsInWithGoogle
                  ? "Not your Google password. Don't know it? Confirm with Google below instead."
                  : "So nobody who finds your laptop signed in can lock you out with their own phone."}
              </p>
            </div>
          ) : mode === "enable" ? (
            <p className={infoTextClass}>
              You signed in a moment ago, so there&rsquo;s nothing else to confirm.
            </p>
          ) : null}

          {begin.error && (
            <p role="alert" className="font-inter text-sm font-medium text-destructive">
              {begin.error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={beginPending} suppressHydrationWarning>
              {beginPending ? (
                <>
                  <Spinner />
                  Checking…
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </div>
        </form>
      )}

      {/* Its own form, after the one above rather than inside it: forms
          cannot nest, and this one leaves the page for Google. */}
      {step === "start" && !needsFreshSignIn && offerGoogle && (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <span className="h-px flex-1 bg-border" />
            <span className={infoTextClass}>or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleButton next={SETUP_RETURN} label="Confirm with Google" />
        </div>
      )}

      {step === "scan" && enrollment && (
        <form action={confirmAction} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="factor_id" value={enrollment.factorId} />

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* A white tile in either theme: authenticator cameras read dark
                modules on a light ground, not the other way round. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL minted per setup; next/image cannot optimise it and must not cache it. */}
            <img
              src={enrollment.qrCode}
              alt="QR code to scan with your authenticator app"
              width={176}
              height={176}
              className="size-44 shrink-0 border border-border bg-white p-2"
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className={helpTextClass}>
                Any authenticator app works: Google Authenticator, Microsoft
                Authenticator, 1Password, Authy and others.
              </p>
              <p className={infoTextClass}>Can&rsquo;t scan it? Enter this key instead:</p>
              <div className="flex items-center gap-2">
                <code
                  className="min-w-0 break-all border border-border bg-muted/40 px-2 py-1.5 font-mono text-sm text-foreground"
                  aria-label="Setup key"
                >
                  {groupSecret(enrollment.secret)}
                </code>
                <CopyButton value={enrollment.secret} label="setup key" />
              </div>
              {/* On a phone the app is on the same device, so a tap beats a
                  scan. Harmless elsewhere, just less useful: hidden from sm. */}
              <a
                href={enrollment.uri}
                className="inline-flex items-center gap-1.5 font-inter text-sm font-medium text-foreground underline underline-offset-4 sm:hidden"
              >
                Open in authenticator app
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="setup-code">6-digit code from the app</Label>
            <OneTimeCodeInput
              id="setup-code"
              name="code"
              autoFocus
              required
              readOnly={confirmPending}
            />
          </div>

          {confirm.error && (
            <p role="alert" className="font-inter text-sm font-medium text-destructive">
              {confirm.error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={confirmPending} suppressHydrationWarning>
              {confirmPending ? (
                <>
                  <Spinner />
                  Verifying…
                </>
              ) : mode === "add" ? (
                "Verify and add"
              ) : (
                "Verify and turn on"
              )}
            </Button>
          </div>
        </form>
      )}

      {step === "codes" && (
        <RecoveryCodesDisplay
          codes={confirm.codes ?? null}
          onDone={() => {
            toast.success("Two-factor authentication is on.");
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
