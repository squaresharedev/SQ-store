"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { AmountField } from "@/components/ui/AmountField";
import { Slider } from "@/components/ui/slider";
import { CountUp } from "@/components/ui/CountUp";
import { cardClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { usePlanPrices } from "@/components/billing/plan-context";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { cheapestPlanFor, directFeeBps, monthlyPriceCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLAN_IDS, type BillingInterval } from "@/lib/billing/plans";
import { feeCents } from "@/lib/pricing";

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
 * "Which plan costs you least?": a month of sales, typed (AmountField) or
 * dragged (the slider under it, the same figure), and one bar per plan, drawn
 * in two parts so the sum explains itself: the plan's price in ink, the fee
 * on those sales in grey. The shortest bar is the cheapest plan, and it wears
 * the pill. It can be Free: a calculator that only ever recommends the
 * dearest plan is an advert, and sellers can tell.
 *
 * Starts on the store's own last 30 days of sales when it has any (silently:
 * it is a starting point, not a claim). All the arithmetic is
 * lib/billing/fees.ts on the plan prices in force, the same the checkout
 * charges with.
 */
export function CostExplorer({
  interval,
  directSales30dCents,
}: {
  interval: BillingInterval;
  /** The store's last 30 days of sales through its own doors (what buyers
   *  paid, delivery included); null or 0 when it has none. */
  directSales30dCents: number | null;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const id = React.useId();
  const prices = usePlanPrices();
  const fromSales = (directSales30dCents ?? 0) > 0;
  const [euros, setEuros] = React.useState(() =>
    fromSales ? Math.min(SALES_MAX_EUROS, Math.round((directSales30dCents ?? 0) / 100)) : DEFAULT_SALES_EUROS,
  );

  const salesCents = euros * 100;
  const cheapest = cheapestPlanFor(prices, salesCents, interval);
  const money = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale);
  const wholeMoney = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale, { wholeUnits: true });

  const costs = PLAN_IDS.map((plan) => {
    const price = monthlyPriceCents(prices, plan, interval);
    const fee = feeCents(salesCents, directFeeBps(prices, plan));
    return { plan, price, fee, total: price + fee };
  });
  // Bars share one scale, so the longest is full width and the rest compare.
  const scale = Math.max(...costs.map(({ total }) => total), 1);
  const width = (cents: number) => `${(cents / scale) * 100}%`;

  return (
    <section aria-labelledby={`${id}-title`} className={cn(cardClass, "p-6 sm:p-8")}>
      <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
        <div className="lg:col-span-2">
          <h2 id={`${id}-title`} className="text-xl font-semibold text-foreground">
            {t("calculator.title")}
          </h2>
          <p className={cn(helpTextClass, "mt-1")}>{t("calculator.lead")}</p>
          <AmountField
            id={`${id}-sales`}
            className="mt-6"
            label={t("calculator.salesLabel")}
            value={euros}
            max={SALES_MAX_EUROS}
            onChange={setEuros}
            currency={BILLING_CURRENCY}
            suffix={t("calculator.perMonth")}
          />
          <div className="mt-4">
            <Slider
              min={0}
              max={SALES_MAX_EUROS}
              step={SALES_STEP_EUROS}
              value={euros}
              onChange={setEuros}
              ariaLabel={t("calculator.salesAria")}
              valueText={money(salesCents)}
            />
            <div className={cn(infoTextClass, "mt-1.5 flex justify-between tabular-nums")} aria-hidden>
              <span>{wholeMoney(0)}</span>
              <span>{wholeMoney(SALES_MAX_EUROS * 100)}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <ul data-pricing-calculator className="space-y-5">
            {costs.map(({ plan, price, fee, total }) => {
              const isCheapest = plan === cheapest;
              return (
                <li key={plan} data-pricing-cost={plan} data-cheapest={isCheapest || undefined}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-inter text-sm font-medium text-foreground">
                      {t(`plans.${plan}.name`)}
                      {isCheapest && <span className={inkBadgeClass}>{t("calculator.cheapestTag")}</span>}
                    </span>
                    {/* The total stays on one line; a narrow column wraps the
                        pill under the plan's name instead. */}
                    <span className="shrink-0 whitespace-nowrap font-inter text-sm">
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

          {/* Not shown: the "Cheapest for you" pill says it to the eye. Kept
              for a screen reader, which cannot see a pill move as the figure
              changes and is told in a sentence instead. */}
          <p className="sr-only" aria-live="polite">
            {t("calculator.cheapest", { sales: wholeMoney(salesCents), plan: t(`plans.${cheapest}.name`) })}
          </p>
        </div>
      </div>
    </section>
  );
}
