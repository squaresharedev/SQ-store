"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, MonitorSmartphone, Smartphone } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { SETTLE } from "@/components/ui/motion-tokens";
import { helpTextClass, infoTextClass, quietLinkClass } from "@/components/ui/control-styles";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { ApproveFromDevice } from "@/components/auth/ApproveFromDevice";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { PasskeyHereOffer, usePasskeyHereDismissed } from "@/components/auth/PasskeyHereOffer";
import { SuccessMark, type SuccessKind } from "@/components/auth/SuccessMark";
import { signOut } from "@/lib/auth/actions";
import {
  passkeySignInOptions,
  signInWithRecoveryCode,
  verifyPasskeySignIn,
  verifyTwoFactorSignIn,
  type ChallengeState,
} from "@/lib/auth/mfa-actions";
import type { DeviceLabel } from "@/lib/auth/device-label";
import { assertPasskey, devicePasskeysAvailable, passkeysSupported } from "@/lib/auth/webauthn-client";
import type { ActionError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const INITIAL: ChallengeState = {};

type Mode = "passkey" | "code" | "approve" | "recovery";

const UNKNOWN_DEVICE: DeviceLabel = { browser: null, os: null };

/** How each way through shows its moment of success. */
const SUCCESS_KIND: Record<Exclude<Mode, "recovery">, SuccessKind> = {
  passkey: "passkey",
  code: "app",
  approve: "device",
};

const SWITCH_CLASS =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-inter text-sm text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground motion-reduce:transition-none";

/**
 * The sign-in challenge: a passkey, an approval from a phone (or computer)
 * where the person is already signed in, a code from the authenticator app,
 * or (for someone whose phone is gone) one of their recovery codes. One form
 * on screen at a time, each with its own action, so nothing sent for one
 * check can ever reach another. A passkey comes first whenever the account
 * has one.
 *
 * Once through, the page shows a moment of success and then goes on, whether
 * it learned that from the form's action or from the server (`through`: the
 * render that follows a successful action is a signed-in one, because the
 * action set the upgraded session's cookies). Either way the destination is
 * a path the server sanitised. A sign-in that had to go through another
 * device first offers a passkey on this one (PasskeyHereOffer).
 */
export function TwoFactorChallenge({
  next,
  email,
  factors,
  through = false,
  approval = false,
  device = UNKNOWN_DEVICE,
  passkeysAvailable = false,
  passkeyOffered = false,
}: {
  next: string;
  email: string;
  factors: FactorChoice[];
  /** This session has already passed its second factor. */
  through?: boolean;
  /** "Approve from your phone" is on for this account and works here. */
  approval?: boolean;
  /** This device, as the server read it: names a passkey made here. */
  device?: DeviceLabel;
  /** Passkeys are configured in this deployment. */
  passkeysAvailable?: boolean;
  /**
   * This session is through AND holds the passkey-here ticket, which only a
   * sign-in with an authenticator-app code grants (lib/auth/passkey-offer.ts).
   * The server's word for it, because the page usually re-renders as signed
   * in before the code form can say how the sign-in went.
   */
  passkeyOffered?: boolean;
}) {
  const t = useTranslations("Auth.twoFactor");
  const apps = factors.filter((factor) => factor.type !== "passkey");
  const hasPasskey = factors.some((factor) => factor.type === "passkey");
  const [mode, setMode] = React.useState<Mode>(
    hasPasskey ? "passkey" : apps.length > 0 ? "code" : approval ? "approve" : "recovery",
  );

  // Stable per kind: the approval wait keeps polling across renders.
  const [verified, setVerified] = React.useState<{ next: string; kind: SuccessKind } | null>(null);
  const onPasskey = React.useCallback((to: string) => setVerified({ next: to, kind: "passkey" }), []);
  const onCode = React.useCallback((to: string) => setVerified({ next: to, kind: "app" }), []);
  const onApproved = React.useCallback((to: string) => setVerified({ next: to, kind: "device" }), []);
  // The passkey missed: its form now offers approval itself, so the list below need not.
  const [passkeyMissed, setPasskeyMissed] = React.useState(false);
  const onPasskeyMiss = React.useCallback(() => setPasskeyMissed(true), []);

  // Can this device hold a passkey of its own? Asked up front, so the answer
  // is ready by the time the sign-in succeeds.
  const [dismissed] = usePasskeyHereDismissed();
  const mayOffer = passkeysAvailable && !dismissed;
  const [deviceCanHold, setDeviceCanHold] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!mayOffer) return;
    let live = true;
    void devicePasskeysAvailable().then((available) => {
      if (live) setDeviceCanHold(available);
    });
    return () => {
      live = false;
    };
  }, [mayOffer]);
  const [offerAnswered, setOfferAnswered] = React.useState(false);
  const finishOffer = React.useCallback(() => setOfferAnswered(true), []);
  // Only after a code from the person's own authenticator app: never after an
  // approval (someone talked into approving must not also hand over a
  // permanent passkey). The server holds the same line (passkey-offer.ts).
  // Latched once true: making the passkey spends the ticket, the page then
  // re-renders without it, and the offer must stay for its "added" moment.
  const [offerEarned, setOfferEarned] = React.useState(false);
  if (!offerEarned && (verified?.kind === "app" || passkeyOffered)) setOfferEarned(true);
  const offerKind = offerEarned ? "app" : null;
  const offering = Boolean(offerKind && mayOffer && !offerAnswered);
  const showOffer = offering && deviceCanHold === true;
  // Still finding out whether to offer: hold on the success moment.
  const holding = offering && deviceCanHold === null;

  const destination = showOffer || holding ? null : (verified?.next ?? (through ? next : null));
  useContinueTo(destination);

  if (showOffer && offerKind) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <PasskeyHereOffer
          kind={offerKind}
          device={device}
          existingNames={factors.map((factor) => factor.name)}
          onDone={finishOffer}
        />
      </div>
    );
  }

  if (destination || holding) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <SigningIn kind={verified?.kind ?? (mode === "recovery" ? "app" : SUCCESS_KIND[mode])} />
      </div>
    );
  }

  const toApproval = approval ? () => setMode("approve") : undefined;

  // The ways out of the current one, in the order a person would reach for them.
  const switches: { to: Mode; label: string; icon: React.ReactNode }[] = [];
  if (mode !== "passkey" && hasPasskey) {
    switches.push({ to: "passkey", label: t("usePasskey"), icon: <Fingerprint aria-hidden className="size-4" /> });
  }
  if (mode !== "approve" && approval && !(mode === "passkey" && passkeyMissed)) {
    switches.push({ to: "approve", label: t("useApproval"), icon: <MonitorSmartphone aria-hidden className="size-4" /> });
  }
  if (mode !== "code" && apps.length > 0) {
    switches.push({ to: "code", label: t("useAuthenticatorApp"), icon: <Smartphone aria-hidden className="size-4" /> });
  }
  if (mode !== "recovery") {
    switches.push({ to: "recovery", label: t("useRecoveryCode"), icon: <KeyRound aria-hidden className="size-4" /> });
  }

  return (
    <div className="flex flex-col gap-5">
      {mode === "passkey" ? (
        <PasskeyForm
          next={next}
          email={email}
          onVerified={onPasskey}
          onUseApproval={toApproval}
          onMiss={onPasskeyMiss}
        />
      ) : mode === "code" ? (
        <CodeForm next={next} email={email} factors={apps} onVerified={onCode} />
      ) : mode === "approve" ? (
        <ApproveFromDevice next={next} onVerified={onApproved} />
      ) : (
        <RecoveryForm next={next} />
      )}

      <div className="flex flex-col items-center gap-2 border-t border-border pt-4">
        {switches.map((option) => (
          <button
            key={option.to}
            type="button"
            onClick={() => setMode(option.to)}
            suppressHydrationWarning
            className={SWITCH_CLASS}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
        {/* A way out of the half-signed-in state on a shared computer, or for
            the wrong account. Ends only this session. */}
        <form action={signOut}>
          <button
            type="submit"
            className={quietLinkClass}
          >
            {t("notYou")}
          </button>
        </form>
      </div>
    </div>
  );
}

function Status({ state, next }: { state: ChallengeState; next: string }) {
  const t = useTranslations("Auth.twoFactor");
  const resolve = useResolveMessage();
  if (!state.error) return null;
  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p role="alert" className="text-sm font-medium text-destructive">
        {resolve(state.error.message)}
      </p>
      {state.expired && (
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-inter text-sm font-medium text-foreground underline underline-offset-4"
        >
          {t("signInAgain")}
        </Link>
      )}
    </div>
  );
}

/** How long the success mark plays before the page moves on: long enough for
 *  the check to land (SuccessMark finishes at ~1.1s), not a beat longer. */
const SUCCESS_HOLD_MS = 1250;
/** Reduced motion: nothing to watch, just long enough to read. */
const SUCCESS_HOLD_REDUCED_MS = 300;

/** Let the success mark play, then go to `destination` (null: stay). */
function useContinueTo(destination: string | null) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  React.useEffect(() => {
    if (!destination) return;
    const timer = setTimeout(
      () => router.replace(destination),
      reducedMotion ? SUCCESS_HOLD_REDUCED_MS : SUCCESS_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [destination, reducedMotion, router]);
}

/**
 * A form's action says the second factor went through: tell the page, before
 * the browser paints the form again, so the success moment follows the click
 * without a flash of the button in between.
 */
function useReportVerified(state: ChallengeState, onVerified: (next: string) => void) {
  const next = state.verified?.next;
  React.useLayoutEffect(() => {
    if (next) onVerified(next);
  }, [next, onVerified]);
}

/** The moment between "that worked" and the page it leads to. */
function SigningIn({ kind }: { kind: SuccessKind }) {
  const t = useTranslations("Auth.twoFactor");
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center" data-two-factor-verified>
      <SuccessMark kind={kind} size="md" />
      <p role="status" className="font-inter text-sm font-medium text-foreground">
        {t("signingIn")}
      </p>
    </div>
  );
}

type SignInChallenge = { options: PublicKeyCredentialRequestOptionsJSON; slip: string };

/**
 * "Use your passkey". The options are fetched as the form appears, so the
 * click goes straight to the browser's prompt (Safari refuses one that is not
 * started by the click itself). Each challenge is single-use: after an answer
 * from the server, a fresh one is fetched for the next try.
 */
function PasskeyForm({
  next,
  email,
  onVerified,
  onUseApproval,
  onMiss,
}: {
  next: string;
  email: string;
  onVerified: (next: string) => void;
  /** Switch to "Approve from your phone", when the account can. */
  onUseApproval?: () => void;
  /** The passkey did not go through (closed, failed, refused). */
  onMiss?: () => void;
}) {
  const t = useTranslations("Auth.twoFactor");
  const tp = useTranslations("Auth.twoFactor.passkey");
  const reducedMotion = useReducedMotion();
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(verifyPasskeySignIn, INITIAL);
  const [challenge, setChallenge] = React.useState<SignInChallenge | null>(null);
  const [problem, setProblem] = React.useState<ActionError | string | null>(null);
  // The problem is the person closing the prompt: said in muted words, not red.
  const [quietProblem, setQuietProblem] = React.useState(false);
  // Loading the options failed; the button then retries the load.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "working" | "sent">("idle");
  // Bumped on every failure: it keys the fingerprint, so its shake replays.
  const [failures, setFailures] = React.useState(0);

  // The server answered: the challenge it was sent is spent either way.
  const [seenState, setSeenState] = React.useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setPhase("idle");
    setChallenge(null);
    if (state.error) setFailures((count) => count + 1);
  }

  useReportVerified(state, onVerified);

  React.useEffect(() => {
    if (failures > 0) onMiss?.();
  }, [failures, onMiss]);

  React.useEffect(() => {
    if (challenge || loadFailed || phase !== "idle") return;
    let live = true;
    // A request that failed outright (offline, a deploy mid-visit) is a failed
    // load too, so the button offers to try again instead of staying disabled.
    void passkeySignInOptions()
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        if (result?.options && result.slip) {
          setChallenge({ options: result.options, slip: result.slip });
        } else {
          setLoadFailed(true);
          setProblem(result?.error ?? tp("failed"));
        }
      });
    return () => {
      live = false;
    };
  }, [challenge, loadFailed, phase, tp]);

  const loading = !challenge && !loadFailed && phase === "idle";

  async function confirmWithPasskey() {
    setProblem(null);
    setQuietProblem(false);
    if (!passkeysSupported()) {
      setProblem(tp("unsupported"));
      return;
    }
    if (!challenge) {
      // The load failed: this click tries it again.
      setLoadFailed(false);
      return;
    }
    setPhase("working");
    const outcome = await assertPasskey(challenge.options);
    if (!outcome.ok) {
      setPhase("idle");
      setFailures((count) => count + 1);
      setQuietProblem(outcome.reason === "cancelled");
      setProblem(
        outcome.reason === "cancelled"
          ? tp("cancelled")
          : outcome.reason === "unsupported"
            ? tp("unsupported")
            : tp("failed"),
      );
      return;
    }
    setPhase("sent");
    const data = new FormData();
    data.set("credential", outcome.credential);
    data.set("slip", challenge.slip);
    data.set("next", next);
    React.startTransition(() => formAction(data));
  }

  const busy = phase !== "idle" || isPending;
  const offerApproval = Boolean(onUseApproval) && failures > 0;
  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );

  return (
    <div className="flex flex-col gap-5" data-passkey-challenge>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>
          {email ? tp.rich("introAs", { email, strong }) : tp("intro")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={confirmWithPasskey}
          disabled={busy || loading}
          suppressHydrationWarning
          className="w-full px-8 py-3.5 text-base"
        >
          <AnimatedFingerprint
            key={failures}
            state={busy ? "scanning" : failures > 0 ? "error" : "idle"}
            className="size-5"
          />
          {busy ? tp("waiting") : tp("button")}
        </Button>
        {/* Right under the button it is about, and small: a closed prompt is
            a choice, not an error, so only a real failure is red. */}
        {problem && (
          <p role="alert" className={cn(infoTextClass, !quietProblem && "text-destructive")}>
            {typeof problem === "string" ? problem : resolve(problem.message)}
          </p>
        )}
        {/* After a miss the way round below says it better: one explanation
            on screen at a time. */}
        {!offerApproval && <p className={infoTextClass}>{tp("hint")}</p>}
      </div>

      <Status state={state} next={next} />

      {/* The case this is for: the computer offered its own "use a phone" QR
          code and the phone said it has no passkey, because the passkey lives
          on another device. After any miss, the way that needs no passkey. */}
      {offerApproval && (
        <motion.div
          className="flex gap-3 bg-muted/60 p-4"
          data-passkey-elsewhere
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SETTLE}
        >
          <span className="grid size-9 shrink-0 place-items-center bg-background text-foreground">
            <MonitorSmartphone aria-hidden className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-inter text-sm font-medium text-foreground">{tp("elsewhereTitle")}</p>
            <p className={infoTextClass}>{tp("elsewhereBody")}</p>
            <Button type="button" variant="secondary" onClick={onUseApproval} className="mt-2 sm:self-start">
              {tp("approveInstead")}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** The factor's name and the account's email are data; each combination is its own sentence. */
function CodeIntro({ name, email }: { name: string | null; email: string }) {
  const t = useTranslations("Auth.twoFactor");
  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );
  if (name !== null && email) return t.rich("introNamedAs", { name, email, strong });
  if (name !== null) return t.rich("introNamed", { name, strong });
  if (email) return t.rich("introAs", { email, strong });
  return t("intro");
}

function CodeForm({
  next,
  email,
  factors,
  onVerified,
}: {
  next: string;
  email: string;
  factors: FactorChoice[];
  onVerified: (next: string) => void;
}) {
  const t = useTranslations("Auth.twoFactor");
  const [state, formAction, isPending] = useActionState(verifyTwoFactorSignIn, INITIAL);
  const single = factors.length < 2 ? factors[0] : null;
  useReportVerified(state, onVerified);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>
          <CodeIntro name={single ? single.name : null} email={email} />
        </p>
      </div>

      <FactorPicker factors={factors} name="factor_id" id="challenge-factor" />

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{t("codeLabel")}</Label>
        <OneTimeCodeInput
          id="code"
          name="code"
          autoFocus
          required
          submitOnComplete
          // readOnly, not disabled: a disabled field is left out of the form
          // data, which would post an empty code if a re-render landed first.
          readOnly={isPending}
          aria-invalid={state.error ? true : undefined}
        />
      </div>

      <Status state={state} next={next} />

      <Button
        type="submit"
        disabled={isPending}
        suppressHydrationWarning
        className="w-full px-8 py-3.5 text-base"
      >
        {isPending ? (
          <>
            <Spinner />
            {t("verifying")}
          </>
        ) : (
          t("verify")
        )}
      </Button>
    </form>
  );
}

function RecoveryForm({ next }: { next: string }) {
  const t = useTranslations("Auth.twoFactor.recovery");
  const [state, formAction, isPending] = useActionState(signInWithRecoveryCode, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>{t("intro")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="recovery_code">{t("label")}</Label>
        <Input
          id="recovery_code"
          name="recovery_code"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          maxLength={64}
          autoFocus
          required
          className="font-mono"
        />
        {/* Said BEFORE they press the button: this is not a quiet way round
            2FA, it switches it off. */}
        <p className={infoTextClass}>{t("warning")}</p>
      </div>

      <Status state={state} next={next} />

      <Button
        type="submit"
        disabled={isPending}
        suppressHydrationWarning
        className="w-full px-8 py-3.5 text-base"
      >
        {isPending ? (
          <>
            <Spinner />
            {t("checking")}
          </>
        ) : (
          t("continue")
        )}
      </Button>
    </form>
  );
}
