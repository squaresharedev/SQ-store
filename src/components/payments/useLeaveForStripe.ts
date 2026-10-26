"use client";

import { useTransition } from "react";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { leaveForStripe } from "@/components/billing/billing-actions";
import type { ConnectStripeResult } from "@/lib/payments/connect/actions";

/**
 * Ask the server for a link into one of Stripe's hosted pages and go there.
 * Every Stripe button on /payments is this one call: a failure is a toast,
 * success leaves the app. Returns the action and whether it is under way.
 */
export function useLeaveForStripe(start: () => Promise<ConnectStripeResult>) {
  const raise = useActionErrorToast();
  const [leaving, startLeaving] = useTransition();
  const leave = () =>
    startLeaving(async () => {
      const result = await start();
      if (!result.ok) return raise(result.error);
      leaveForStripe(result.url);
    });
  return [leave, leaving] as const;
}
