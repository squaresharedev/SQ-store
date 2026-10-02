"use client";

import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cardClass, eyebrowClass, featuredCardClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { helpTextClass, infoTextClass, lastUsedBadgeClass } from "@/components/ui/control-styles";
import { PlanFeatureList } from "@/components/billing/PlanFeatureList";
import { PlanVisual } from "@/components/billing/PlanVisual";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { planCardFeatures } from "@/lib/billing/features";
import { monthlyPriceCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLANS, type BillingInterval, type PlanId } from "@/lib/billing/plans";

/**
 * One plan on the plans page, top to bottom: a shelf of products that grows
 * with the plan (PlanVisual), the name and price, the one action that fits
 * (upgrade, switch, or a quiet "your plan"), then what it adds over the plan
 * below it ("Everything in Free, plus").
 *
 * The recommended plan (PLANS[..].recommended) wears the "Best value" pill
 * and the ink outline, so the eye lands on it first. No tint and no glow:
 * the product photos are the page's only colour. Everything shown is read
 * from the catalog, so a number changed there changes here with no copy to
 * update.
 */
export function PlanCard({
  plan,
  interval,
  current = false,
  children,
}: {
  plan: PlanId;
  interval: BillingInterval;
  /** The store is on this plan now. */
  current?: boolean;
  /** The action, set under the price so the three line up. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const definition = PLANS[plan];
  const recommended = definition.recommended;
  const free = definition.priceCents.month === 0;
  const { below, features } = planCardFeatures(plan);

  return (
    <li
      data-pricing-plan={plan}
      data-recommended={recommended || undefined}
      className={cn(cardClass, "group/plan flex flex-col p-2", recommended && featuredCardClass)}
    >
      <PlanVisual plan={plan} />

      <div className="flex flex-1 flex-col px-4 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">{t(`plans.${plan}.name`)}</h3>
          {recommended && (
            <span className={inkBadgeClass}>
              <Star className="size-3" strokeWidth={2.5} aria-hidden />
              {t("card.bestValue")}
            </span>
          )}
          {/* With an action in the slot (switching billing period), the slot
              cannot say "current", so the header does. Said once either way. */}
          {current && children && <span className={cn(lastUsedBadgeClass, "ml-auto")}>{t("card.current")}</span>}
        </div>
        <p className={cn(helpTextClass, "mt-1 min-h-10")}>{t(`plans.${plan}.tagline`)}</p>

        <p className="mt-4 flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">
            {formatCents(monthlyPriceCents(plan, interval), BILLING_CURRENCY, locale, { wholeUnits: true })}
          </span>
          <span className={helpTextClass}>{t("card.perMonth")}</span>
        </p>
        <p className={cn(infoTextClass, "mt-1 min-h-4")}>
          {free
            ? t("card.freeForever")
            : interval === "year"
              ? t("card.billedYearly", {
                  amount: formatCents(definition.priceCents.year, BILLING_CURRENCY, locale, { wholeUnits: true }),
                })
              : t("card.exclVat")}
        </p>

        {/* Always the same height, so the feature lists below start level. */}
        <div className="mt-5 flex min-h-11 flex-col justify-center">
          {children ??
            (current && (
              <p className={cn(helpTextClass, "rounded-sm border border-dashed border-border py-2.5 text-center")}>
                {t("card.current")}
              </p>
            ))}
        </div>

        <div className="mt-6 border-t border-border pt-5">
          <p className={cn(eyebrowClass, "mb-3")}>
            {below ? t("card.everythingIn", { plan: t(`plans.${below}.name`) }) : t("card.includes")}
          </p>
          <PlanFeatureList plan={plan} features={features} tone={recommended ? "strong" : "quiet"} />
        </div>
      </div>
    </li>
  );
}
