"use client";

import { Gem } from "lucide-react";
import { useTranslations } from "next-intl";
import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { usePricingModal } from "@/components/billing/pricing-modal-context";
import { cn } from "@/lib/utils";

/**
 * The store's plan at the foot of the dashboard rail, just above Settings:
 * "Plan: Free" with an Upgrade pill, or "Plan: Pro". Pressing it opens the
 * plans in place. Renders nothing when the plan could not be read, rather
 * than guessing one.
 */
export function PlanChip({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const t = useTranslations("Billing");
  const pricing = usePricingModal();
  if (!pricing?.plan) return null;
  const { plan } = pricing;

  return (
    <button
      type="button"
      data-plan-chip={plan}
      onClick={() => {
        onOpen?.();
        pricing.open({ source: "sidebar" });
      }}
      className={cn(className, "w-full text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      <Gem className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      {t("chip.label", { plan: t(`plans.${plan}.name`) })}
      {plan === "free" && <span className={cn(lastUsedBadgeClass, "ml-auto")}>{t("chip.upgrade")}</span>}
    </button>
  );
}
