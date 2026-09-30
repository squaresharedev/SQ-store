"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { StepUpField } from "@/components/auth/StepUp";
import { iconNudgeRightClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import type { PortalState } from "@/lib/billing/actions";
import type { PricingSource } from "@/lib/billing/paths";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";

/** The Customer Portal flow a button opens (see lib/billing/provider.ts). */
export type PortalButtonFlow =
  | { flow: "manage" }
  | { flow: "cancel" }
  | { flow: "switch"; plan: PaidPlanId; interval: BillingInterval };

const INITIAL: PortalState = {};

/**
 * One button that opens the Stripe Customer Portal (to switch plan, move back
 * to Free, or manage the card and invoices).
 *
 * A FORM, because the server may ask for a two-factor code before it opens
 * someone's billing details: the code box appears above the button and the
 * owner submits again. When the server answers with the portal's URL, the
 * browser goes there (a full navigation: it is Stripe's page, not ours).
 */
export function PortalButton({
  target,
  source,
  label,
  variant = "primary",
  action,
  navigate,
  id,
}: {
  target: PortalButtonFlow;
  source?: PricingSource;
  label: string;
  variant?: "primary" | "secondary";
  /** openBillingPortal, or a stand-in on /dev/pricing. */
  action: (prev: PortalState, formData: FormData) => Promise<PortalState>;
  navigate: (url: string) => void;
  /** Unique per page: several of these can be mounted at once. */
  id: string;
}) {
  const t = useTranslations("Billing.portal");
  const resolve = useResolveMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);

  React.useEffect(() => {
    if (state.url) navigate(state.url);
  }, [state, navigate]);

  // Pending until the browser has actually left: Stripe's page can take a
  // moment, and a button that springs back to idle invites a second click.
  const leaving = pending || Boolean(state.url);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="flow" value={target.flow} />
      {target.flow === "switch" && (
        <>
          <input type="hidden" name="plan" value={target.plan} />
          <input type="hidden" name="interval" value={target.interval} />
        </>
      )}
      {source && <input type="hidden" name="source" value={source} />}
      <StepUpField id={id} state={state} description={t("stepUp")} />
      {state.error && (
        <p role="alert" className="font-inter text-sm font-medium text-destructive">
          {resolve(state.error.message)}
          {state.error.fix && !state.stepUp && (
            <span className="block font-normal text-destructive/80">{resolve(state.error.fix)}</span>
          )}
        </p>
      )}
      <Button type="submit" variant={variant} disabled={leaving} className="group/btn w-full">
        {leaving ? <Spinner /> : null}
        {leaving ? t("opening") : label}
        {!leaving && <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />}
      </Button>
    </form>
  );
}
