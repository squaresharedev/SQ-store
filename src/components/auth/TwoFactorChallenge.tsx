"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { signOut } from "@/lib/auth/actions";
import {
  signInWithRecoveryCode,
  verifyTwoFactorSignIn,
  type ChallengeState,
} from "@/lib/auth/mfa-actions";

const INITIAL: ChallengeState = {};

/**
 * The sign-in challenge: a code from the authenticator app, or (for someone
 * whose phone is gone) one of their recovery codes. Two forms, one on screen
 * at a time, each with its own action so a recovery code can never be sent to
 * the code check or the other way round.
 */
export function TwoFactorChallenge({
  next,
  email,
  factors,
}: {
  next: string;
  email: string;
  factors: FactorChoice[];
}) {
  const t = useTranslations("Auth.twoFactor");
  const [mode, setMode] = React.useState<"code" | "recovery">("code");

  return (
    <div className="flex flex-col gap-5">
      {mode === "code" ? (
        <CodeForm next={next} email={email} factors={factors} />
      ) : (
        <RecoveryForm next={next} />
      )}

      <div className="flex flex-col items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "code" ? "recovery" : "code"))}
          suppressHydrationWarning
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-inter text-sm text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground motion-reduce:transition-none"
        >
          {mode === "code" ? (
            <>
              <KeyRound aria-hidden className="size-4" />
              {t("useRecoveryCode")}
            </>
          ) : (
            <>
              <Smartphone aria-hidden className="size-4" />
              {t("useAuthenticatorApp")}
            </>
          )}
        </button>
        {/* A way out of the half-signed-in state on a shared computer, or for
            the wrong account. Ends only this session. */}
        <form action={signOut}>
          <button
            type="submit"
            className="font-inter text-xs text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:text-foreground hover:decoration-foreground motion-reduce:transition-none"
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
}: {
  next: string;
  email: string;
  factors: FactorChoice[];
}) {
  const t = useTranslations("Auth.twoFactor");
  const [state, formAction, isPending] = useActionState(verifyTwoFactorSignIn, INITIAL);
  const single = factors.length < 2 ? factors[0] : null;

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
