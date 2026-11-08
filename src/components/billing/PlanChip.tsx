"use client";

import type { FocusEvent } from "react";
import Link from "@/components/ui/AppLink";
import { useTranslations } from "next-intl";
import { ArrowLoopIcon, useArrowLoop } from "@/components/ui/action-icons";
import { useAccountPlan } from "@/components/billing/plan-context";
import { plansHref } from "@/lib/billing/paths";
import { nextPlanUp } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * The plan entry at the foot of the dashboard rail, just above Settings: a light
 * grey pill saying "Upgrade to {next plan}" plus a black disc on the right whose
 * arrow loops out of the disc's top-right corner and back in from the bottom-left
 * on hover (once per hover; leaving never rewinds it). The shape was picked in
 * /dev/plan-chip-lab. It leads to the plans page. The current plan is also said
 * to screen readers. Renders nothing on the top plan (there is nothing to
 * upgrade to) and when the plan could not be read, rather than guessing one.
 */
export function PlanChip({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("Billing");
  const plan = useAccountPlan();
  const [loopScope, playLoop] = useArrowLoop();
  const next = plan ? nextPlanUp(plan) : null;
  if (!plan || !next) return null;

  // Keyboard focus loops the arrow too; the focus a mouse click gives does not,
  // or the hover's loop would play again on the way to the plans page.
  const loopOnKeyboardFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    if (event.currentTarget.matches(":focus-visible")) playLoop();
  };

  return (
    <Link
      href={plansHref("sidebar")}
      data-plan-chip={plan}
      onClick={onNavigate}
      onMouseEnter={playLoop}
      onFocus={loopOnKeyboardFocus}
      // A pill from the rail's edge that stops 12px short of the other items
      // (the label needs the width: "Upgrade to Starter" fits the 256px rail).
      className={cn(className, "mr-3 rounded-full bg-muted py-1.5 pr-1 text-foreground hover:bg-border")}
    >
      <span className="sr-only">{t("chip.label", { plan: t(`plans.${plan}.name`) })}. </span>
      {/* An empty icon slot, so the label starts where the labels of the items
          around it (Settings below) start, not under their icons. */}
      <span aria-hidden className="size-5 shrink-0" />
      <span className="min-w-0 truncate">{t("card.upgrade", { plan: t(`plans.${next}.name`) })}</span>
      <span aria-hidden className="ml-auto flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground text-background">
        <ArrowLoopIcon scope={loopScope} className="size-3.5" strokeWidth={2.25} />
      </span>
    </Link>
  );
}
