"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, Smartphone } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass, quietLinkClass } from "@/components/ui/control-styles";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { signOut } from "@/lib/auth/actions";
import {
  passkeySignInOptions,
  signInWithRecoveryCode,
  verifyPasskeySignIn,
  verifyTwoFactorSignIn,
  type ChallengeState,
} from "@/lib/auth/mfa-actions";
import { assertPasskey, passkeysSupported } from "@/lib/auth/webauthn-client";
import type { ActionError } from "@/lib/errors";

const INITIAL: ChallengeState = {};

type Mode = "passkey" | "code" | "recovery";

const SWITCH_CLASS =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-inter text-sm text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground motion-reduce:transition-none";

/**
 * The sign-in challenge: a passkey, a code from the authenticator app, or
 * (for someone whose phone is gone) one of their recovery codes. One form on
 * screen at a time, each with its own action, so nothing sent for one check
 * can ever reach another. A passkey comes first whenever the account has one.
 *
 * Once through, the page shows a moment of success and then goes on, whether
 * it learned that from the form's action or from the server (`through`: the
 * render that follows a successful action is a signed-in one, because the
 * action set the upgraded session's cookies). Either way the destination is
 * a path the server sanitised.
 */
export function TwoFactorChallenge({
  next,
  email,
  factors,
  through = false,
}: {
  next: string;
  email: string;
  factors: FactorChoice[];
  /** This session has already passed its second factor. */
  through?: boolean;
}) {
  const t = useTranslations("Auth.twoFactor");
  const apps = factors.filter((factor) => factor.type !== "passkey");
  const hasPasskey = factors.some((factor) => factor.type === "passkey");
  const [mode, setMode] = React.useState<Mode>(hasPasskey ? "passkey" : "code");
  const [verifiedNext, setVerifiedNext] = React.useState<string | null>(null);
  const onVerified = React.useCallback((to: string) => setVerifiedNext(to), []);
  const destination = verifiedNext ?? (through ? next : null);
  useContinueTo(destination);

  if (destination) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <SigningIn kind={mode === "passkey" ? "passkey" : "app"} />
      </div>
    );
  }

  // The ways out of the current one, in the order a person would reach for them.
  const switches: { to: Mode; label: string; icon: React.ReactNode }[] = [];
  if (mode !== "passkey" && hasPasskey) {
    switches.push({ to: "passkey", label: t("usePasskey"), icon: <Fingerprint aria-hidden className="size-4" /> });
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
        <PasskeyForm next={next} email={email} onVerified={onVerified} />
      ) : mode === "code" ? (
        <CodeForm next={next} email={email} factors={apps} onVerified={onVerified} />
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
function SigningIn({ kind }: { kind: "passkey" | "app" }) {
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
}: {
  next: string;
  email: string;
  onVerified: (next: string) => void;
}) {
  const t = useTranslations("Auth.twoFactor");
  const tp = useTranslations("Auth.twoFactor.passkey");
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(verifyPasskeySignIn, INITIAL);
  const [challenge, setChallenge] = React.useState<SignInChallenge | null>(null);
  const [problem, setProblem] = React.useState<ActionError | string | null>(null);
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
      <p className={infoTextClass}>{tp("hint")}</p>

      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {typeof problem === "string" ? problem : resolve(problem.message)}
        </p>
      )}
      <Status state={state} next={next} />
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
