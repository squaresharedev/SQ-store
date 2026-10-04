"use client";

import * as React from "react";
import { Archive, ArrowUpRight, CalendarCheck, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { PageHeader } from "@/components/layout/PageHeader";
import { pageShellClass, savingBadgeClass, savingBadgeOnInkClass } from "@/components/ui/surface-styles";
import { helpTextClass, iconNudgeRightClass, infoTextClass, stubBadgeClass } from "@/components/ui/control-styles";
import { PlanCard } from "@/components/billing/PlanCard";
import { CostExplorer } from "@/components/billing/CostExplorer";
import { PlanComparison } from "@/components/billing/PlanComparison";
import { PlansFaq } from "@/components/billing/PlansFaq";
import { PortalButton } from "@/components/billing/PortalButton";
import { CancelPlanButton } from "@/components/billing/CancelPlanDialog";
import { KeepPlanButton } from "@/components/billing/KeepPlanButton";
import { SERVER_BILLING_ACTIONS, navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { launchDiscountPercent, yearlyFreeMonths } from "@/lib/billing/fees";
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

/** The whole months a year on the yearly price gives away, on every paid
 *  plan: the figure on the Yearly option's green chip. Zero shows no chip. */
const YEARLY_FREE_MONTHS = yearlyFreeMonths();

/** Any plan is on a launch price (shown beside its struck-through regular
 *  price), so the fine print says what that means. */
const HAS_LAUNCH_PRICE = PLAN_IDS.some((plan) => launchDiscountPercent(plan, "month") > 0);

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
 *   on a paid plan   Switch           -> Stripe Customer Portal (2FA first)
 *                    Move to Free     -> the in-app cancel (CancelPlanButton)
 *   plan ending      Keep my plan     -> resumePlan, beside the "ends on" notice
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
            <SegmentedControl
              value={interval}
              onChange={setInterval}
              ariaLabel={t("page.intervalLabel")}
              options={BILLING_INTERVALS.map((value) => ({
                value,
                // What yearly saves rides ON the Yearly choice, in green: a
                // reason to press it, not a note beside the control.
                label:
                  value === "year" && YEARLY_FREE_MONTHS > 0 ? (
                    <>
                      {t("page.year")}
                      <span
                        data-yearly-saving
                        className={cn(interval === "year" ? savingBadgeOnInkClass : savingBadgeClass, "px-1.5 py-0")}
                      >
                        {t("page.yearlyFree", { count: YEARLY_FREE_MONTHS })}
                      </span>
                    </>
                  ) : (
                    t(`page.${value}`)
                  ),
              }))}
            />
          }
        />

        {notice && (
          <div role="status" className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 border-l-2 border-foreground pl-3">
            <p className={helpTextClass}>{notice}</p>
            {/* Ending, not past due: the owner can still change their mind. */}
            {context.canManage && context.cancelAtPeriodEnd && context.status !== "past_due" && isPaidPlan(context.plan) && (
              <KeepPlanButton plan={context.plan} actions={actions} />
            )}
          </div>
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
                actions,
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
      <p className={cn(infoTextClass, "mx-auto max-w-3xl text-center")}>
        {t("page.finePrint")}
        {/* What a struck-through price is, wherever one is shown. */}
        {HAS_LAUNCH_PRICE && <> {t("page.launchNote")}</>}
      </p>
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
  actions,
  navigate,
  t,
}: {
  plan: PlanId;
  context: PricingContext;
  interval: BillingInterval;
  source: PricingSource | null;
  leavingFor: PaidPlanId | null;
  onUpgrade: (plan: PaidPlanId) => void;
  actions: BillingActions;
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

  // On a live paid plan, a switch goes through the Customer Portal, where
  // Stripe shows the proration before anything is charged; going back to Free
  // is the in-app cancel, which asks (optionally) why.
  if (context.hasSubscription) {
    if (!isPaidPlan(plan)) {
      if (context.cancelAtPeriodEnd || !isPaidPlan(context.plan) || !context.currentPeriodEnd) return null;
      return (
        <CancelPlanButton
          plan={context.plan}
          periodEnd={context.currentPeriodEnd}
          actions={actions}
          label={t("card.moveToFree")}
          variant="secondary"
          className="w-full"
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
        action={actions.openPortal}
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
