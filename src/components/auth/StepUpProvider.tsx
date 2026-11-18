"use client";

import * as React from "react";
import { STEP_UP_WINDOW_SECONDS } from "@/lib/auth/assurance";
import type { FactorChoice } from "@/components/auth/FactorPicker";

export type StepUpContextValue = {
  enrolled: boolean;
  /** Unix seconds when the current window closes; 0 = closed now. */
  freshUntil: number | null;
  factors: FactorChoice[];
  /** A code just went through: the server's window reopened. */
  markFresh: () => void;
};

/**
 * With no StepUpProvider above it, a form believes the account has no factors,
 * so a passkey-only account is shown a code box it can never fill. Every route
 * holding a step-up form needs a provider (the dashboard and settings layouts
 * have one; the consent page brings its own).
 *
 * Slim version: only the context and provider live here, so layouts that need
 * to mount the provider do not pull in the full StepUp.tsx bundle (mfa-actions,
 * webauthn, AnimatedFingerprint, motion). The heavy UI lives in StepUp.tsx and
 * is bundled only for pages that actually render step-up forms.
 */
export const StepUpContext = React.createContext<StepUpContextValue>({
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
export { EARLY_SECONDS };

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
