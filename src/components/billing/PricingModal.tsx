"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { skeletonClass } from "@/components/ui/surface-styles";
import {
  helpTextClass,
  iconNudgeRightClass,
  infoTextClass,
  lastUsedBadgeClass,
  stubBadgeClass,
} from "@/components/ui/control-styles";
import { PlanCard } from "@/components/billing/PlanCard";
import { FeeCalculator } from "@/components/billing/FeeCalculator";
import { PortalButton } from "@/components/billing/PortalButton";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import {
  loadPricingContext,
  openBillingPortal,
  startCheckout,
  type CheckoutResult,
  type PortalState,
  type PricingContext,
  type PricingContextResult,
} from "@/lib/billing/actions";
import { cheapestPlanFor, yearlySavingCents } from "@/lib/billing/fees";
import type { PricingSource } from "@/lib/billing/paths";
import {
  BILLING_INTERVALS,
  PLAN_IDS,
  PLANS,
  isPaidPlan,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import { unexpectedError, type ActionError } from "@/lib/errors";

/** The server calls the modal makes. Injectable so /dev/pricing can show
 *  every state without a session, Stripe, or a database. */
export type PricingModalActions = {
  loadContext: (source: PricingSource) => Promise<PricingContextResult>;
  startCheckout: (input: { plan: PaidPlanId; interval: BillingInterval; source: PricingSource }) => Promise<CheckoutResult>;
  openPortal: (prev: PortalState, formData: FormData) => Promise<PortalState>;
  /** Leave for Stripe's page. A full navigation by default. */
  navigate?: (url: string) => void;
};

const SERVER_ACTIONS: PricingModalActions = {
  loadContext: loadPricingContext,
  startCheckout,
  openPortal: openBillingPortal,
};

const leaveFor = (url: string) => window.location.assign(url);

/** Does any paid plan save money by paying yearly? Drives the "2 months free" pill. */
const YEARLY_SAVES = PLAN_IDS.some((plan) => yearlySavingCents(plan) > 0);

/**
 * THE PRICING MODAL: Free, Starter and Pro side by side, what each costs and
 * charges per sale, which one is cheapest for this store, and the one action
 * that fits where the store is now:
 *
 *   on Free          Upgrade          -> Stripe Checkout
 *   on a paid plan   Switch / Free    -> Stripe Customer Portal (2FA first)
 *   a teammate       nothing          -> "only the owner can change the plan"
 *   not set up here  "Soon"           -> the plans, with nothing to press
 *
 * Opened through PricingModalProvider (never directly), with the entry point
 * it came from, which the server records for the funnel.
 */
export function PricingModal({
  source,
  onClose,
  actions = SERVER_ACTIONS,
}: {
  source: PricingSource;
  onClose: () => void;
  actions?: PricingModalActions;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const navigate = actions.navigate ?? leaveFor;
  const [context, setContext] = React.useState<PricingContext | null>(null);
  const [loadError, setLoadError] = React.useState<ActionError | null>(null);
  const [chosenInterval, setChosenInterval] = React.useState<BillingInterval | null>(null);
  const [checkoutError, setCheckoutError] = React.useState<ActionError | null>(null);
  const [leavingFor, setLeavingFor] = React.useState<PaidPlanId | null>(null);
  const [, startTransition] = React.useTransition();

  // Load once per opening. `source` is fixed for the life of the modal (the
  // provider unmounts it on close), so this runs exactly once.
  React.useEffect(() => {
    let live = true;
    actions.loadContext(source).then(
      (result) => {
        if (!live) return;
        if (result.ok) setContext(result.context);
        else setLoadError(result.error);
      },
      (error: unknown) => {
        if (live) setLoadError(unexpectedError(error instanceof Error ? error.message : undefined));
      },
    );
    return () => {
      live = false;
    };
  }, [actions, source]);

  const interval: BillingInterval = chosenInterval ?? context?.interval ?? "month";

  function upgrade(plan: PaidPlanId) {
    setCheckoutError(null);
    setLeavingFor(plan);
    startTransition(async () => {
      const result = await actions.startCheckout({ plan, interval, source });
      if (result.ok) {
        navigate(result.url);
        return;
      }
      setLeavingFor(null);
      setCheckoutError(result.error);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("modal.title")}
      description={t("modal.description")}
      className="sm:max-w-4xl"
      initialFocus="dialog"
    >
      <div data-pricing-source={source} data-pricing-state={context ? "ready" : loadError ? "error" : "loading"}>
        {loadError ? (
          <ActionErrorNotice error={loadError} />
        ) : !context ? (
          <PricingSkeleton label={t("modal.loading")} />
        ) : (
          <PricingBody
            context={context}
            interval={interval}
            onIntervalChange={setChosenInterval}
            renderAction={(plan) =>
              planAction({
                plan,
                context,
                interval,
                source,
                leavingFor,
                onUpgrade: upgrade,
                openPortal: actions.openPortal,
                navigate,
                t,
              })
            }
            notice={statusNotice(context, locale, t)}
            checkoutError={checkoutError}
          />
        )}
      </div>
    </Modal>
  );
}

type Translate = ReturnType<typeof useTranslations<"Billing">>;

/** The layout once the store's context is in: interval, cards, calculator, small print. */
function PricingBody({
  context,
  interval,
  onIntervalChange,
  renderAction,
  notice,
  checkoutError,
}: {
  context: PricingContext;
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
  renderAction: (plan: PlanId) => React.ReactNode;
  notice: string | null;
  checkoutError: ActionError | null;
}) {
  const t = useTranslations("Billing");
  const sales = context.salesSubtotal30dCents ?? 0;
  // With real sales to go on, point at the plan that costs this store least;
  // without, at the catalog's recommendation.
  const pointAt: PlanId =
    sales > 0 ? cheapestPlanFor(sales, interval) : (PLAN_IDS.find((plan) => PLANS[plan].recommended) ?? "free");

  const badgeFor = (plan: PlanId): string | undefined => {
    if (plan === context.plan) return t("modal.current");
    if (plan !== pointAt) return undefined;
    return sales > 0 ? t("modal.cheapest") : t("modal.recommended");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48">
          <SegmentedControl
            value={interval}
            onChange={onIntervalChange}
            ariaLabel={t("modal.intervalLabel")}
            options={BILLING_INTERVALS.map((value) => ({ value, label: t(`modal.${value}`) }))}
          />
        </div>
        {YEARLY_SAVES && <span className={lastUsedBadgeClass}>{t("modal.yearlySaving")}</span>}
      </div>

      {notice && (
        <p role="status" className={cn(helpTextClass, "border-l-2 border-foreground pl-3")}>
          {notice}
        </p>
      )}
      {checkoutError && <ActionErrorNotice error={checkoutError} />}

      <ul className="grid gap-3 sm:grid-cols-3">
        {PLAN_IDS.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            interval={interval}
            badge={badgeFor(plan)}
            emphasised={plan === pointAt && plan !== context.plan}
          >
            {renderAction(plan)}
          </PlanCard>
        ))}
      </ul>

      <FeeCalculator interval={interval} salesSubtotal30dCents={context.salesSubtotal30dCents} />

      <div className="space-y-1 border-t border-border pt-4">
        {!context.canManage && <p className="font-inter text-sm text-foreground">{t("modal.ownerOnly")}</p>}
        <p className={infoTextClass}>{t("modal.finePrint")}</p>
      </div>
    </div>
  );
}

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
  source: PricingSource;
  leavingFor: PaidPlanId | null;
  onUpgrade: (plan: PaidPlanId) => void;
  openPortal: PricingModalActions["openPortal"];
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
      <Button disabled className="w-full" title={t("modal.soonTitle")}>
        {t("modal.upgrade", { plan: name })}
        <span className={stubBadgeClass}>{t("modal.soon")}</span>
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
          id={`pricing-portal-${plan}`}
          target={{ flow: "cancel" }}
          source={source}
          label={t("modal.moveToFree")}
          variant="secondary"
          action={openPortal}
          navigate={navigate}
        />
      );
    }
    return (
      <PortalButton
        id={`pricing-portal-${plan}`}
        target={{ flow: "switch", plan, interval }}
        source={source}
        label={plan === context.plan ? t("modal.switchInterval", { interval }) : t("modal.switch", { plan: name })}
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
      {leaving ? t("portal.opening") : t("modal.upgrade", { plan: name })}
      {!leaving && <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />}
    </Button>
  );
}

/** A line above the cards when the store's plan is ending or its payment failed. */
function statusNotice(context: PricingContext, locale: ReturnType<typeof useLocale>, t: Translate): string | null {
  if (!isPaidPlan(context.plan)) return null;
  const plan = t(`plans.${context.plan}.name`);
  if (context.status === "past_due") return t("modal.pastDue", { plan });
  if (context.cancelAtPeriodEnd && context.currentPeriodEnd) {
    return t("modal.endsOn", { plan, date: formatLongDate(context.currentPeriodEnd, locale) });
  }
  return null;
}

/** Placeholder cards while the store's context loads: the same grid, so
 *  nothing jumps when the real cards arrive. */
function PricingSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3 sm:grid-cols-3">
      {PLAN_IDS.map((plan) => (
        <div key={plan} className={cn(skeletonClass, "h-72")} />
      ))}
    </div>
  );
}
