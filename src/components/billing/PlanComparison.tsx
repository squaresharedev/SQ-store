"use client";

import {
  AppWindow,
  Boxes,
  Check,
  Code,
  CreditCard,
  Download,
  FileUp,
  Minus,
  Palette,
  TrendingUp,
  Truck,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cardClass, eyebrowClass } from "@/components/ui/surface-styles";
import { PLAN_FEATURE_ICON } from "@/components/billing/PlanFeatureList";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import { COMPARE_GROUPS, planHas, type CompareRowKey, type IncludedFeatureKey } from "@/lib/billing/features";
import { monthlyPriceCents } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLANS, PLAN_IDS, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { DIGITAL_FILE_MAX_BYTES } from "@/lib/validation/product";

/** Glyphs for the features every plan includes; the plan features keep the
 *  glyphs they wear on the cards (PLAN_FEATURE_ICON). */
const INCLUDED_ICON: Record<IncludedFeatureKey, LucideIcon> = {
  productPages: AppWindow,
  checkout: CreditCard,
  digitalDownloads: Download,
  stock: Boxes,
  shipping: Truck,
  embed: Code,
  designer: Palette,
  roles: UserCog,
  analytics: TrendingUp,
  productImport: FileUp,
};

const rowIcon = (key: CompareRowKey): LucideIcon =>
  key in INCLUDED_ICON ? INCLUDED_ICON[key as IncludedFeatureKey] : PLAN_FEATURE_ICON[key as keyof typeof PLAN_FEATURE_ICON];

/** The shading of the recommended plan's column, top to bottom. */
const RECOMMENDED_COLUMN_CLASS = "bg-accent";

/**
 * Every plan against every feature, side by side, in sections (selling,
 * your store, tools, support), for the seller who wants the whole picture
 * before choosing. Most rows are ticks on every plan, which is the point:
 * it shows how much Free already includes, and where the paid plans add.
 * The recommended plan's column is shaded. Read from the catalog
 * (lib/billing/features.ts), like the cards: nothing here is typed twice.
 *
 * On a narrow screen the table scrolls sideways inside its own box; the page
 * itself never does.
 */
export function PlanComparison({ interval, currentPlan }: { interval: BillingInterval; currentPlan: PlanId }) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);

  const label = (key: CompareRowKey): string =>
    key === "digitalDownloads"
      ? t("compare.rows.digitalDownloads", { size: formatBytes(DIGITAL_FILE_MAX_BYTES, locale) })
      : t(`compare.rows.${key}`);

  const cell = (plan: PlanId, key: CompareRowKey): React.ReactNode => {
    const definition = PLANS[plan];
    switch (key) {
      case "fee":
        return formatFeeRate(definition.feeBps, locale);
      case "products":
      case "storefronts":
      case "teamSeats":
        return definition.limits[key] === null ? t("compare.unlimited") : number.format(definition.limits[key]);
      default:
        return planHas(plan, key) ? (
          <Check className="mx-auto size-4 text-foreground" strokeWidth={2.5} aria-label={t("compare.included")} />
        ) : (
          <Minus className="mx-auto size-4 text-muted-foreground" strokeWidth={2} aria-label={t("compare.notIncluded")} />
        );
    }
  };

  const columnClass = (plan: PlanId) => cn("px-4 text-center", PLANS[plan].recommended && RECOMMENDED_COLUMN_CLASS);

  return (
    <section aria-labelledby="plans-compare-title" className={cn(cardClass, "p-6 sm:p-8")}>
      <p className={eyebrowClass}>{t("compare.eyebrow")}</p>
      <h2 id="plans-compare-title" className="mt-1 text-xl font-semibold text-foreground">
        {t("compare.title")}
      </h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-xl border-collapse font-inter text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-4 text-left font-medium text-muted-foreground">
                <span className="sr-only">{t("compare.feature")}</span>
              </th>
              {PLAN_IDS.map((plan) => (
                <th
                  key={plan}
                  scope="col"
                  className={cn(columnClass(plan), "rounded-t-md py-3 font-semibold text-foreground")}
                >
                  {t(`plans.${plan}.name`)}
                  {plan === currentPlan && (
                    <span className="block font-normal text-muted-foreground">{t("card.current")}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <th scope="row" className="py-3 pr-4 text-left font-medium text-foreground">
                {t("compare.price")}
              </th>
              {PLAN_IDS.map((plan) => (
                <td key={plan} className={cn(columnClass(plan), "py-3 tabular-nums text-foreground")}>
                  {formatCents(monthlyPriceCents(plan, interval), BILLING_CURRENCY, locale, { wholeUnits: true })}
                  <span className="text-muted-foreground"> {t("card.perMonth")}</span>
                </td>
              ))}
            </tr>
          </tbody>
          {COMPARE_GROUPS.map((group) => (
            <tbody key={group.key} data-compare-group={group.key}>
              <tr>
                <th scope="colgroup" className={cn(eyebrowClass, "pt-6 pb-2 text-left")}>
                  {t(`compare.groups.${group.key}`)}
                </th>
                {PLAN_IDS.map((plan) => (
                  <td key={plan} className={columnClass(plan)} aria-hidden />
                ))}
              </tr>
              {group.rows.map((key) => {
                const Icon = rowIcon(key);
                return (
                  <tr key={key} data-compare-row={key} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                        {label(key)}
                      </span>
                    </th>
                    {PLAN_IDS.map((plan) => (
                      <td key={plan} className={cn(columnClass(plan), "py-3 tabular-nums text-foreground")}>
                        {cell(plan, key)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
