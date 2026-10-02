"use client";

import {
  ChartColumn,
  FileSpreadsheet,
  LayoutGrid,
  LifeBuoy,
  Package,
  Percent,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { iconTileClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { formatFeeRate } from "@/lib/billing/format";
import type { PlanFeatureKey } from "@/lib/billing/features";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/** The glyph for each feature, the same wherever a plan is described. */
export const PLAN_FEATURE_ICON: Record<PlanFeatureKey, LucideIcon> = {
  fee: Percent,
  products: Package,
  storefronts: Store,
  teamSeats: Users,
  core: LayoutGrid,
  ordersExport: FileSpreadsheet,
  earlyAccess: Sparkles,
  analyticsExport: ChartColumn,
  prioritySupport: LifeBuoy,
};

/** One feature of one plan as a sentence ("3% fee per sale", "10 storefronts"). */
export function usePlanFeatureLabel(): (plan: PlanId, key: PlanFeatureKey) => string {
  const t = useTranslations("Billing.features");
  const locale = useLocale();
  return (plan, key) => {
    const definition = PLANS[plan];
    switch (key) {
      case "fee":
        return t("fee", { rate: formatFeeRate(definition.feeBps, locale) });
      case "storefronts":
        return definition.limits.storefronts === null
          ? t("storefrontsUnlimited")
          : t("storefronts", { count: definition.limits.storefronts });
      case "teamSeats":
        return definition.limits.teamSeats === null
          ? t("teammatesUnlimited")
          : t("teammates", { count: definition.limits.teamSeats - 1 });
      case "products":
        return definition.limits.products === null
          ? t("productsUnlimited")
          : t("products", { count: definition.limits.products });
      default:
        return t(key);
    }
  };
}

/**
 * A plan's features as an icon list. `tone="strong"` sets the icons in ink
 * tiles (the recommended card, the upsell); the default is quiet.
 */
export function PlanFeatureList({
  plan,
  features,
  tone = "quiet",
  className,
}: {
  plan: PlanId;
  features: readonly PlanFeatureKey[];
  tone?: "quiet" | "strong";
  className?: string;
}) {
  const label = usePlanFeatureLabel();
  return (
    <ul className={cn("space-y-2.5", className)}>
      {features.map((key) => {
        const Icon = PLAN_FEATURE_ICON[key];
        return (
          <li key={key} data-plan-feature={key} className="flex items-start gap-2.5 font-inter text-sm text-foreground">
            <span
              className={cn(
                iconTileClass,
                "size-6",
                tone === "strong" && "bg-primary text-primary-foreground",
              )}
            >
              <Icon className="size-3.5" strokeWidth={2} aria-hidden />
            </span>
            <span className="pt-0.5">{label(plan, key)}</span>
          </li>
        );
      })}
    </ul>
  );
}
