import {
  OnboardingPanel,
  type OnboardingData,
} from "@/components/onboarding/OnboardingPanel";

export type { OnboardingData };

/**
 * THE SETUP SLOT on Overview, reserved when the dashboard was composed and
 * filled by onboarding: the "Get set up" checklist, plus the welcome flow that
 * opens once for a new seller (components/onboarding/).
 *
 * Data in, decision only: the page resolves who is looking and what their store
 * is missing, and this decides whether anything renders at all. Nothing for a
 * member on someone else's store unless they asked for the guided tour (that
 * store's setup is not theirs to do), and nothing once there is neither a
 * checklist to show, a dialog to open, nor a tour to start.
 *
 * A finished setup still renders the panel even once its card has been shown:
 * whether the card is due is latched on the client for the visit (see
 * OnboardingPanel), so a revalidation mid-read cannot take it away.
 */
export function OnboardingSlot({
  onboarding,
}: {
  onboarding: OnboardingData | null;
}) {
  if (!onboarding) return null;
  if (!onboarding.setup && !onboarding.welcomePending && !onboarding.tourRequested) {
    return null;
  }
  return <OnboardingPanel {...onboarding} />;
}
