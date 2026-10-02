"use client";

import Link from "next/link";
import { Gem } from "lucide-react";
import { useTranslations } from "next-intl";
import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { useAccountPlan } from "@/components/billing/plan-context";
import { plansHref } from "@/lib/billing/paths";
import { cn } from "@/lib/utils";

/**
 * The store's plan at the foot of the dashboard rail, just above Settings:
 * "Plan: Free" with an Upgrade pill, or "Plan: Pro". Leads to the plans page.
 * Renders nothing when the plan could not be read, rather than guessing one.
 */
export function PlanChip({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("Billing");
  const plan = useAccountPlan();
  if (!plan) return null;

  return (
    <Link
      href={plansHref("sidebar")}
      data-plan-chip={plan}
      onClick={onNavigate}
      className={cn(className, "w-full text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      <Gem className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      {t("chip.label", { plan: t(`plans.${plan}.name`) })}
      {plan === "free" && <span className={cn(lastUsedBadgeClass, "ml-auto")}>{t("chip.upgrade")}</span>}
    </Link>
  );
}
