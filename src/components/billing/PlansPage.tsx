"use client";

import * as React from "react";
import { Archive, ArrowUpRight, CalendarCheck, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { PageHeader } from "@/components/layout/PageHeader";
import { pageShellClass } from "@/components/ui/surface-styles";
import {
  helpTextClass,
  iconNudgeRightClass,
  infoTextClass,
  lastUsedBadgeClass,
  stubBadgeClass,
} from "@/components/ui/control-styles";
import { PlanCard } from "@/components/billing/PlanCard";
import { CostExplorer } from "@/components/billing/CostExplorer";
import { PlanComparison } from "@/components/billing/PlanComparison";
import { PlansFaq } from "@/components/billing/PlansFaq";
import { PortalButton } from "@/components/billing/PortalButton";
import { SERVER_BILLING_ACTIONS, navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { yearlySavingCents } from "@/lib/billing/fees";
import type { PricingSource } from "@/lib/billing/paths";
import {
  BILLING_INTERVALS,
  PLAN_IDS,
  isPaidPlan,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import type { ActionError } from "@/lib/errors";

/** Does any plan save money by paying yearly? Drives the "2 months free" pill. */
const YEARLY_SAVES = PLAN_IDS.some((plan) => yearlySavingCents(plan) > 0);

/** The promises under the headline, each with its glyph. */
const TRUST = [
  { key: "secure", icon: ShieldCheck },
  { key: "cancel", icon: CalendarCheck },
  { key: "keep", icon: Archive },
] as const;

/**
 * THE PLANS PAGE: Free, Starter and Pro, what each costs and adds, what each
 * would cost THIS store at its own sales, and every question in the way of
 * the Upgrade button. Each card carries the one action that fits where the
 * store is now:
 *
 *   on Free          Upgrade          -> Stripe Checkout
 *   on a paid plan   Switch / Free    -> Stripe Customer Portal (2FA first)
 *   a teammate       nothing          -> "only the owner can change the plan"
 *   not set up here  "Soon"           -> the plans, with nothing to press
 */
export function PlansPage({
  context,
  source,
  actions = SERVER_BILLING_ACTIONS,
}: {
  context: PricingContext;
  /** Where the seller came from (?from=), passed on to checkout for the funnel. */
  source: PricingSource | null;
  actions?: BillingActions;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const navigate = navigateOf(actions);
  const [interval, setInterval] = React.useState<BillingInterval>(context.interval ?? "month");
  const [checkoutError, setCheckoutError] = React.useState<ActionError | null>(null);
  const [leavingFor, setLeavingFor] = React.useState<PaidPlanId | null>(null);
  const [, startTransition] = React.useTransition();

  function upgrade(plan: PaidPlanId) {
    setCheckoutError(null);
    setLeavingFor(plan);
    startTransition(async () => {
      const result = await actions.startCheckout({ plan, interval, source: source ?? undefined });
      if (result.ok) {
        navigate(result.url);
        return;
      }
      setLeavingFor(null);
      setCheckoutError(result.error);
    });
  }

  const notice = statusNotice(context, t, locale);

  return (
    <div className={cn(pageShellClass, "space-y-10")} data-plans-page data-plans-source={source ?? undefined}>
      <div className="space-y-6">
        <PageHeader
          title={t("page.title")}
          subtitle={t("page.lead")}
          action={
            <div className="flex flex-wrap items-center gap-3">
              {YEARLY_SAVES && <span className={lastUsedBadgeClass}>{t("page.yearlySaving")}</span>}
              <div className="w-56">
                <SegmentedControl
                  value={interval}
                  onChange={setInterval}
                  ariaLabel={t("page.intervalLabel")}
                  options={BILLING_INTERVALS.map((value) => ({ value, label: t(`page.${value}`) }))}
                />
              </div>
            </div>
          }
        />

        {notice && (
          <p role="status" className={cn(helpTextClass, "mx-auto max-w-2xl border-l-2 border-foreground pl-3")}>
            {notice}
          </p>
        )}
        {!context.canManage && (
          <p role="note" className={cn(helpTextClass, "text-center")}>
            {t("page.ownerOnly")}
          </p>
        )}
        {checkoutError && <ActionErrorNotice error={checkoutError} className="mx-auto max-w-2xl" />}

        <ul className="grid items-stretch gap-4 lg:grid-cols-3">
          {PLAN_IDS.map((plan) => (
            <PlanCard key={plan} plan={plan} interval={interval} current={plan === context.plan}>
              {planAction({
                plan,
                context,
                interval,
                source,
                leavingFor,
                onUpgrade: upgrade,
                openPortal: actions.openPortal,
                navigate,
                t,
              })}
            </PlanCard>
          ))}
        </ul>

        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {TRUST.map(({ key, icon: Icon }) => (
            <li key={key} className={cn(helpTextClass, "flex items-center gap-1.5")}>
              <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              {t(`page.trust.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <CostExplorer interval={interval} salesSubtotal30dCents={context.salesSubtotal30dCents} />
      <PlanComparison interval={interval} currentPlan={context.plan} />
      <PlansFaq />
      <p className={cn(infoTextClass, "mx-auto max-w-3xl text-center")}>{t("page.finePrint")}</p>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"Billing">>;

/** The one action a plan's card offers the viewer, or nothing. */
function planAction({
  plan,
  context,
  interval,
  source,
  leavingFor,
  onUpgrade,
  openPortal,
  navigate,
  t,
}: {
  plan: PlanId;
  context: PricingContext;
  interval: BillingInterval;
  source: PricingSource | null;
  leavingFor: PaidPlanId | null;
  onUpgrade: (plan: PaidPlanId) => void;
  openPortal: BillingActions["openPortal"];
  navigate: (url: string) => void;
  t: Translate;
}): React.ReactNode {
  if (!context.canManage) return null;
  const name = t(`plans.${plan}.name`);
  const sameInterval = context.interval === null || context.interval === interval;
  if (plan === context.plan && (!isPaidPlan(plan) || !context.hasSubscription || sameInterval)) return null;

  if (!context.available) {
    if (!isPaidPlan(plan)) return null;
    return (
      <Button disabled className="w-full" title={t("page.soonTitle")}>
        {t("card.upgrade", { plan: name })}
        <span className={stubBadgeClass}>{t("page.soon")}</span>
      </Button>
    );
  }

  // On a live paid plan, every change goes through the Customer Portal, where
  // Stripe shows the proration before anything is charged.
  if (context.hasSubscription) {
    if (!isPaidPlan(plan)) {
      if (context.cancelAtPeriodEnd) return null;
      return (
        <PortalButton
          id={`plans-portal-${plan}`}
          target={{ flow: "cancel" }}
          source={source ?? undefined}
          label={t("card.moveToFree")}
          variant="secondary"
          action={openPortal}
          navigate={navigate}
        />
      );
    }
    return (
      <PortalButton
        id={`plans-portal-${plan}`}
        target={{ flow: "switch", plan, interval }}
        source={source ?? undefined}
        label={plan === context.plan ? t("card.switchInterval", { interval }) : t("card.switch", { plan: name })}
        variant={plan === context.plan ? "secondary" : "primary"}
        action={openPortal}
        navigate={navigate}
      />
    );
  }

  if (!isPaidPlan(plan)) return null;
  const leaving = leavingFor === plan;
  return (
    <Button
      className="group/btn w-full"
      disabled={leavingFor !== null}
      onClick={() => onUpgrade(plan)}
      data-pricing-upgrade={plan}
    >
      {leaving ? <Spinner /> : null}
      {leaving ? t("portal.opening") : t("card.upgrade", { plan: name })}
      {!leaving && <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />}
    </Button>
  );
}

/** A line over the cards when the store's plan is ending or its payment failed. */
function statusNotice(context: PricingContext, t: Translate, locale: ReturnType<typeof useLocale>): string | null {
  if (!isPaidPlan(context.plan)) return null;
  const plan = t(`plans.${context.plan}.name`);
  if (context.status === "past_due") return t("page.pastDue", { plan });
  if (context.cancelAtPeriodEnd && context.currentPeriodEnd) {
    return t("page.endsOn", { plan, date: formatLongDate(context.currentPeriodEnd, locale) });
  }
  return null;
}
