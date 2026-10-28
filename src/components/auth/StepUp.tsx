"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { infoTextClass, quietLinkClass } from "@/components/ui/control-styles";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { STEP_UP_HINT_COOKIE, STEP_UP_WINDOW_SECONDS } from "@/lib/auth/assurance";
import { passkeyStepUpOptions } from "@/lib/auth/mfa-actions";
import { assertPasskey, passkeysSupported } from "@/lib/auth/webauthn-client";
import type { ActionError } from "@/lib/errors";
import { FORM_UNREACHABLE, resilientAction } from "@/lib/resilient-action";

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

// A passkey challenge is sealed and single-use, so asking again for one is
// always safe (lib/resilient-action.ts).
const loadPasskeyOptions = resilientAction(passkeyStepUpOptions, { error: FORM_UNREACHABLE.error });

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

type StepUpProps = {
  /**
   * The form's action state, whose `stepUp` flag forces the field on. Only
   * the flag and whether it succeeded are read, so any action state fits.
   */
  state?: { stepUp?: true; success?: unknown };
  /** Unique per form on a page: several step-up forms can be mounted at once. */
  id: string;
  /**
   * For the 2FA controls themselves, whose actions demand a code in every
   * request regardless of the window.
   */
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
};

/** What one form's step-up comes to right now, shared by the parts below. */
type FormStepUp = {
  id: string;
  /** A confirmation is being asked for at all. */
  show: boolean;
  /** It is asked for with a passkey: the account has one, and it is the way chosen. */
  usePasskey: boolean;
  /** The account's authenticator apps, for the code way. */
  apps: FactorChoice[];
  /** Both ways exist, so the person may switch between them. */
  canSwitch: boolean;
  switchMethod: () => void;
  description?: string;
  passkey: PasskeyStepUp;
  /** The two hidden fields a passkey's signed result is posted in. Refs, each
   *  on its own and apart from the plain values above: they are only ever
   *  handed to their input and read in a handler. */
  credentialField: HiddenField;
  slipField: HiddenField;
};

const FormStepUpContext = React.createContext<FormStepUp | null>(null);

function useFormStepUp(): FormStepUp {
  const value = React.useContext(FormStepUpContext);
  if (!value) throw new Error("StepUpPrompt and StepUpSubmit belong inside a StepUpScope.");
  return value;
}

/**
 * One form's step-up, for a form that wants the confirmation to BE its submit
 * button rather than a box above it (a dialog, where two buttons that both
 * move things on is one too many). Wrap the form's contents in it, then:
 *
 *   <StepUpPrompt />  where the code box would go. With a passkey it is only
 *                     what can go wrong and the way round it;
 *   <StepUpSubmit>    the form's primary button. With a passkey it IS the
 *                     confirmation ("Confirm with passkey"); otherwise it is
 *                     the ordinary submit, with the words given to it.
 *
 * Everywhere else, StepUpField below is the whole thing in one box.
 */
export function StepUpScope({
  state,
  id,
  always = false,
  requireFresh = false,
  description,
  children,
}: StepUpProps & { children: React.ReactNode }) {
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

  const { passkey, credentialField, slipField } = usePasskeyStepUp(state, show && usePasskey);
  const canSwitch = hasPasskey && apps.length > 0;
  const switchMethod = React.useCallback(
    () => setMethod((current) => (current === "passkey" ? "code" : "passkey")),
    [],
  );

  const value = React.useMemo(
    () => ({
      id,
      show,
      usePasskey,
      apps,
      canSwitch,
      switchMethod,
      description,
      passkey,
      credentialField,
      slipField,
    }),
    [id, show, usePasskey, apps, canSwitch, switchMethod, description, passkey, credentialField, slipField],
  );
  return <FormStepUpContext.Provider value={value}>{children}</FormStepUpContext.Provider>;
}

/**
 * Drop inside any form whose action calls requireStepUpState. Renders nothing until
 * a code is needed; then a code box (and, for more than one authenticator, a
 * picker) posting `mfa_code` / `mfa_factor_id`, the names the server's field
 * whitelists allow.
 */
export function StepUpField(props: StepUpProps) {
  return (
    <StepUpScope {...props}>
      <StepUpBox />
    </StepUpScope>
  );
}

/** Where the confirmation is asked for, inside a StepUpScope whose submit
 *  button is a StepUpSubmit. */
export function StepUpPrompt() {
  const stepUp = useFormStepUp();
  if (!stepUp.show) return null;
  // A code is typed, so it needs its box, the same one as everywhere.
  if (!stepUp.usePasskey) return <StepUpBox />;
  // A passkey is one press of the form's own button: nothing to show here but
  // what went wrong, and the other way to confirm.
  if (!stepUp.passkey.error && !stepUp.canSwitch) return null;
  return (
    <div className="flex flex-col gap-2" data-step-up-field>
      <PasskeyError />
      <SwitchMethod />
    </div>
  );
}

/**
 * The primary button of a form inside a StepUpScope. Confirming with a passkey
 * it is that confirmation, which submits the form itself; otherwise it is the
 * form's ordinary submit button.
 */
export function StepUpSubmit({
  children,
  pending = false,
  pendingLabel,
  variant = "primary",
  className,
}: {
  /** The button's words when it is an ordinary submit. */
  children: React.ReactNode;
  pending?: boolean;
  pendingLabel?: React.ReactNode;
  /** `destructive` where what is being confirmed cannot be undone. */
  variant?: "primary" | "destructive";
  className?: string;
}) {
  const stepUp = useFormStepUp();
  if (stepUp.show && stepUp.usePasskey) {
    return <PasskeyConfirmButton variant={variant} className={className} />;
  }
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** The whole confirmation in one bordered box: why, the control, the other way. */
function StepUpBox() {
  const t = useTranslations("Auth.stepUp");
  const stepUp = useFormStepUp();
  if (!stepUp.show) return null;

  return (
    <div
      className="flex flex-col gap-3 border border-border bg-muted/40 p-4"
      data-step-up-field
    >
      <p className="flex items-start gap-2 font-inter text-sm text-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{stepUp.usePasskey ? t("passkeyDescription") : (stepUp.description ?? t("description"))}</span>
      </p>
      {stepUp.usePasskey ? (
        <div className="flex flex-col gap-2">
          <PasskeyConfirmButton variant="secondary" className="w-full sm:w-fit" />
          <PasskeyError />
        </div>
      ) : (
        <>
          <FactorPicker factors={stepUp.apps} name="mfa_factor_id" id={`${stepUp.id}-factor`} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${stepUp.id}-code`}>{t("codeLabel")}</Label>
            <OneTimeCodeInput id={`${stepUp.id}-code`} name="mfa_code" required />
            <p className={infoTextClass}>{t("codeHint")}</p>
          </div>
        </>
      )}
      <SwitchMethod />
    </div>
  );
}

/** "Use a code instead" / "Use your passkey instead", for an account with both. */
function SwitchMethod() {
  const t = useTranslations("Auth.stepUp");
  const stepUp = useFormStepUp();
  if (!stepUp.canSwitch) return null;
  return (
    <button type="button" onClick={stepUp.switchMethod} className={`w-fit ${quietLinkClass}`}>
      {stepUp.usePasskey ? t("useCodeInstead") : t("usePasskeyInstead")}
    </button>
  );
}

type StepUpChallenge = { options: PublicKeyCredentialRequestOptionsJSON; slip: string };

type HiddenField = React.RefObject<HTMLInputElement | null>;

type PasskeyStepUp = {
  /** The options have arrived: a press goes straight to the browser's prompt. */
  ready: boolean;
  /** Still fetching them. */
  loading: boolean;
  /** The prompt is open, or the form is on its way with the result. */
  working: boolean;
  /** Bumped on every miss: it keys the fingerprint, so its shake replays. */
  failures: number;
  error: ActionError | string | null;
  confirm: () => void;
};

/**
 * Confirming with a passkey: runs the passkey prompt, puts the signed result
 * in the form (`mfa_passkey` + `mfa_passkey_slip`, which requireStepUpState
 * verifies), and submits the form those fields sit in, so the confirmation IS
 * the save.
 *
 * The options are fetched as soon as this is the way being asked for, not on
 * click: Safari refuses a passkey prompt that is not started directly by the
 * click. Each challenge is single-use, so after a submit they are fetched
 * again, but only once the action has answered (fetching while it runs could
 * race it).
 */
function usePasskeyStepUp(
  state: { stepUp?: true } | undefined,
  active: boolean,
): { passkey: PasskeyStepUp; credentialField: HiddenField; slipField: HiddenField } {
  const t = useTranslations("Auth.stepUp");
  const credentialField = React.useRef<HTMLInputElement>(null);
  const slipField = React.useRef<HTMLInputElement>(null);
  const [challenge, setChallenge] = React.useState<StepUpChallenge | null>(null);
  const [error, setError] = React.useState<ActionError | string | null>(null);
  // Loading the options failed; the button then retries the load.
  const [loadFailed, setLoadFailed] = React.useState(false);
  // idle: ready (or fetching); working: the prompt is open; sent: the form is
  // submitting with a spent challenge, so nothing is fetched until it answers.
  const [phase, setPhase] = React.useState<"idle" | "working" | "sent">("idle");
  const [failures, setFailures] = React.useState(0);

  // The action answered (a new state object): the challenge it carried is
  // spent either way, so start over. Adjusted during render, React's pattern
  // for resetting state when a prop changes.
  const [seenState, setSeenState] = React.useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setPhase("idle");
    setChallenge(null);
    // Refused as a step-up (not, say, a form field): the passkey did not take.
    if (state?.stepUp) setFailures((count) => count + 1);
  }

  // Asked for afresh (the box came up, or the person switched back from a
  // code): start clean, as a newly shown control would.
  const [wasActive, setWasActive] = React.useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setChallenge(null);
    setError(null);
    setLoadFailed(false);
    setPhase("idle");
    setFailures(0);
  }

  React.useEffect(() => {
    if (!active || challenge || loadFailed || phase !== "idle") return;
    let live = true;
    // A request that failed outright (offline, a deploy mid-visit) is a failed
    // load too, so the button offers to try again instead of staying disabled.
    void loadPasskeyOptions()
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        if (result?.options && result.slip) {
          setChallenge({ options: result.options, slip: result.slip });
        } else {
          setLoadFailed(true);
          setError(result?.error ?? t("passkeyFailed"));
        }
      });
    return () => {
      live = false;
    };
  }, [active, challenge, loadFailed, phase, t]);

  const confirm = React.useCallback(async () => {
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
      setFailures((count) => count + 1);
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
    if (credentialField.current) credentialField.current.value = outcome.credential;
    if (slipField.current) slipField.current.value = challenge.slip;
    // The form the two fields belong to: the one being confirmed.
    credentialField.current?.form?.requestSubmit();
  }, [challenge, t]);

  const passkey = React.useMemo(
    () => ({
      ready: Boolean(challenge),
      loading: active && !challenge && !loadFailed && phase === "idle",
      working: phase !== "idle",
      failures,
      error,
      confirm,
    }),
    [challenge, active, loadFailed, phase, failures, error, confirm],
  );
  return { passkey, credentialField, slipField };
}

/**
 * "Confirm with passkey", with the two fields its result is posted in. It must
 * sit INSIDE the form it confirms: the fields are that form's, and the press
 * itself starts the browser's prompt.
 */
function PasskeyConfirmButton({
  variant,
  className,
}: {
  variant: "primary" | "secondary" | "destructive";
  className?: string;
}) {
  const t = useTranslations("Auth.stepUp");
  const { id, passkey, credentialField, slipField } = useFormStepUp();
  return (
    <>
      {/* Uncontrolled on purpose: React resets the form after the action runs,
          which empties these, and a spent assertion must not be sent twice. */}
      <input ref={credentialField} type="hidden" name="mfa_passkey" defaultValue="" />
      <input ref={slipField} type="hidden" name="mfa_passkey_slip" defaultValue="" />
      <Button
        type="button"
        variant={variant}
        onClick={passkey.confirm}
        disabled={passkey.working || passkey.loading}
        className={className}
        data-passkey-confirm={id}
        data-passkey-ready={passkey.ready ? "" : undefined}
      >
        <AnimatedFingerprint
          key={passkey.failures}
          state={passkey.working ? "scanning" : passkey.failures > 0 ? "error" : "idle"}
        />
        {passkey.working ? t("passkeyWaiting") : t("passkeyButton")}
      </Button>
    </>
  );
}

/** Why the passkey did not take, when it did not. */
function PasskeyError() {
  const resolve = useResolveMessage();
  const { passkey } = useFormStepUp();
  if (!passkey.error) return null;
  return (
    <p role="alert" className="font-inter text-sm font-medium text-destructive">
      {typeof passkey.error === "string" ? passkey.error : resolve(passkey.error.message)}
    </p>
  );
}
