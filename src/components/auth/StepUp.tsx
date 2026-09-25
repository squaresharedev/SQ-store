"use client";

import * as React from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { infoTextClass } from "@/components/ui/control-styles";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { STEP_UP_HINT_COOKIE, STEP_UP_WINDOW_SECONDS } from "@/lib/auth/assurance";
import { passkeyStepUpOptions } from "@/lib/auth/mfa-actions";
import { assertPasskey, passkeysSupported } from "@/lib/auth/webauthn-client";
import type { ActionError } from "@/lib/errors";

/**
 * Client half of the step-up ("confirm it's you") check that sensitive
 * actions run on the server (requireStepUpState in lib/auth/mfa.ts).
 *
 * THE SERVER DECIDES; this only decides when to SHOW the code field. It shows
 * the field BEFORE the person submits whenever the server is going to ask,
 * because React 19 resets a form after its action runs: finding out only
 * after submitting would wipe a half-typed password change and make them
 * start again. If the two ever disagree (a clock drifted, the window closed
 * mid-typing), the action's own `stepUp` answer brings the field up anyway.
 */

type StepUpContextValue = {
  enrolled: boolean;
  /** Unix seconds when the current window closes; 0 = closed now. */
  freshUntil: number | null;
  factors: FactorChoice[];
  /** A code just went through: the server's window reopened. */
  markFresh: () => void;
};

const StepUpContext = React.createContext<StepUpContextValue>({
  enrolled: false,
  freshUntil: null,
  factors: [],
  markFresh: () => {},
});

/**
 * Ask for the code this long before the server's window actually closes, so
 * someone who starts typing at 9m50s is not refused at 10m05s.
 */
const EARLY_SECONDS = 60;

export function StepUpProvider({
  enrolled,
  freshUntil: serverFreshUntil,
  factors,
  children,
}: {
  enrolled: boolean;
  freshUntil: number | null;
  factors: FactorChoice[];
  children: React.ReactNode;
}) {
  // What this browser has seen happen since the layout rendered: a code that
  // went through reopened the window. Combined with the server's value rather
  // than replacing it, so a re-render (after a revalidation) that carries the
  // authoritative figure wins whenever it is the later of the two, and a stale
  // layout can never close a window the browser just watched reopen.
  const [reopenedUntil, setReopenedUntil] = React.useState<number | null>(null);
  const freshUntil =
    serverFreshUntil === null ? null : Math.max(serverFreshUntil, reopenedUntil ?? 0);

  const markFresh = React.useCallback(() => {
    setReopenedUntil(Math.floor(Date.now() / 1000) + STEP_UP_WINDOW_SECONDS);
  }, []);

  const value = React.useMemo(
    () => ({ enrolled, freshUntil, factors, markFresh }),
    [enrolled, freshUntil, factors, markFresh],
  );
  return <StepUpContext.Provider value={value}>{children}</StepUpContext.Provider>;
}

/** Unix seconds from the step-up hint cookie, or 0. See STEP_UP_HINT_COOKIE. */
function readStepUpHint(): number {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${STEP_UP_HINT_COOKIE}=(\\d+)`));
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

/** True while a sensitive action would be refused without a code. */
export function useStepUpRequired(): boolean {
  const { enrolled, freshUntil } = React.useContext(StepUpContext);
  const closesAt = enrolled && freshUntil !== null ? freshUntil - EARLY_SECONDS : null;
  // Unknown until mounted: the server's clock and the browser's differ by the
  // render delay, and deciding during SSR would risk a hydration mismatch on
  // the one render where the window closes in between. The hint cookie is
  // read at the same moment (it only exists in the browser anyway).
  const [clock, setClock] = React.useState<{ now: number; hint: number } | null>(null);

  // Read the clock once on mount, then wake up exactly when the window
  // closes, rather than polling.
  React.useEffect(() => {
    const read = () => ({ now: Math.floor(Date.now() / 1000), hint: readStepUpHint() });
    const first = read();
    const timers = [setTimeout(() => setClock(first), 0)];
    if (closesAt !== null) {
      const target = Math.max(closesAt, first.hint - EARLY_SECONDS);
      if (target > first.now) {
        timers.push(setTimeout(() => setClock(read()), (target - first.now) * 1000 + 50));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [closesAt]);

  if (closesAt === null || clock === null) return false;
  // A code accepted by ANY form since this layout rendered reopened the
  // window; the server's hint cookie says until when.
  return clock.now >= Math.max(closesAt, clock.hint - EARLY_SECONDS);
}

/**
 * Drop inside any form whose action calls requireStepUpState. Renders nothing until
 * a code is needed; then a code box (and, for more than one authenticator, a
 * picker) posting `mfa_code` / `mfa_factor_id`, the names the server's field
 * whitelists allow.
 *
 * `always` is for the 2FA controls themselves, whose actions demand a code in
 * every request regardless of the window.
 */
export function StepUpField({
  state,
  id,
  always = false,
  requireFresh = false,
  description,
}: {
  /**
   * The form's action state, whose `stepUp` flag forces the field on. Only
   * the flag and whether it succeeded are read, so any action state fits.
   */
  state?: { stepUp?: true; success?: unknown };
  /** Unique per form on a page: several step-up forms can be mounted at once. */
  id: string;
  always?: boolean;
  /**
   * For an action whose server side demands a code in the request itself
   * (maxAgeSeconds: 0) whenever the account has 2FA, e.g. a Google-only
   * account's email change: shown for every enrolled account, never for one
   * without 2FA.
   */
  requireFresh?: boolean;
  /** Why a code is asked for here. Defaults to the generic "sensitive change".
   *  An account confirming with a passkey sees the passkey wording instead. */
  description?: string;
}) {
  const t = useTranslations("Auth.stepUp");
  const { enrolled, factors, markFresh } = React.useContext(StepUpContext);
  const required = useStepUpRequired();
  const show = always || (requireFresh && enrolled) || required || Boolean(state?.stepUp);

  const apps = React.useMemo(() => factors.filter((f) => f.type !== "passkey"), [factors]);
  const hasPasskey = factors.some((f) => f.type === "passkey");
  // A passkey first whenever the account has one: it is one tap, and it is
  // the stronger of the two. The app stays a click away for an account that
  // also has one (a phone left at home).
  const [method, setMethod] = React.useState<"passkey" | "code">(hasPasskey ? "passkey" : "code");
  const usePasskey = hasPasskey && method === "passkey";

  // A submit that went through WITH a code reopened the server's window, so
  // the next sensitive form on the page need not ask again.
  const shown = React.useRef(show);
  React.useEffect(() => {
    if (shown.current && state?.success) markFresh();
    shown.current = show;
  }, [state, show, markFresh]);

  if (!show) return null;

  return (
    <div
      className="flex flex-col gap-3 border border-border bg-muted/40 p-4"
      data-step-up-field
    >
      <p className="flex items-start gap-2 font-inter text-sm text-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{usePasskey ? t("passkeyDescription") : (description ?? t("description"))}</span>
      </p>
      {usePasskey ? (
        <PasskeyConfirm id={id} state={state} />
      ) : (
        <>
          <FactorPicker factors={apps} name="mfa_factor_id" id={`${id}-factor`} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-code`}>{t("codeLabel")}</Label>
            <OneTimeCodeInput id={`${id}-code`} name="mfa_code" required />
            <p className={infoTextClass}>{t("codeHint")}</p>
          </div>
        </>
      )}
      {hasPasskey && apps.length > 0 && (
        <button
          type="button"
          onClick={() => setMethod(usePasskey ? "code" : "passkey")}
          className="w-fit font-inter text-xs text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-base ease-standard hover:text-foreground hover:decoration-foreground motion-reduce:transition-none"
        >
          {usePasskey ? t("useCodeInstead") : t("usePasskeyInstead")}
        </button>
      )}
    </div>
  );
}

type StepUpChallenge = { options: PublicKeyCredentialRequestOptionsJSON; slip: string };

/**
 * "Confirm with passkey": runs the passkey prompt, puts the signed result in
 * the form (`mfa_passkey` + `mfa_passkey_slip`, which requireStepUpState
 * verifies), and submits the form it sits in, so the confirmation IS the save.
 *
 * The options are fetched as soon as this shows, not on click: Safari refuses
 * a passkey prompt that is not started directly by the click. Each challenge
 * is single-use, so after a submit they are fetched again, but only once the
 * action has answered (fetching while it runs could race it).
 */
function PasskeyConfirm({ id, state }: { id: string; state?: object }) {
  const t = useTranslations("Auth.stepUp");
  const resolve = useResolveMessage();
  const wrapper = React.useRef<HTMLDivElement>(null);
  const credentialInput = React.useRef<HTMLInputElement>(null);
  const slipInput = React.useRef<HTMLInputElement>(null);
  const [challenge, setChallenge] = React.useState<StepUpChallenge | null>(null);
  const [error, setError] = React.useState<ActionError | string | null>(null);
  // Loading the options failed; the button then retries the load.
  const [loadFailed, setLoadFailed] = React.useState(false);
  // idle: ready (or fetching); working: the prompt is open; sent: the form is
  // submitting with a spent challenge, so nothing is fetched until it answers.
  const [phase, setPhase] = React.useState<"idle" | "working" | "sent">("idle");

  // The action answered (a new state object): the challenge it carried is
  // spent either way, so start over. Adjusted during render, React's pattern
  // for resetting state when a prop changes.
  const [seenState, setSeenState] = React.useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setPhase("idle");
    setChallenge(null);
  }

  React.useEffect(() => {
    if (challenge || loadFailed || phase !== "idle") return;
    let live = true;
    void passkeyStepUpOptions().then((result) => {
      if (!live) return;
      if (result.options && result.slip) {
        setChallenge({ options: result.options, slip: result.slip });
      } else {
        setLoadFailed(true);
        setError(result.error ?? t("passkeyFailed"));
      }
    });
    return () => {
      live = false;
    };
  }, [challenge, loadFailed, phase, t]);

  const loading = !challenge && !loadFailed && phase === "idle";

  async function confirm() {
    setError(null);
    if (!passkeysSupported()) {
      setError(t("passkeyUnsupported"));
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
      setError(
        outcome.reason === "cancelled"
          ? t("passkeyCancelled")
          : outcome.reason === "unsupported"
            ? t("passkeyUnsupported")
            : t("passkeyFailed"),
      );
      return;
    }
    setPhase("sent");
    if (credentialInput.current) credentialInput.current.value = outcome.credential;
    if (slipInput.current) slipInput.current.value = challenge.slip;
    wrapper.current?.closest("form")?.requestSubmit();
  }

  const working = phase !== "idle";

  return (
    <div ref={wrapper} className="flex flex-col gap-2" data-passkey-ready={challenge ? "" : undefined}>
      {/* Uncontrolled on purpose: React resets the form after the action runs,
          which empties these, and a spent assertion must not be sent twice. */}
      <input ref={credentialInput} type="hidden" name="mfa_passkey" defaultValue="" />
      <input ref={slipInput} type="hidden" name="mfa_passkey_slip" defaultValue="" />
      <Button
        type="button"
        variant="secondary"
        onClick={confirm}
        disabled={working || loading}
        className="w-full sm:w-fit"
        data-passkey-confirm={id}
      >
        {working ? (
          <>
            <Spinner />
            {t("passkeyWaiting")}
          </>
        ) : (
          <>
            <Fingerprint aria-hidden className="size-4" />
            {t("passkeyButton")}
          </>
        )}
      </Button>
      {error && (
        <p role="alert" className="font-inter text-sm font-medium text-destructive">
          {typeof error === "string" ? error : resolve(error.message)}
        </p>
      )}
    </div>
  );
}
