"use client";

import * as React from "react";
import { useActionState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { CopyButton } from "@/components/ui/CopyButton";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { InfoTip } from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalActions } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { STEP_SWAP } from "@/components/ui/motion-tokens";
import { inkBadgeClass } from "@/components/ui/surface-styles";
import { AnimatedFingerprint, FingerprintGlyph } from "@/components/auth/AnimatedFingerprint";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { QrTile } from "@/components/auth/QrTile";
import { StepUpPrompt, StepUpScope, StepUpSubmit } from "@/components/auth/StepUp";
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
import { suggestedName } from "@/lib/auth/factor-names";
import { createPasskey } from "@/lib/auth/webauthn-client";
import { FACTOR_NAME_MAX } from "@/lib/validation/mfa";

const BEGIN_INITIAL: BeginSetupState = {};
const PASSKEY_BEGIN_INITIAL: BeginPasskeySetupState = {};
const CONFIRM_INITIAL: ConfirmSetupState = {};

/** Where "Confirm with Google" comes back to: this page, with setup open. */
const SETUP_RETURN = "/settings/security?setup=1";

type Method = "passkey" | "app";

/** The secret in fours, the way authenticator apps display typed keys. */
function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Every way the setup actions refuse a NAME (missing, taken, a reserved
 * prefix) is a message whose key carries this, which is how the folded name
 * field knows to open itself.
 */
const NAME_REFUSAL_KEY = "factorName";

/**
 * Turning 2FA on, or adding another way to confirm it's you. Three steps:
 *
 *   1. Choose a passkey (the default: nothing to install) or an authenticator
 *      app, as two pictures, and prove it's you (password; or, adding, an
 *      existing passkey or app; or, for a Google-only account, a recent
 *      sign-in). Its name is suggested and folded away: most people keep it.
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

  // Adding needs no sentence: the title and the two pictures say it.
  const description =
    step === "start"
      ? mode === "add"
        ? undefined
        : t("descriptionEnable")
      : step === "scan"
        ? t("descriptionScan")
        : step === "passkey"
          ? t("descriptionPasskey")
          : step === "codes"
            ? t("descriptionCodes")
            : undefined;

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

  const startState = method === "passkey" ? passkeyBegin : begin;
  const startError = startState.error;
  const startPending = beginPending || passkeyBeginPending;

  // The name each kind starts with. Shown on the folded line, and the field's
  // starting value.
  const suggested =
    method === "passkey"
      ? suggestedName(existingNames, t("suggestedPasskeyName"), (number) =>
          t("suggestedPasskeyNameNumbered", { number }),
        )
      : suggestedName(existingNames, t("suggestedName"), (number) =>
          t("suggestedNameNumbered", { number }),
        );
  // What was typed over it, for the folded line only (the field itself stays
  // uncontrolled). Dropped when the field starts over: on a change of method
  // (it is re-keyed), and when an action answers (React resets the form).
  const [typed, setTyped] = React.useState<{ name: string; method: Method; state: object } | null>(null);
  const shownName = typed && typed.method === method && typed.state === startState ? typed.name : suggested;
  const nameRefused = Boolean(startError?.message.key.includes(NAME_REFUSAL_KEY));

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      visual={step === "passkey" ? <HeroMark icon={FingerprintGlyph} size="lg" /> : undefined}
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
              {/* Adding always confirms with a passkey or app the account
                  already has, and with a passkey that confirmation IS this
                  form's button. Turning 2FA on has neither yet, so the scope
                  stays quiet and the button is a plain Continue. */}
              <StepUpScope
                id="setup-step-up"
                state={startState}
                always={mode === "add"}
                description={t("stepUpDescription")}
              >
                {passkeysAvailable && (
                  <div className="flex flex-col gap-2">
                    <ChoiceCards
                      name="setup-method"
                      legend={t("methodLabel")}
                      legendHidden
                      variant="tiles"
                      columns={2}
                      // Not a form field: which action runs is the choice itself.
                      detached
                      optionDataAttribute="data-setup-method"
                      options={[
                        {
                          value: "passkey",
                          label: t("methodPasskey"),
                          // Chosen, its ridges draw themselves in: a small "yes, this one".
                          icon: (
                            <AnimatedFingerprint
                              state={method === "passkey" ? "success" : "idle"}
                              className="size-9"
                            />
                          ),
                          badge: <span className={inkBadgeClass}>{t("recommended")}</span>,
                        },
                        {
                          value: "app",
                          label: t("methodApp"),
                          icon: <Smartphone aria-hidden className="size-9" strokeWidth={1.5} />,
                        },
                      ]}
                      value={method}
                      onChange={setMethod}
                    />
                    {/* One line for the chosen one, not a paragraph under each. */}
                    <p className={`${infoTextClass} text-center`}>
                      {method === "passkey" ? t("methodPasskeyHint") : t("methodAppHint")}
                    </p>
                  </div>
                )}

                {/* Suggested, so almost nobody needs it: one line that opens.
                    Folded, it is still sent with the form. */}
                <Disclosure
                  summary={t("nameSummary", { name: shownName })}
                  open={nameRefused || undefined}
                  className={helpTextClass}
                  attributes={{ "data-setup-name": "" }}
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="factor-name">{t("nameLabel")}</Label>
                    <Input
                      // Re-keyed per method so the suggested name follows the choice.
                      key={method}
                      id="factor-name"
                      name="name"
                      defaultValue={suggested}
                      onChange={(event) =>
                        setTyped({ name: event.target.value, method, state: startState })
                      }
                      maxLength={FACTOR_NAME_MAX}
                      autoComplete="off"
                      required
                    />
                    <p className={infoTextClass}>
                      {method === "passkey" ? t("passkeyNameHint") : t("nameHint")}
                    </p>
                  </div>
                </Disclosure>

                {askPassword && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="setup-password">
                        {signsInWithGoogle ? t("squareSharePasswordLabel") : t("passwordLabel")}
                      </Label>
                      {/* WHY a password is asked is for the curious: behind the "?". */}
                      {!signsInWithGoogle && (
                        <InfoTip label={t("passwordTipLabel")}>{t("passwordHint")}</InfoTip>
                      )}
                    </div>
                    {/* Never revealable: it holds the account's existing password. */}
                    <PasswordInput
                      id="setup-password"
                      name="current_password"
                      revealable={false}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      required
                    />
                    {/* WHICH password is something to act on, so it stays in
                        view: someone who signs in with Google would type that
                        one, and may not remember this one at all. */}
                    {signsInWithGoogle && (
                      <p className={infoTextClass}>{t("notYourGooglePassword")}</p>
                    )}
                  </div>
                )}

                <StepUpPrompt />

                {startError && (
                  <p role="alert" className="font-inter text-sm font-medium text-destructive">
                    {resolve(startError.message)}
                  </p>
                )}

                <ModalActions>
                  <Button type="button" variant="ghost" onClick={close}>
                    {tCommon("cancel")}
                  </Button>
                  <StepUpSubmit pending={startPending} pendingLabel={t("checking")}>
                    {t("continue")}
                  </StepUpSubmit>
                </ModalActions>
              </StepUpScope>
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

              {/* The code is the step: centred, with the two ways round a scan
                  (a tap on a phone, the key typed in) small beneath it. */}
              <div className="flex flex-col items-center gap-3 text-center">
                <QrTile src={enrollment.qrCode} alt={t("qrAlt")} />
                {/* On a phone the app is on the same device, so a tap beats a
                    scan. Harmless elsewhere, just less useful: hidden from sm. */}
                <a
                  href={enrollment.uri}
                  className="inline-flex items-center gap-1.5 font-inter text-sm font-medium text-foreground underline underline-offset-4 sm:hidden"
                >
                  {t("openInApp")}
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
                <div className="flex flex-col items-center gap-1.5">
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

              <ModalActions>
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
              </ModalActions>
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
    <div className="flex flex-col gap-3" data-passkey-setup>
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
        <p role="alert" className="text-center font-inter text-sm font-medium text-destructive">
          {shownError}
        </p>
      )}

      {/* The one thing people get stuck on, for the people it applies to. */}
      <Disclosure summary={t("passkeyOnPhone")} className={infoTextClass}>
        <p>{t("passkeyOnPhoneBody")}</p>
      </Disclosure>

      <Button type="button" variant="ghost" onClick={onCancel} className="w-full">
        {tCommon("cancel")}
      </Button>
    </div>
  );
}
