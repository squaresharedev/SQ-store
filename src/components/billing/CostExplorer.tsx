"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { SliderField } from "@/components/ui/SliderField";
import { CountUp } from "@/components/ui/CountUp";
import { cardClass, eyebrowClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { currencySymbol, formatCents } from "@/lib/format/money";
import { cheapestPlanFor, monthlyPriceCents, platformFeeCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLANS, PLAN_IDS, type BillingInterval } from "@/lib/billing/plans";

/** The slider's range and step, in whole euros of monthly sales. */
const SALES_MAX_EUROS = 10_000;
const SALES_STEP_EUROS = 50;
/** Where the slider starts for a store with no sales to go on. */
const DEFAULT_SALES_EUROS = 1_000;

/** The two parts of every bar, in the order they are drawn. */
const BAR_PART_CLASS = {
  price: "bg-foreground",
  fee: "bg-muted-foreground/40",
} as const;

/**
 * "Which plan costs you least?": one slider (a month of sales) and one bar
 * per plan, drawn in two parts so the sum explains itself: the plan's price
 * in ink, the fee on those sales in grey. The shortest bar is the cheapest
 * plan, and it is named. It names Free when Free is cheapest: a calculator
 * that only ever recommends the dearest plan is an advert, and sellers can
 * tell.
 *
 * Prefilled from the store's own last 30 days of sales when it has any. All
 * the arithmetic is lib/billing/fees.ts, the same the checkout charges with.
 */
export function CostExplorer({
  interval,
  salesSubtotal30dCents,
}: {
  interval: BillingInterval;
  /** The store's last 30 days of item sales; null or 0 when it has none. */
  salesSubtotal30dCents: number | null;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const id = React.useId();
  const fromSales = (salesSubtotal30dCents ?? 0) > 0;
  const [euros, setEuros] = React.useState(() =>
    fromSales ? Math.min(SALES_MAX_EUROS, Math.round((salesSubtotal30dCents ?? 0) / 100)) : DEFAULT_SALES_EUROS,
  );

  const salesCents = euros * 100;
  const cheapest = cheapestPlanFor(salesCents, interval);
  const money = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale);
  const wholeMoney = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale, { wholeUnits: true });

  const costs = PLAN_IDS.map((plan) => {
    const price = monthlyPriceCents(plan, interval);
    const fee = platformFeeCents(salesCents, PLANS[plan].feeBps);
    return { plan, price, fee, total: price + fee };
  });
  // Bars share one scale, so the longest is full width and the rest compare.
  const scale = Math.max(...costs.map(({ total }) => total), 1);
  const width = (cents: number) => `${(cents / scale) * 100}%`;

  return (
    <section aria-labelledby={`${id}-title`} className={cn(cardClass, "p-6 sm:p-8")}>
      <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
        <div className="lg:col-span-2">
          <p className={eyebrowClass}>{t("calculator.eyebrow")}</p>
          <h2 id={`${id}-title`} className="mt-1 text-xl font-semibold text-foreground">
            {t("calculator.title")}
          </h2>
          <p className={cn(helpTextClass, "mt-1")}>{t("calculator.lead")}</p>
          <div className="mt-6">
            <SliderField
              id={`${id}-sales`}
              label={t("calculator.salesLabel")}
              ariaLabel={t("calculator.salesAria")}
              value={euros}
              min={0}
              max={SALES_MAX_EUROS}
              step={SALES_STEP_EUROS}
              onChange={setEuros}
              valueText={money(salesCents)}
              unit={currencySymbol(BILLING_CURRENCY, locale)}
            />
            {fromSales && <p className={cn(infoTextClass, "mt-1.5")}>{t("calculator.fromYourSales")}</p>}
          </div>
        </div>

        <div className="lg:col-span-3">
          <ul data-pricing-calculator className="space-y-5">
            {costs.map(({ plan, price, fee, total }) => {
              const isCheapest = plan === cheapest;
              return (
                <li key={plan} data-pricing-cost={plan} data-cheapest={isCheapest || undefined}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-inter text-sm font-medium text-foreground">
                      {t(`plans.${plan}.name`)}
                      {isCheapest && <span className={inkBadgeClass}>{t("calculator.cheapestTag")}</span>}
                    </span>
                    <span className="font-inter text-sm">
                      <CountUp
                        className={cn("tabular-nums text-foreground", isCheapest ? "font-semibold" : "font-medium")}
                        value={money(total)}
                      />
                      <span className="text-muted-foreground"> {t("calculator.perMonth")}</span>
                    </span>
                  </div>
                  <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-secondary" aria-hidden>
                    <span
                      className={cn(BAR_PART_CLASS.price, "h-full transition-[width] duration-slow ease-standard motion-reduce:transition-none")}
                      style={{ width: width(price) }}
                    />
                    <span
                      className={cn(BAR_PART_CLASS.fee, "h-full transition-[width] duration-slow ease-standard motion-reduce:transition-none")}
                      style={{ width: width(fee) }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className={cn(infoTextClass, "mt-4 flex flex-wrap items-center gap-x-5 gap-y-1")} aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn(BAR_PART_CLASS.price, "size-2.5 rounded-full")} />
              {t("calculator.legendPrice")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn(BAR_PART_CLASS.fee, "size-2.5 rounded-full")} />
              {t("calculator.legendFee")}
            </span>
          </div>

          <p className="mt-5 font-inter text-sm font-medium text-foreground" aria-live="polite">
            {t("calculator.cheapest", { sales: wholeMoney(salesCents), plan: t(`plans.${cheapest}.name`) })}
          </p>
        </div>
      </div>
    </section>
  );
}
