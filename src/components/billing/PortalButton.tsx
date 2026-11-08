"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { StepUpField } from "@/components/auth/StepUp";
import { iconNudgeUpRightClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import type { PortalState } from "@/lib/billing/actions";
import type { PricingSource } from "@/lib/billing/paths";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";

/** The Customer Portal flow a button opens (see lib/billing/provider.ts). */
export type PortalButtonFlow =
  | { flow: "manage" }
  | { flow: "switch"; plan: PaidPlanId; interval: BillingInterval };

const INITIAL: PortalState = {};

type PortalFormOptions = {
  target: PortalButtonFlow;
  source?: PricingSource;
  /** openBillingPortal, or a stand-in on /dev/pricing. */
  action: (prev: PortalState, formData: FormData) => Promise<PortalState>;
  navigate: (url: string) => void;
  /** Unique per page: several of these can be mounted at once. */
  id: string;
};

/**
 * Everything a Customer Portal form holds except its button: the action, the
 * hidden fields, the two-factor box and the error. PortalButton puts its own
 * button under them; a card with several ways into the portal (the invoices
 * card's "Update" links) renders the form once and points each button at it
 * with `form=`, so the code is asked for in one place.
 */
export function usePortalForm({ target, source, action, navigate, id }: PortalFormOptions) {
  const t = useTranslations("Billing.portal");
  const resolve = useResolveMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL);

  React.useEffect(() => {
    if (state.url) navigate(state.url);
  }, [state, navigate]);

  const fields = (
    <>
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
    </>
  );

  // Pending until the browser has actually left: Stripe's page can take a
  // moment, and a button that springs back to idle invites a second click.
  return { action: formAction, fields, leaving: pending || Boolean(state.url) };
}

/**
 * One button that opens the Stripe Customer Portal (to switch plan, or manage
 * the card and invoices). Moving back to Free is not here: that is the in-app
 * cancel (CancelPlanButton), which asks why.
 *
 * A FORM, because the server may ask for a two-factor code before it opens
 * someone's billing details: the code box appears above the button and the
 * owner submits again. When the server answers with the portal's URL, the
 * browser goes there (a full navigation: it is Stripe's page, not ours).
 */
export function PortalButton({
  label,
  variant = "primary",
  ...options
}: PortalFormOptions & {
  label: string;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("Billing.portal");
  const { action, fields, leaving } = usePortalForm(options);

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {fields}
      <Button type="submit" variant={variant} disabled={leaving} className="group/btn w-full">
        {leaving ? <Spinner /> : null}
        {leaving ? t("opening") : label}
        {!leaving && <ArrowUpRight className={cn("size-4", iconNudgeUpRightClass)} strokeWidth={2} aria-hidden />}
      </Button>
    </form>
  );
}
