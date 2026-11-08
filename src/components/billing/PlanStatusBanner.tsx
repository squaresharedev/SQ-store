import Link from "@/components/ui/AppLink";
import { ArrowRight, CreditCard } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { bannerActionClass, iconNudgeRightClass } from "@/components/ui/control-styles";
import { bannerStripClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { BILLING_SETTINGS_INVOICES_PATH } from "@/lib/billing/paths";
import { SETTINGS_TEAM_PATH } from "@/lib/team/paths";
import type { PaidPlanId } from "@/lib/billing/plans";

/**
 * A strip across the dashboard while a paid plan's renewal has failed and
 * Stripe is retrying the card: the one billing state a seller has to act on
 * before it costs them (after the grace period the store moves to Free).
 *
 * Nothing is shown for any other state. A cancellation the owner chose is
 * their own decision, stated on the settings page and in the plans, not
 * repeated on every page.
 *
 * Owners get the link to fix it; a teammate, who cannot reach the card, gets
 * the fact and the team page, where the owner to tell is named.
 */
export async function PlanStatusBanner({
  pastDuePlan,
  audience,
}: {
  /** The paid plan whose renewal failed, or null when nothing is wrong. */
  pastDuePlan: PaidPlanId | null;
  audience: "owner" | "member";
}) {
  if (!pastDuePlan) return null;
  const t = await getTranslations("Billing");
  const plan = t(`plans.${pastDuePlan}.name`);
  return (
    <div
      role="note"
      aria-label={t("banner.label")}
      data-plan-banner="past_due"
      className={bannerStripClass}
    >
      <CreditCard className="size-4 shrink-0 text-destructive" strokeWidth={2} aria-hidden />
      <p className="min-w-0 flex-1 font-inter text-foreground">
        {audience === "owner" ? t("banner.pastDue", { plan }) : t("banner.pastDueMember", { plan })}
      </p>
      <Link
        href={audience === "owner" ? BILLING_SETTINGS_INVOICES_PATH : SETTINGS_TEAM_PATH}
        className={bannerActionClass}
      >
        {t(audience === "owner" ? "banner.action" : "banner.seeTeam")}
        <ArrowRight className={cn("size-3.5", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
      </Link>
    </div>
  );
}
