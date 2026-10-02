"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Crown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { cardClass, eyebrowClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { helpTextClass, iconNudgeRightClass, stubBadgeClass } from "@/components/ui/control-styles";
import { PlanFeatureList } from "@/components/billing/PlanFeatureList";
import { PortalButton } from "@/components/billing/PortalButton";
import { PlanVisual } from "@/components/billing/PlanVisual";
import { navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import { gainsOver, planFeatures } from "@/lib/billing/features";
import { breakEvenCents, monthlyCostCents } from "@/lib/billing/fees";
import { plansHref } from "@/lib/billing/paths";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { BILLING_CURRENCY, PLANS, nextPlanUp, type PaidPlanId } from "@/lib/billing/plans";
import type { ActionError } from "@/lib/errors";

/**
 * Settings › Plan & billing's upsell: not "see plans", but the plan one step
 * up and exactly what it would change for THIS store. The fee drawn from and
 * to, what it would save at the store's own sales over the last 30 days (or,
 * with none yet, where it starts paying for itself), everything it adds, and
 * one button that goes straight to checkout.
 *
 * On the top plan it becomes a summary of what the plan includes instead:
 * the reasons to stay are worth showing too. Owners only: a teammate cannot
 * act on it, so the page shows them the plan and nothing to sell.
 */
export function UpgradeCard({
  context,
  actions,
}: {
  context: PricingContext;
  actions: BillingActions;
}) {
  const target = nextPlanUp(context.plan);
  if (!target) return <TopPlanCard context={context} />;
  return <UpsellCard context={context} target={target} actions={actions} />;
}

function UpsellCard({
  context,
  target,
  actions,
}: {
  context: PricingContext;
  target: PaidPlanId;
  actions: BillingActions;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const [leaving, setLeaving] = React.useState(false);
  const [error, setError] = React.useState<ActionError | null>(null);
  const [, startTransition] = React.useTransition();
  const navigate = navigateOf(actions);

  const current = context.plan;
  const targetName = t(`plans.${target}.name`);
  const wholeMoney = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale, { wholeUnits: true });
  const price = wholeMoney(PLANS[target].priceCents.month);

  // What the step up is worth at this store's own sales: a saving when there
  // is one, and otherwise the figure it starts paying for itself at.
  const sales = context.salesSubtotal30dCents ?? 0;
  const saving = sales > 0 ? monthlyCostCents(current, "month", sales) - monthlyCostCents(target, "month", sales) : 0;
  const breakEven = breakEvenCents(current, target, "month");
  const worth =
    saving > 0
      ? t("upsell.saving", { plan: targetName, amount: formatCents(saving, BILLING_CURRENCY, locale) })
      : breakEven !== null
        ? t("upsell.breakEven", { plan: targetName, amount: wholeMoney(breakEven) })
        : null;

  function upgrade() {
    setError(null);
    setLeaving(true);
    startTransition(async () => {
      const result = await actions.startCheckout({ plan: target, interval: "month", source: "settings" });
      if (result.ok) {
        navigate(result.url);
        return;
      }
      setLeaving(false);
      setError(result.error);
    });
  }

  let cta: React.ReactNode;
  if (!context.available) {
    cta = (
      <Button disabled title={t("page.soonTitle")}>
        {t("upsell.cta", { plan: targetName, price })}
        <span className={stubBadgeClass}>{t("page.soon")}</span>
      </Button>
    );
  } else if (context.hasSubscription) {
    // Already paying: the step up is a switch, confirmed on Stripe's page.
    cta = (
      <div className="w-full max-w-xs">
        <PortalButton
          id="upsell-switch"
          target={{ flow: "switch", plan: target, interval: context.interval ?? "month" }}
          source="settings"
          label={t("card.switch", { plan: targetName })}
          action={actions.openPortal}
          navigate={navigate}
        />
      </div>
    );
  } else {
    cta = (
      <Button className="group/btn" disabled={leaving} onClick={upgrade} data-upsell-cta={target}>
        {leaving ? <Spinner /> : null}
        {leaving ? t("portal.opening") : t("upsell.cta", { plan: targetName, price })}
        {!leaving && <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />}
      </Button>
    );
  }

  return (
    <section
      id="upgrade"
      data-upsell={target}
      aria-labelledby="upsell-title"
      className={cn(cardClass, "group/plan scroll-mt-20 p-6 sm:p-7")}
    >
      <div>
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className={PLANS[target].recommended ? inkBadgeClass : eyebrowClass}>
              {PLANS[target].recommended ? t("upsell.eyebrowBestValue") : t("upsell.eyebrow")}
            </p>
            <h2 id="upsell-title" className="mt-2 text-xl font-semibold text-foreground">
              {t("upsell.title", { plan: targetName })}
            </h2>
            <p className={cn(helpTextClass, "mt-1")}>{t("upsell.lead")}</p>
          </div>
          <PlanVisual plan={target} className="hidden w-48 shrink-0 sm:flex" />
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className={eyebrowClass}>{t("upsell.feeLabel")}</p>
            <p className="mt-2 flex items-center gap-3" data-upsell-fee>
              <span className="text-2xl font-semibold tabular-nums text-muted-foreground line-through">
                {formatFeeRate(PLANS[current].feeBps, locale)}
              </span>
              <ArrowRight className="size-5 text-muted-foreground" strokeWidth={2} aria-hidden />
              <span className="text-4xl font-semibold tabular-nums text-foreground">
                {formatFeeRate(PLANS[target].feeBps, locale)}
              </span>
            </p>
            {worth && (
              <p className="mt-3 font-inter text-sm font-medium text-foreground" data-upsell-worth>
                {worth}
              </p>
            )}
          </div>
          <div>
            <p className={cn(eyebrowClass, "mb-3")}>{t("upsell.gains", { plan: targetName })}</p>
            <PlanFeatureList plan={target} features={gainsOver(current, target)} tone="strong" />
          </div>
        </div>

        {error && <ActionErrorNotice error={error} className="mt-5" />}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {cta}
          <Link href={plansHref("settings")} className={buttonClassName("ghost")}>
            {t("upsell.compare")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** On the top plan: what it includes, so the reasons to stay are in view. */
function TopPlanCard({ context }: { context: PricingContext }) {
  const t = useTranslations("Billing");
  return (
    <section
      id="upgrade"
      data-upsell="top"
      aria-labelledby="top-plan-title"
      className={cn(cardClass, "group/plan p-6 sm:p-7")}
    >
      <div>
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className={cn(eyebrowClass, "flex items-center gap-1.5")}>
              <Crown className="size-3.5" strokeWidth={2} aria-hidden />
              {t("upsell.topEyebrow")}
            </p>
            <h2 id="top-plan-title" className="mt-1 text-xl font-semibold text-foreground">
              {t("upsell.topTitle", { plan: t(`plans.${context.plan}.name`) })}
            </h2>
          </div>
          <PlanVisual plan={context.plan} className="hidden w-48 shrink-0 sm:flex" />
        </div>
        <PlanFeatureList plan={context.plan} features={planFeatures(context.plan)} tone="strong" className="mt-5" />
        <Link href={plansHref("settings")} className={cn(buttonClassName("ghost"), "mt-6")}>
          {t("upsell.compare")}
        </Link>
      </div>
    </section>
  );
}
