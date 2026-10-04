import {
  cancelPlan,
  openBillingPortal,
  resumePlan,
  startCheckout,
  type CancelPlanResult,
  type CheckoutResult,
  type PortalState,
  type ResumePlanResult,
} from "@/lib/billing/actions";
import type { CancellationFeedback } from "@/lib/billing/cancellation";
import type { PricingSource } from "@/lib/billing/paths";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";

/**
 * The server calls the billing surfaces make (the plans page, the settings
 * upsell). Injectable, so /dev/pricing can show every state without a
 * session, Stripe, or a database.
 */
export type BillingActions = {
  startCheckout: (input: { plan: PaidPlanId; interval: BillingInterval; source?: PricingSource }) => Promise<CheckoutResult>;
  openPortal: (prev: PortalState, formData: FormData) => Promise<PortalState>;
  /** End the paid plan with its period, with what the owner told us. */
  cancelPlan: (feedback: CancellationFeedback) => Promise<CancelPlanResult>;
  /** Undo that while the period is still running ("Keep my plan"). */
  resumePlan: () => Promise<ResumePlanResult>;
  /** Leave for Stripe's page. A full navigation by default. */
  navigate?: (url: string) => void;
};

/** The real server actions, the default everywhere outside the dev gallery. */
export const SERVER_BILLING_ACTIONS: BillingActions = {
  startCheckout,
  openPortal: openBillingPortal,
  cancelPlan,
  resumePlan,
};

/** Stripe's pages are not ours: leave with a full navigation, not a route push. */
export const leaveForStripe = (url: string) => window.location.assign(url);

/** The navigate an actions bundle asks for, or the full navigation. */
export function navigateOf(actions: BillingActions): (url: string) => void {
  return actions.navigate ?? leaveForStripe;
}
