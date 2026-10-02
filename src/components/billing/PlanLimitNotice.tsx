"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { cardClass } from "@/components/ui/surface-styles";
import { helpTextClass, iconNudgeRightClass } from "@/components/ui/control-styles";
import { PlanVisual } from "@/components/billing/PlanVisual";
import { cn } from "@/lib/utils";
import { nextPlanUp, type PlanId, type PlanLimitKey } from "@/lib/billing/plans";
import { planLimitReached } from "@/lib/errors";

/**
 * A page's answer when the store's plan has no room for the thing the page
 * creates (a product, on /products/new and /products/import): the limit in
 * the same words the create action would refuse with (planLimitReached), and
 * the way to the plans, shown INSTEAD of a form the server would turn down
 * after it had been filled in.
 *
 * The shelf drawn beside it is the next plan up, the one with more room; on
 * the top plan it is the plan itself. Nothing here is the enforcement: the
 * action and the database trigger are (lib/billing/limits.ts).
 */
export function PlanLimitNotice({
  limitKey,
  plan,
  cap,
  className,
}: {
  limitKey: PlanLimitKey;
  plan: PlanId;
  cap: number;
  className?: string;
}) {
  const resolve = useResolveMessage();
  const error = planLimitReached(limitKey, plan, cap);

  return (
    <section
      role="status"
      data-plan-limit={limitKey}
      className={cn(cardClass, "group/plan flex flex-wrap items-center justify-between gap-6 p-6", className)}
    >
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-lg font-semibold text-foreground">{resolve(error.message)}</h2>
        {error.fix && <p className={cn(helpTextClass, "mt-1")}>{resolve(error.fix)}</p>}
        {error.action && (
          <Link href={error.action.href} className={cn(buttonClassName("primary"), "mt-5")}>
            {resolve(error.action.label)}
            <ArrowUpRight className={cn("size-4", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      <PlanVisual plan={nextPlanUp(plan) ?? plan} className="hidden w-48 shrink-0 sm:flex" />
    </section>
  );
}
