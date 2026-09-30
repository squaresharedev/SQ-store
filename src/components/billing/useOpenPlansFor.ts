"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { usePricingModal } from "@/components/billing/pricing-modal-context";
import { actionHref, type ActionError } from "@/lib/errors";

/**
 * For a dialog whose create was refused by a plan limit: returns a function
 * that, given the error, opens the plans and says it did (so the dialog closes
 * itself rather than stacking under them). Any other error returns false and
 * is the caller's to show as usual.
 *
 * Inside the dashboard the plans open in place. Outside it (the full-screen
 * sample storefront, which saves nothing to lose) the browser goes to
 * Settings › Plan & billing with the plans open instead.
 */
export function useOpenPlansFor(): (error: ActionError) => boolean {
  const pricing = usePricingModal();
  const router = useRouter();
  return React.useCallback(
    (error: ActionError) => {
      const action = error.action;
      if (error.code !== "plan_limit" || !action || !("pricing" in action)) return false;
      if (pricing) pricing.open({ source: action.pricing });
      else router.push(actionHref(action));
      return true;
    },
    [pricing, router],
  );
}
