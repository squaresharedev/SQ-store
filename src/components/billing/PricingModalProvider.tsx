"use client";

import * as React from "react";
import { StepUpProvider } from "@/components/auth/StepUp";
import type { FactorChoice } from "@/components/auth/FactorPicker";
import { PricingModal, type PricingModalActions } from "@/components/billing/PricingModal";
import { PricingModalContext, type PricingModalApi } from "@/components/billing/pricing-modal-context";
import { PLANS_PARAM, parsePricingSource, type PricingSource } from "@/lib/billing/paths";
import type { PlanId } from "@/lib/billing/plans";

/**
 * THE PRICING MODAL, once per page: mounted by DashboardShell, opened from
 * anywhere inside it with `usePricingModal().open({ source })`.
 *
 * Opening is never a navigation. A seller who hits a plan limit halfway
 * through a form sees the plans over that form, and closing them leaves
 * everything they typed where it was (a link would trip the unsaved-changes
 * guard, NavigationBlockerProvider, and ask them to discard it).
 *
 * A link from OUTSIDE the page (an email, a notification, Stripe's cancel
 * URL) arrives with `?plans=<source>`; the modal opens on arrival and the
 * parameter is removed, so a reload does not open it again.
 *
 * The modal's plan-switch and cancel buttons open the Stripe Customer Portal,
 * which asks for a two-factor code first; the shell hands over the session's
 * step-up state so the code box works here as it does in Settings.
 */

export type StepUpState = {
  enrolled: boolean;
  freshUntil: number | null;
  factors: FactorChoice[];
};

export function PricingModalProvider({
  plan,
  stepUp,
  actions,
  children,
}: {
  plan: PlanId | null;
  stepUp: StepUpState;
  /** The server actions, injectable so /dev/pricing can run without a session. */
  actions?: PricingModalActions;
  children: React.ReactNode;
}) {
  const [source, setSource] = React.useState<PricingSource | null>(null);

  // A deep link: open once on arrival, then drop the parameter. Read from
  // window.location rather than useSearchParams, which would force every page
  // in the shell out of static rendering for a parameter almost never there.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const arrived = parsePricingSource(url.searchParams.get(PLANS_PARAM));
    if (!arrived) return;
    url.searchParams.delete(PLANS_PARAM);
    window.history.replaceState(window.history.state, "", url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount; opening from it IS the effect.
    setSource(arrived);
  }, []);

  const api = React.useMemo<PricingModalApi>(
    () => ({ open: ({ source: from }) => setSource(from), plan }),
    [plan],
  );

  return (
    <PricingModalContext.Provider value={api}>
      {children}
      {source && (
        <StepUpProvider enrolled={stepUp.enrolled} freshUntil={stepUp.freshUntil} factors={stepUp.factors}>
          <PricingModal source={source} onClose={() => setSource(null)} actions={actions} />
        </StepUpProvider>
      )}
    </PricingModalContext.Provider>
  );
}
