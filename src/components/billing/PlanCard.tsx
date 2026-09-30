"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cardClass, flaggedSurfaceClass } from "@/components/ui/surface-styles";
import { helpTextClass, infoTextClass, lastUsedBadgeClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import { monthlyPriceCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLANS, type BillingInterval, type PlanId } from "@/lib/billing/plans";

/**
 * One plan in the pricing modal: its price, the fee it charges per sale, what
 * it allows, and a slot for the action (upgrade, switch, or nothing).
 *
 * Everything shown is read from the catalog (lib/billing/plans.ts), so a
 * number changed there changes here with no copy to update.
 */
export function PlanCard({
  plan,
  interval,
  badge,
  emphasised = false,
  children,
}: {
  plan: PlanId;
  interval: BillingInterval;
  /** A pill beside the name: "Current plan", "Recommended", "Cheapest for you". */
  badge?: string;
  /** Drawn with the ink ring, for the one plan the modal points at. */
  emphasised?: boolean;
  /** The action, pinned to the card's foot so the three line up. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const definition = PLANS[plan];
  const free = definition.priceCents.month === 0;
  const perMonth = monthlyPriceCents(plan, interval);
  const { storefronts, teamSeats } = definition.limits;

  const features = [
    storefronts === null ? t("card.storefrontsUnlimited") : t("card.storefronts", { count: storefronts }),
    teamSeats === null ? t("card.teammatesUnlimited") : t("card.teammates", { count: teamSeats - 1 }),
    t("card.everything"),
  ];

  return (
    <li
      data-pricing-plan={plan}
      className={cn(cardClass, "flex flex-col p-5", emphasised && flaggedSurfaceClass)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{t(`plans.${plan}.name`)}</h3>
        {badge && <span className={lastUsedBadgeClass}>{badge}</span>}
      </div>
      <p className={cn(helpTextClass, "mt-1")}>{t(`plans.${plan}.tagline`)}</p>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums text-foreground">
          {formatCents(perMonth, BILLING_CURRENCY, locale, { wholeUnits: true })}
        </span>
        <span className={helpTextClass}>{t("card.perMonth")}</span>
      </p>
      <p className={cn(infoTextClass, "mt-0.5 min-h-4")}>
        {free
          ? t("card.freeForever")
          : interval === "year"
            ? t("card.billedYearly", {
                amount: formatCents(definition.priceCents.year, BILLING_CURRENCY, locale, { wholeUnits: true }),
              })
            : t("card.exclVat")}
      </p>

      <p className="mt-4 font-inter text-sm font-semibold text-foreground">
        {t("card.feePerSale", { rate: formatFeeRate(definition.feeBps, locale) })}
      </p>

      <ul className="mt-3 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2 font-inter text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={2} aria-hidden />
            {feature}
          </li>
        ))}
      </ul>

      {children && <div className="mt-auto pt-5">{children}</div>}
    </li>
  );
}
