"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import type { MessageKey } from "@/i18n/types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/SaveButton";
import { StepUpField } from "@/components/auth/StepUp";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import {
  helpTextClass,
  iconNudgeLeftClass,
  iconNudgeRightClass,
  infoTextClass,
} from "@/components/ui/control-styles";
import { iconTileClass } from "@/components/ui/surface-styles";
import { STEP_SWAP } from "@/components/ui/motion-tokens";
import { TermsSummary } from "@/components/legal/TermsSummary";
import type { ActionState } from "@/lib/errors";
import {
  acceptLegal,
  resendSellerEmailVerification,
  saveTaxInfo,
} from "@/lib/settings/actions";
import { LEGAL_VERSION, SELLER_FIELD_MAX } from "@/lib/settings/constants";
import {
  TRADER_IDENTITY_FIELDS,
  type TraderIdentityField,
} from "@/lib/settings/trader-identity";
import { cn } from "@/lib/utils";
import { SetupPath, WelcomeHero } from "./WelcomeVisuals";

/**
 * THE WELCOME FLOW: what a new seller meets on their first visit to Overview,
 * instead of a red "you can't publish or sell" strip and nothing else.
 *
 * Slides, each with ONE thing on it, pictures over paragraphs:
 *   1. Welcome. What they are about to make (a product page, live, its link
 *      shared), as an animation rather than a description.
 *   2. The Terms. The short version of the Terms of Service in a scroll box,
 *      the full Terms one click away, and "I have read and agree to the Terms",
 *      which only opens once the summary has been scrolled to its end. Agreeing
 *      goes through the SAME action as Settings › Legal (acceptLegal), which
 *      records the time and LEGAL_VERSION. Left out when the current version
 *      is already agreed to.
 *   3. The path. The four steps as a timeline that fills in and checks off,
 *      with a label each and nothing more.
 *   4. Seller details. The three trader-identity fields the publish gate needs
 *      (lib/settings/trader-identity.ts), asked as an ordinary setup step.
 *      Saved through the SAME action as Settings (saveTaxInfo), so every check
 *      and the confirmation email apply unchanged; the action writes only the
 *      fields it is sent. Skippable: drafts never need these, and the checklist
 *      keeps the step. Left out when the details are already on file.
 * Every way FORWARD out of the dialog starts the guided tour
 * (components/onboarding/TourOverlay.tsx).
 *
 * "Skip onboarding" is there for someone who already knows the app: it skips
 * all of it, tour included. The dialog's close button and Esc mean the same.
 * Skipping skips the guidance, not the legal gate: the checklist on Overview
 * stays until the seller details are really there.
 *
 * THE TERMS ARE NOT SKIPPABLE. Until they are agreed to, there is no "Skip
 * onboarding", no close button, and neither Esc nor the backdrop closes the
 * dialog, so the welcome cannot be recorded as seen (OnboardingPanel records
 * it on the way out) without an agreement on file. Leaving the page instead
 * just brings the welcome back on the next visit to Overview.
 *
 * Built on CreateStorefrontWizard's pattern (steps feeding the Modal's title, a
 * sliding step with a reduced-motion fallback, focus moved onto each step) so
 * the app's multi-step dialogs read as one control.
 *
 * Skipping and starting the tour are the SAME fact to the server: the person has
 * seen the welcome (lib/onboarding/actions.ts). The caller records that; this
 * component only reports which way out was taken.
 */

export type WelcomeStepId = "welcome" | "terms" | "path" | "seller";

/** Prefill for the seller step: whatever the profile already holds. */
export type SellerPrefill = { businessName: string; address: string; email: string };

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const INITIAL: ActionState = {};

/** Each step's dialog title, and the line under it where it has one. */
const STEP_COPY: Record<WelcomeStepId, { title: MessageKey; description?: MessageKey }> = {
  welcome: { title: "Onboarding.welcome.steps.welcome.title" },
  terms: {
    title: "Onboarding.welcome.steps.terms.title",
    description: "Onboarding.welcome.steps.terms.description",
  },
  path: { title: "Onboarding.welcome.steps.path.title" },
  seller: {
    title: "Onboarding.welcome.steps.seller.title",
    description: "Onboarding.welcome.steps.seller.lawNote",
  },
};

function fieldLabel(key: TraderIdentityField): MessageKey {
  return (
    TRADER_IDENTITY_FIELDS.find((field) => field.key === key)?.label ??
    "Settings.sellerDetails.fields.businessName.label"
  );
}

function stepsFor(includeTermsStep: boolean, includeSellerStep: boolean): WelcomeStepId[] {
  const steps: WelcomeStepId[] = ["welcome"];
  if (includeTermsStep) steps.push("terms");
  steps.push("path");
  if (includeSellerStep) steps.push("seller");
  return steps;
}

export function WelcomeFlow({
  open,
  onClose,
  onStartTour,
  includeTermsStep,
  includeSellerStep,
  seller,
  emailVerified,
  verificationOn,
  acceptAction = acceptLegal,
  saveAction = saveTaxInfo,
  resendAction = resendSellerEmailVerification,
}: {
  open: boolean;
  /** Skip everything: "Skip onboarding", the close button, Esc. Must be
   *  referentially stable: Modal re-runs its focus effect whenever the handler
   *  changes, which would yank focus back to the close button. */
  onClose: () => void;
  /** Leave the dialog forwards: close it and start the guided tour. Stable, for
   *  the same reason as onClose (it is called from an effect after a save). */
  onStartTour: () => void;
  /** Whether the current Terms (LEGAL_VERSION) still need agreeing to. Frozen
   *  when the flow opens, like the seller step. */
  includeTermsStep: boolean;
  /** Whether the trader identity still needs typing. Frozen when the flow
   *  opens, so a save that completes it does not remove the step being shown. */
  includeSellerStep: boolean;
  seller: SellerPrefill;
  /** The stored contact email is already proven by a clicked link. */
  emailVerified: boolean;
  /** Confirmation links can be sent (lib/settings/seller-email-verification). */
  verificationOn: boolean;
  /** Injectable for the dev gallery and tests; production uses Settings' own. */
  acceptAction?: FormAction;
  saveAction?: FormAction;
  resendAction?: FormAction;
}) {
  const t = useTranslations();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const formId = useId();
  const termsFormId = useId();
  const termsHintId = useId();
  const fieldId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [steps, setSteps] = useState(() => stepsFor(includeTermsStep, includeSellerStep));
  const [stepIndex, setStepIndex] = useState(0);
  // The summary has been scrolled to its end: only then may it be agreed to.
  const [termsRead, setTermsRead] = useState(false);
  // The agreement is on file (the action succeeded), so the gate is open.
  const [termsAgreed, setTermsAgreed] = useState(false);
  // Direction only drives which way the step slides.
  const [back, setBack] = useState(false);
  const [businessName, setBusinessName] = useState(seller.businessName);
  const [address, setAddress] = useState(seller.address);
  const [email, setEmail] = useState(seller.email);
  // The address a confirmation link is waiting on, once the details are saved.
  const [confirming, setConfirming] = useState<string | null>(null);
  // A save that needs no confirmation is the end of the dialog.
  const [finished, setFinished] = useState(false);

  const [acceptState, acceptFormAction, acceptPending] = useActionState(
    acceptAction,
    INITIAL,
  );
  const [saveState, saveFormAction, savePending] = useActionState(saveAction, INITIAL);
  const [resendState, resendFormAction, resendPending] = useActionState(
    resendAction,
    INITIAL,
  );
  // The outcome of each save or resend, success and failure alike, is a
  // toast (styles.md §8.12); only the confirmation to act on stays inline.
  useActionStateToast(acceptState);
  useActionStateToast(saveState);
  useActionStateToast(resendState);
  const acceptResult = useSaveResult(acceptState);
  const saveResult = useSaveResult(saveState);
  const resendResult = useSaveResult(resendState);

  // Reset on every open, adjusted during render like CreateStorefrontWizard:
  // an effect would paint the previous visit's step for a frame first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSteps(stepsFor(includeTermsStep, includeSellerStep));
      setStepIndex(0);
      setBack(false);
      setTermsRead(false);
      setTermsAgreed(false);
      setBusinessName(seller.businessName);
      setAddress(seller.address);
      setEmail(seller.email);
      setConfirming(null);
      setFinished(false);
    }
  }

  const goTo = (index: number) => {
    setBack(index < stepIndex);
    setStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
  };

  // An agreement that lands opens the gate and moves on to the next slide.
  // Adjusted during render against the state object, like the save below, so
  // each result is handled exactly once.
  const [handledAccept, setHandledAccept] = useState(acceptState);
  if (acceptState !== handledAccept) {
    setHandledAccept(acceptState);
    if (acceptState.success) {
      setTermsAgreed(true);
      setBack(false);
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
    }
  }

  // Until the Terms are agreed to, nothing but the dialog's own controls leads
  // out of it. Held in a ref so the handler given to Modal stays one function.
  const termsPending = steps.includes("terms") && !termsAgreed;
  const termsPendingRef = useRef(termsPending);
  useEffect(() => {
    termsPendingRef.current = termsPending;
  }, [termsPending]);

  // A settled save moves the flow on: to the confirmation panel when a link is
  // now waiting on that address, otherwise out to the tour. Adjusted during
  // render against the state object itself, so each save is handled once. The
  // tour itself starts from an effect below: a parent's callback has no
  // business running in the middle of this component's render.
  const [handledSave, setHandledSave] = useState(saveState);
  if (saveState !== handledSave) {
    setHandledSave(saveState);
    if (saveState.success) {
      const saved = email.trim();
      const waitingOnLink =
        verificationOn && saved !== "" && (saved !== seller.email.trim() || !emailVerified);
      if (waitingOnLink) setConfirming(saved);
      else setFinished(true);
    }
  }

  useEffect(() => {
    if (finished) onStartTour();
  }, [finished, onStartTour]);

  // saveTaxInfo revalidates /settings/tax only. The page this dialog sits on
  // renders the checklist and the gate on the server, so it asks for a fresh
  // render itself; client state (this dialog, its step) survives a refresh.
  useEffect(() => {
    if (saveState.success) router.refresh();
  }, [saveState, router]);

  // Closing mid-save would drop the result on the floor. The pending flag
  // lives in a ref so the handler handed to Modal stays the same function.
  const savingRef = useRef(false);
  useEffect(() => {
    savingRef.current = savePending;
  }, [savePending]);
  const close = useCallback(() => {
    if (savingRef.current || termsPendingRef.current) return;
    onClose();
  }, [onClose]);

  /**
   * Move focus onto each step as it arrives, and rewind the scroll region.
   * Same reasoning as CreateStorefrontWizard.focusStep: AnimatePresence runs
   * `mode="wait"`, so only a callback ref fires when the new step exists, and
   * the container (not its first control) takes focus so the new question is
   * what assistive tech announces.
   */
  const focusStep = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    node.focus({ preventScroll: true });
  }, []);

  const step = steps[stepIndex] ?? "welcome";
  const stepCopy = STEP_COPY[step];
  const copy = {
    title: t(stepCopy.title),
    description: stepCopy.description ? t(stepCopy.description) : undefined,
  };
  const ready = Boolean(businessName.trim() && address.trim() && email.trim());
  const hasSellerStep = steps.includes("seller");

  return (
    <Modal
      open={open}
      onClose={close}
      title={copy.title}
      description={copy.description}
      dismissible={!termsPending}
      // A column, so only the step's content scrolls and the progress and the
      // controls stay on screen (the storefront wizard's layout).
      className="flex flex-col overflow-y-hidden pb-3 sm:max-w-xl"
    >
      {/* Where they are, as a picture rather than "Step 1 of 3", beside the way
          out of all of it, found before anything is filled in and apart from
          the form's own "Skip for now". */}
      <div className="mb-4 flex shrink-0 items-center gap-4">
        <div
          role="progressbar"
          aria-label={t("Onboarding.welcome.progress", {
            step: stepIndex + 1,
            total: steps.length,
          })}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={stepIndex + 1}
          className="flex flex-1 gap-1.5"
        >
          {steps.map((id, index) => (
            <span
              key={id}
              className={cn(
                "h-1 flex-1 transition-colors duration-base ease-standard motion-reduce:transition-none",
                index <= stepIndex ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
        {!termsPending && (
          <Button
            variant="ghost"
            className="-mr-2 shrink-0 px-2 py-1.5 text-xs"
            onClick={close}
            disabled={savePending}
          >
            {t("Onboarding.welcome.nav.skipOnboarding")}
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto px-6 py-1"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={confirming ? `${step}-confirm` : step}
            ref={focusStep}
            tabIndex={-1}
            role="group"
            aria-label={copy.title}
            data-welcome-step={confirming ? `${step}-confirm` : step}
            className="outline-none"
            initial={reducedMotion ? false : { opacity: 0, x: back ? -12 : 12 }}
            animate={reducedMotion ? {} : { opacity: 1, x: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, x: back ? 12 : -12 }}
            transition={STEP_SWAP}
          >
            {step === "welcome" && (
              <div className="space-y-4 pb-1">
                <WelcomeHero />
                <p className="text-center font-inter text-sm text-muted-foreground">
                  {t("Onboarding.welcome.tagline")}
                </p>
              </div>
            )}

            {step === "terms" && (
              <form id={termsFormId} action={acceptFormAction} className="space-y-3 pb-1">
                {/* The version the reader was shown. The action refuses any
                    other, so an agreement always names the Terms on screen. */}
                <input type="hidden" name="version" value={LEGAL_VERSION} />
                <TermsSummary onReadToEnd={() => setTermsRead(true)} />
                <p id={termsHintId} className={infoTextClass} aria-live="polite">
                  {termsAgreed
                    ? t("Onboarding.welcome.terms.agreed")
                    : termsRead
                      ? t("Onboarding.welcome.terms.agreeNote")
                      : t("Settings.legal.scrollToAgree")}
                </p>
              </form>
            )}

            {step === "path" && (
              <div className="pb-2 pt-3">
                <SetupPath />
              </div>
            )}

            {step === "seller" && !confirming && (
              // noValidate: the server's messages are the ones that know about
              // placeholders, throwaway providers and domains that take no
              // mail, and a native bubble would pre-empt them with less.
              <form id={formId} action={saveFormAction} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-name`}>{t(fieldLabel("businessName"))}</Label>
                  <Input
                    id={`${fieldId}-name`}
                    name="tax_business_name"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    placeholder={t("Onboarding.welcome.seller.namePlaceholder")}
                    maxLength={200}
                    autoComplete="organization"
                    aria-required="true"
                    aria-describedby={`${fieldId}-name-help`}
                    disabled={savePending}
                  />
                  <p id={`${fieldId}-name-help`} className={helpTextClass}>
                    {t("Onboarding.welcome.seller.nameAlternative")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-address`}>{t(fieldLabel("address"))}</Label>
                  <Textarea
                    id={`${fieldId}-address`}
                    name="seller_address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder={t("Onboarding.welcome.seller.addressPlaceholder")}
                    maxLength={SELLER_FIELD_MAX.address}
                    rows={3}
                    autoComplete="street-address"
                    aria-required="true"
                    disabled={savePending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-email`}>{t(fieldLabel("email"))}</Label>
                  <Input
                    id={`${fieldId}-email`}
                    name="seller_email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("Onboarding.welcome.seller.emailPlaceholder")}
                    maxLength={254}
                    autoComplete="email"
                    aria-required="true"
                    aria-describedby={`${fieldId}-email-help`}
                    disabled={savePending}
                  />
                  <p id={`${fieldId}-email-help`} className={helpTextClass}>
                    {t("Onboarding.welcome.seller.emailHelp")}
                  </p>
                </div>
                {/* Only ever appears for someone who turned 2FA on before
                    finishing setup and whose last code has gone stale: the
                    same action guards these details in Settings. */}
                <StepUpField id={`${fieldId}-step-up`} state={saveState} />
              </form>
            )}

            {step === "seller" && confirming && (
              <div className="space-y-4">
                <div className="flex gap-3">
                  <span className={cn(iconTileClass, "size-9 shrink-0")}>
                    <MailCheck className="size-4" strokeWidth={2} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">
                      {t("Onboarding.welcome.confirm.check", { email: confirming })}
                    </p>
                    <p className="mt-0.5 font-inter text-sm text-muted-foreground">
                      {t("Onboarding.welcome.confirm.goLive")}
                    </p>
                  </div>
                </div>
                {/* Its own form, beside the save rather than inside it: a
                    resend is a different ask from a save, and nested forms
                    break both. */}
                <form action={resendFormAction}>
                  <SaveButton
                    variant="secondary"
                    pending={resendPending}
                    state={resendResult}
                    pendingLabel={t("Common.actions.sending")}
                    savedLabel={t("Common.actions.sent")}
                  >
                    {t("Onboarding.welcome.confirm.sendNewLink")}
                  </SaveButton>
                </form>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* A plain flex item, not sticky (see CreateStorefrontWizard). */}
      <div className="-mx-6 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 pt-2.5">
        {step === "welcome" && (
          <Button className="ml-auto" onClick={() => goTo(stepIndex + 1)}>
            {t("Onboarding.welcome.nav.next")}
            <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
          </Button>
        )}

        {step === "terms" && (
          <>
            <Button
              variant="ghost"
              onClick={() => goTo(stepIndex - 1)}
              disabled={acceptPending}
            >
              <ArrowLeft className={cn("size-4", iconNudgeLeftClass)} aria-hidden />
              {t("Common.actions.back")}
            </Button>
            {termsAgreed ? (
              <Button onClick={() => goTo(stepIndex + 1)}>
                {t("Onboarding.welcome.nav.continue")}
                <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
              </Button>
            ) : (
              <SaveButton
                form={termsFormId}
                pending={acceptPending}
                state={acceptResult}
                pendingLabel={t("Settings.legal.recording")}
                disabled={!termsRead}
                aria-describedby={termsHintId}
              >
                {t("Settings.legal.agreeButton")}
              </SaveButton>
            )}
          </>
        )}

        {step === "path" && (
          <>
            <Button variant="ghost" onClick={() => goTo(stepIndex - 1)}>
              <ArrowLeft className={cn("size-4", iconNudgeLeftClass)} aria-hidden />
              {t("Common.actions.back")}
            </Button>
            <Button onClick={hasSellerStep ? () => goTo(stepIndex + 1) : onStartTour}>
              {hasSellerStep
                ? t("Onboarding.welcome.nav.getStarted")
                : t("Onboarding.welcome.nav.showMeAround")}
              <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
            </Button>
          </>
        )}

        {step === "seller" && !confirming && (
          <>
            <Button
              variant="ghost"
              onClick={() => goTo(stepIndex - 1)}
              disabled={savePending}
            >
              <ArrowLeft className={cn("size-4", iconNudgeLeftClass)} aria-hidden />
              {t("Common.actions.back")}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={onStartTour} disabled={savePending}>
                {t("Onboarding.welcome.nav.skipForNow")}
              </Button>
              <SaveButton
                form={formId}
                pending={savePending}
                state={saveResult}
                disabled={!ready}
              >
                {t("Onboarding.welcome.nav.saveAndContinue")}
              </SaveButton>
            </div>
          </>
        )}

        {step === "seller" && confirming && (
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t("Onboarding.welcome.nav.changeDetails")}
            </Button>
            <Button onClick={onStartTour}>
              {t("Onboarding.welcome.nav.continue")}
              <ArrowRight className={cn("size-4", iconNudgeRightClass)} aria-hidden />
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
