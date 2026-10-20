"use client";

import Link from "next/link";
import { ArrowUpRight, Crown } from "lucide-react";
import { useTranslations } from "next-intl";
import { iconNudgeRightClass } from "@/components/ui/control-styles";
import { useAccountPlan } from "@/components/billing/plan-context";
import { plansHref } from "@/lib/billing/paths";
import { cn } from "@/lib/utils";

/**
 * The plan entry at the foot of the dashboard rail, just above Settings. Below
 * the top plan it is a quiet "Upgrade" with an arrow on the right (no icon on
 * the left, so it asks for nothing); on the top plan it settles into a crown
 * and "Pro plan". Both lead to the plans page. The current plan is still said
 * to screen readers. Renders nothing when the plan could not be read, rather
 * than guessing one.
 */
export function PlanChip({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("Billing");
  const plan = useAccountPlan();
  if (!plan) return null;

  const top = plan === "pro";
  return (
    <Link
      href={plansHref("sidebar")}
      data-plan-chip={plan}
      onClick={onNavigate}
      className={cn(className, "group/btn w-full text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      <span className="sr-only">{t("chip.label", { plan: t(`plans.${plan}.name`) })}. </span>
      {top ? (
        <>
          <Crown className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          {t("chip.pro")}
        </>
      ) : (
        <>
          {t("chip.upgrade")}
          <ArrowUpRight
            className={cn("ml-auto size-4 shrink-0 text-muted-foreground/60 group-hover/btn:text-foreground", iconNudgeRightClass)}
            strokeWidth={1.75}
            aria-hidden
          />
        </>
      )}
    </Link>
  );
}
