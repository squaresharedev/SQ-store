"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { infoTextClass } from "@/components/ui/control-styles";
import { FactorPicker, type FactorChoice } from "@/components/auth/FactorPicker";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { STEP_UP_HINT_COOKIE, STEP_UP_WINDOW_SECONDS } from "@/lib/auth/assurance";

/**
 * Client half of the step-up ("confirm it's you") check that sensitive
 * actions run on the server (requireStepUp in lib/auth/mfa.ts).
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
 * Drop inside any form whose action calls requireStepUp. Renders nothing until
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
  description = "This is a sensitive change. Enter the current code from your authenticator app to confirm it's you.",
}: {
  /** The form's action state, whose `stepUp` flag forces the field on. */
  state?: { stepUp?: true; success?: string; error?: string };
  /** Unique per form on a page: several step-up forms can be mounted at once. */
  id: string;
  always?: boolean;
  description?: string;
}) {
  const { factors, markFresh } = React.useContext(StepUpContext);
  const required = useStepUpRequired();
  const show = always || required || Boolean(state?.stepUp);

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
        <span>{description}</span>
      </p>
      <FactorPicker factors={factors} name="mfa_factor_id" id={`${id}-factor`} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-code`}>Authenticator code</Label>
        <OneTimeCodeInput id={`${id}-code`} name="mfa_code" required />
        <p className={infoTextClass}>The 6 digits in your app right now.</p>
      </div>
    </div>
  );
}
