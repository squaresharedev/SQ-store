"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SliderField } from "@/components/ui/SliderField";
import { CountUp } from "@/components/ui/CountUp";
import { focusRingClass, helpTextClass, infoTextClass, transitionClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { currencySymbol, formatCents } from "@/lib/format/money";
import { breakEvenCents, cheapestPlanFor, monthlyCostCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLAN_IDS, type BillingInterval, type PlanId } from "@/lib/billing/plans";

/** The slider's range, in whole euros of monthly sales. */
const SALES_MAX_EUROS = 20_000;
const SALES_STEP_EUROS = 50;
/** Where the slider starts for a store with no sales to go on. */
const DEFAULT_SALES_EUROS = 500;

/**
 * "Which plan costs me least?": a monthly sales figure in, the total monthly
 * cost of every plan out (subscription plus per-sale fee), with the cheapest
 * one called out, however cheap that is. Free comes out on top for a small
 * shop, and saying so is the point: a calculator that only ever recommends
 * the dearest plan is an advert, and sellers can tell.
 *
 * Prefilled from the store's own last 30 days of sales when it has any. All
 * the arithmetic is lib/billing/fees.ts, the same the checkout charges with.
 */
export function FeeCalculator({
  interval,
  salesSubtotal30dCents,
}: {
  interval: BillingInterval;
  /** The store's last 30 days of item sales; null or 0 when it has none. */
  salesSubtotal30dCents: number | null;
}) {
  const t = useTranslations("Billing.calculator");
  const tPlans = useTranslations("Billing.plans");
  const locale = useLocale();
  const panelId = React.useId();
  const fromSales = (salesSubtotal30dCents ?? 0) > 0;
  const [open, setOpen] = React.useState(fromSales);
  const [euros, setEuros] = React.useState(() =>
    fromSales
      ? Math.min(SALES_MAX_EUROS, Math.round((salesSubtotal30dCents ?? 0) / 100))
      : DEFAULT_SALES_EUROS,
  );

  const salesCents = euros * 100;
  const cheapest = cheapestPlanFor(salesCents, interval);
  const money = (cents: number) => formatCents(cents, BILLING_CURRENCY, locale);
  const planName = (plan: PlanId) => tPlans(`${plan}.name`);

  // The points where each next plan starts paying for itself.
  const breakEvens = PLAN_IDS.slice(1).flatMap((upper, index) => {
    const lower = PLAN_IDS[index]!;
    const at = breakEvenCents(lower, upper, interval);
    return at === null ? [] : [{ upper, at }];
  });

  return (
    <section className="border-t border-border pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-foreground",
          transitionClass,
          focusRingClass,
        )}
      >
        {t("toggle")}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} data-pricing-calculator className="mt-4 space-y-4">
          <div>
            <SliderField
              id={`${panelId}-sales`}
              label={t("salesLabel")}
              ariaLabel={t("salesAria")}
              value={euros}
              min={0}
              max={SALES_MAX_EUROS}
              step={SALES_STEP_EUROS}
              onChange={setEuros}
              valueText={money(salesCents)}
              unit={currencySymbol(BILLING_CURRENCY, locale)}
            />
            {fromSales && <p className={cn(infoTextClass, "mt-1.5")}>{t("fromYourSales")}</p>}
          </div>

          <ul className="grid gap-2 sm:grid-cols-3">
            {PLAN_IDS.map((plan) => (
              <li
                key={plan}
                data-pricing-cost={plan}
                data-cheapest={plan === cheapest || undefined}
                className={cn(
                  "rounded-sm border px-3 py-2",
                  plan === cheapest ? "border-foreground" : "border-border",
                )}
              >
                <span className={infoTextClass}>{planName(plan)}</span>
                <CountUp
                  className="block text-base font-semibold tabular-nums text-foreground"
                  value={money(monthlyCostCents(plan, interval, salesCents))}
                />
                <span className={infoTextClass}>{t("perMonth")}</span>
              </li>
            ))}
          </ul>

          <p className="font-inter text-sm text-foreground" aria-live="polite">
            {t("cheapest", { sales: money(salesCents), plan: planName(cheapest) })}
          </p>
          <ul className="space-y-1">
            {breakEvens.map(({ upper, at }) => (
              <li key={upper} className={helpTextClass}>
                {t("breakEven", { plan: planName(upper), amount: formatCents(at, BILLING_CURRENCY, locale, { wholeUnits: true }) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
