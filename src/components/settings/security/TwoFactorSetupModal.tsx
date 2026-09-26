"use client";

import * as React from "react";
import { useActionState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { STEP_SWAP } from "@/components/ui/motion-tokens";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { StepUpField } from "@/components/auth/StepUp";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { RecoveryCodesDisplay } from "@/components/settings/security/RecoveryCodesDisplay";
import {
  beginPasskeySetup,
  beginTwoFactorSetup,
  cancelTwoFactorSetup,
  confirmPasskeySetup,
  confirmTwoFactorSetup,
  signOutToReauthenticate,
  type BeginPasskeySetupState,
  type BeginSetupState,
  type ConfirmSetupState,
} from "@/lib/auth/mfa-actions";
import { createPasskey } from "@/lib/auth/webauthn-client";
import { FACTOR_NAME_MAX } from "@/lib/validation/mfa";
import { cn } from "@/lib/utils";

const BEGIN_INITIAL: BeginSetupState = {};
const PASSKEY_BEGIN_INITIAL: BeginPasskeySetupState = {};
const CONFIRM_INITIAL: ConfirmSetupState = {};

/** Where "Confirm with Google" comes back to: this page, with setup open. */
const SETUP_RETURN = "/settings/security?setup=1";

type Method = "passkey" | "app";

/**
 * The base name, or the first numbered variant nobody has used yet. The
 * words come from the caller, in the reader's language: the default name is
 * copy until the person keeps it.
 */
function suggestedName(
  taken: string[],
  base: string,
  numbered: (number: number) => string,
): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = numbered(n);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}

/** The secret in fours, the way authenticator apps display typed keys. */
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Turning 2FA on, or adding another way to confirm it's you. Three steps:
 *
 *   1. Choose a passkey (the default: nothing to install) or an authenticator
 *      app, name it, and prove it's you (password; or, adding, an existing
 *      passkey or app; or, for a Google-only account, a recent sign-in).
 *   2. Passkey: the browser's own prompt creates it (on a computer, with a
 *      QR code for the phone). App: scan the QR code, enter the first code.
 *      Either way that is what actually switches it on.
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
  passkeysAvailable,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  /** 2FA is already on and this adds another passkey or app. */
  adding: boolean;
  hasPassword: boolean;
  /** Signed in within the last 10 minutes: that alone proves ownership. */
  signedInRecently: boolean;
  /** The account has a Google identity, so "Confirm with Google" is offered. */
  signsInWithGoogle: boolean;
  /** Passkeys are configured in this deployment (server-side check). */
  passkeysAvailable: boolean;
  existingNames: string[];
}) {
  const t = useTranslations("Settings.security.setup");
  const tCommon = useTranslations("Common.actions");
  const resolve = useResolveMessage();
  const toast = useToast();
  // Captured once: the page re-renders with 2FA ON halfway through this flow,
  // and the steps must not change meaning under the person's feet.
  const [mode] = React.useState(adding ? "add" : "enable");
  const [method, setMethod] = React.useState<Method>(passkeysAvailable ? "passkey" : "app");

  const [begin, beginAction, beginPending] = useActionState(beginTwoFactorSetup, BEGIN_INITIAL);
  const [confirm, confirmAction, confirmPending] = useActionState(
    confirmTwoFactorSetup,
    CONFIRM_INITIAL,
  );
  const [passkeyBegin, passkeyBeginAction, passkeyBeginPending] = useActionState(
    beginPasskeySetup,
    PASSKEY_BEGIN_INITIAL,
  );
  const [passkeyConfirm, passkeyConfirmAction, passkeyConfirmPending] = useActionState(
    confirmPasskeySetup,
    CONFIRM_INITIAL,
  );

  const enrollment = begin.enrollment;
  const registration = passkeyBegin.registration;
  const done = confirm.done ? confirm : passkeyConfirm.done ? passkeyConfirm : null;
  const doneKind = passkeyConfirm.done ? "passkey" : "app";
  // Turning 2FA ON ends on the recovery codes; adding another way in (no
  // codes) ends on its own moment of success.
  const step: "start" | "scan" | "passkey" | "codes" | "added" = done
    ? done.codes !== undefined
      ? "codes"
      : "added"
    : registration
      ? "passkey"
      : enrollment
        ? "scan"
        : "start";
  const finished = Boolean(done);

  const reducedMotion = useReducedMotion();
  /**
   * Focus onto each step as it arrives (AnimatePresence waits for the old one
   * to leave, so only a callback ref knows when). Whatever the step itself
   * focused on mount (the code box, the "Create passkey" button) keeps it;
   * otherwise the step's container takes it, never the page behind.
   */
  const focusStep = React.useCallback((node: HTMLDivElement | null) => {
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, []);

  function close() {
    // Withdraw a factor that was created but never verified.
    const pending = registration?.factorId ?? enrollment?.factorId;
    if (pending && !finished) void cancelTwoFactorSetup(pending);
    onClose();
  }

  const title =
    step === "codes"
      ? t("titleCodes")
      : step === "passkey"
        ? t("titlePasskey")
        : mode === "add"
          ? t("titleAdd")
          : t("titleEnable");

  const description =
    step === "start"
      ? mode === "add"
        ? t("descriptionAdd")
        : t("descriptionEnable")
      : step === "scan"
        ? t("descriptionScan")
        : step === "passkey"
          ? t("descriptionPasskey")
          : t("descriptionCodes");

  // How this person proves it's them before a new factor can be enrolled.
  // A sign-in in the last 10 minutes is proof enough on its own. Otherwise a
  // password, if the account has one; and for a Google account, Google itself
  // ("Confirm with Google" signs in again and comes straight back here), which
  // is the way such a person actually signs in and may be the only one they
  // remember.
  const reauthHint = Boolean(begin.reauth || passkeyBegin.reauth);
  const needsFreshSignIn = mode === "enable" && !hasPassword && !signedInRecently;
  const askPassword = mode === "enable" && hasPassword && !signedInRecently;
  const offerGoogle = mode === "enable" && !signedInRecently && (signsInWithGoogle || reauthHint);

  const startError = method === "passkey" ? passkeyBegin.error : begin.error;
  const startPending = beginPending || passkeyBeginPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      // The auth surfaces keep hard corners (see PasswordModal).
      className="rounded-none sm:rounded-none"
    >
      {/* One step at a time, each easing in as the last one leaves. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          ref={focusStep}
          tabIndex={-1}
          data-setup-step={step}
          className="outline-none"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={reducedMotion ? {} : { opacity: 1, y: 0 }}
          exit={reducedMotion ? {} : { opacity: 0, y: -8 }}
          transition={STEP_SWAP}
        >
          {step === "start" && needsFreshSignIn && (
            <div className="flex flex-col gap-4">
              <p className={helpTextClass}>
                {signsInWithGoogle ? t("confirmWithGoogleFirst") : t("signInAgainFirst")}
              </p>
              {signsInWithGoogle ? (
                <GoogleButton next={SETUP_RETURN} intent="confirm" />
              ) : (
                <form action={signOutToReauthenticate}>
                  <Button type="submit" className="w-full">
                    {t("signInAgain")}
                  </Button>
                </form>
              )}
              <Button type="button" variant="ghost" onClick={close}>
                {tCommon("cancel")}
              </Button>
            </div>
          )}

          {step === "start" && !needsFreshSignIn && (
            <form
              action={method === "passkey" ? passkeyBeginAction : beginAction}
              className="flex flex-col gap-4"
              noValidate
            >
              {passkeysAvailable && (
                <MethodChoice method={method} onChange={setMethod} />
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="factor-name">{t("nameLabel")}</Label>
                <Input
                  // Re-keyed per method so the suggested name follows the choice.
                  key={method}
                  id="factor-name"
                  name="name"
                  defaultValue={
                    method === "passkey"
                      ? suggestedName(existingNames, t("suggestedPasskeyName"), (number) =>
                          t("suggestedPasskeyNameNumbered", { number }),
                        )
                      : suggestedName(existingNames, t("suggestedName"), (number) =>
                          t("suggestedNameNumbered", { number }),
                        )
                  }
                  maxLength={FACTOR_NAME_MAX}
                  autoComplete="off"
                  required
                />
                <p className={infoTextClass}>
                  {method === "passkey" ? t("passkeyNameHint") : t("nameHint")}
                </p>
              </div>

              {mode === "add" ? (
                <StepUpField
                  id="setup-step-up"
                  state={method === "passkey" ? passkeyBegin : begin}
                  always
                  description={t("stepUpDescription")}
                />
              ) : askPassword ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="setup-password">
                    {signsInWithGoogle ? t("squareSharePasswordLabel") : t("passwordLabel")}
                  </Label>
                  {/* Never revealable: it holds the account's existing password. */}
                  <PasswordInput
                    id="setup-password"
                    name="current_password"
                    revealable={false}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                  />
                  <p className={infoTextClass}>
                    {signsInWithGoogle ? t("notYourGooglePassword") : t("passwordHint")}
                  </p>
                </div>
              ) : mode === "enable" ? (
                <p className={infoTextClass}>{t("signedInRecently")}</p>
              ) : null}

              {startError && (
                <p role="alert" className="font-inter text-sm font-medium text-destructive">
                  {resolve(startError.message)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={close}>
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={startPending} suppressHydrationWarning>
                  {startPending ? (
                    <>
                      <Spinner />
                      {t("checking")}
                    </>
                  ) : (
                    t("continue")
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
                <span className={infoTextClass}>{t("or")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleButton next={SETUP_RETURN} intent="confirm" />
            </div>
          )}

          {step === "passkey" && registration && (
            <CreatePasskey
              registration={registration}
              confirm={passkeyConfirm}
              confirmAction={passkeyConfirmAction}
              confirmPending={passkeyConfirmPending}
              onCancel={close}
            />
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
                  alt={t("qrAlt")}
                  width={176}
                  height={176}
                  className="size-44 shrink-0 border border-border bg-white p-2"
                />
                <div className="flex min-w-0 flex-col gap-2">
                  <p className={helpTextClass}>{t("anyApp")}</p>
                  <p className={infoTextClass}>{t("cantScan")}</p>
                  <div className="flex items-center gap-2">
                    <code
                      className="min-w-0 break-all border border-border bg-muted/40 px-2 py-1.5 font-mono text-sm text-foreground"
                      aria-label={t("setupKeyLabel")}
                    >
                      {groupSecret(enrollment.secret)}
                    </code>
                    <CopyButton
                      value={enrollment.secret}
                      messages={{
                        copy: "Settings.security.copySetupKey.copy",
                        copied: "Settings.security.copySetupKey.copied",
                        failed: "Settings.security.copySetupKey.failed",
                      }}
                    />
                  </div>
                  {/* On a phone the app is on the same device, so a tap beats a
                      scan. Harmless elsewhere, just less useful: hidden from sm. */}
                  <a
                    href={enrollment.uri}
                    className="inline-flex items-center gap-1.5 font-inter text-sm font-medium text-foreground underline underline-offset-4 sm:hidden"
                  >
                    {t("openInApp")}
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-code">{t("codeLabel")}</Label>
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
                  {resolve(confirm.error.message)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={close}>
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={confirmPending} suppressHydrationWarning>
                  {confirmPending ? (
                    <>
                      <Spinner />
                      {t("verifying")}
                    </>
                  ) : mode === "add" ? (
                    t("verifyAndAdd")
                  ) : (
                    t("verifyAndTurnOn")
                  )}
                </Button>
              </div>
            </form>
          )}

          {step === "codes" && (
            <div className="flex flex-col gap-5">
              <SuccessMark kind={doneKind} />
              <RecoveryCodesDisplay
                codes={done?.codes ?? null}
                onDone={() => {
                  toast.success(t("enabled"));
                  onClose();
                }}
              />
            </div>
          )}

          {step === "added" && (
            <div className="flex flex-col items-center gap-4 pt-2 text-center" data-factor-added>
              <SuccessMark kind={doneKind} />
              <p role="status" className="font-inter text-sm font-medium text-foreground">
                {doneKind === "passkey" ? t("passkeyAdded") : t("added")}
              </p>
              <Button type="button" onClick={onClose} autoFocus className="w-full sm:w-auto">
                {tCommon("done")}
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}

/**
 * Passkey or authenticator app, as two large choices. A radio group, so the
 * arrow keys move between them and the choice is announced as one.
 */
function MethodChoice({ method, onChange }: { method: Method; onChange: (method: Method) => void }) {
  const t = useTranslations("Settings.security.setup");
  const options: { value: Method; label: string; hint: string; icon: React.ReactNode }[] = [
    {
      value: "passkey",
      label: t("methodPasskey"),
      hint: t("methodPasskeyHint"),
      // Chosen, its ridges draw themselves in: a small "yes, this one".
      icon: <AnimatedFingerprint state={method === "passkey" ? "success" : "idle"} className="size-5" />,
    },
    {
      value: "app",
      label: t("methodApp"),
      hint: t("methodAppHint"),
      icon: <Smartphone aria-hidden className="size-5 shrink-0" />,
    },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-inter text-sm font-medium text-foreground">{t("methodLabel")}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex cursor-pointer items-start gap-3 border p-3 transition-colors duration-base ease-standard motion-reduce:transition-none",
            method === option.value
              ? "border-foreground bg-muted/40"
              : "border-border hover:bg-accent/50",
          )}
        >
          <input
            type="radio"
            name="setup-method"
            value={option.value}
            checked={method === option.value}
            onChange={() => onChange(option.value)}
            // Not a form field: which action runs is the choice itself.
            form="__none__"
            className="mt-1 accent-foreground"
          />
          <span className="mt-0.5 text-foreground">{option.icon}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 font-inter text-sm font-medium text-foreground">
              {option.label}
              {option.value === "passkey" && (
                <span className="border border-foreground px-1.5 py-0.5 text-[11px] font-semibold leading-none">
                  {t("recommended")}
                </span>
              )}
            </span>
            <span className={infoTextClass}>{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Step 2 for a passkey: one button that opens the browser's own prompt. A
 * click, not an automatic start, because Safari only opens that prompt from
 * one. The options arrived with step 1, so nothing is fetched in between.
 */
function CreatePasskey({
  registration,
  confirm,
  confirmAction,
  confirmPending,
  onCancel,
}: {
  registration: NonNullable<BeginPasskeySetupState["registration"]>;
  confirm: ConfirmSetupState;
  confirmAction: (data: FormData) => void;
  confirmPending: boolean;
  onCancel: () => void;
}) {
  const t = useTranslations("Settings.security.setup");
  const tCommon = useTranslations("Common.actions");
  const resolve = useResolveMessage();
  const [problem, setProblem] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  // Bumped on every failure: it keys the fingerprint, so its shake replays.
  const [failures, setFailures] = React.useState(0);

  // The server refused the new passkey: that is a failure too.
  const [seenConfirm, setSeenConfirm] = React.useState(confirm);
  if (seenConfirm !== confirm) {
    setSeenConfirm(confirm);
    if (confirm.error) setFailures((count) => count + 1);
  }

  async function create() {
    setProblem(null);
    setWorking(true);
    const outcome = await createPasskey(registration.options);
    setWorking(false);
    if (!outcome.ok) {
      setFailures((count) => count + 1);
      setProblem(
        outcome.reason === "cancelled"
          ? t("passkeyCancelled")
          : outcome.reason === "exists"
            ? t("passkeyExists")
            : outcome.reason === "unsupported"
              ? t("passkeyUnsupported")
              : t("passkeyFailed"),
      );
      return;
    }
    const data = new FormData();
    data.set("credential", outcome.credential);
    React.startTransition(() => confirmAction(data));
  }

  const busy = working || confirmPending;
  const shownError = problem ?? (confirm.error ? resolve(confirm.error.message) : null);

  return (
    <div className="flex flex-col gap-5" data-passkey-setup>
      <Button
        type="button"
        onClick={create}
        disabled={busy}
        // The one thing to do on this step, so it is where focus lands.
        autoFocus
        className="w-full"
        suppressHydrationWarning
      >
        <AnimatedFingerprint
          key={failures}
          state={busy ? "scanning" : failures > 0 ? "error" : "idle"}
        />
        {busy ? t("creatingPasskey") : t("createPasskey")}
      </Button>

      {shownError && (
        <p role="alert" className="font-inter text-sm font-medium text-destructive">
          {shownError}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </div>
  );
}
