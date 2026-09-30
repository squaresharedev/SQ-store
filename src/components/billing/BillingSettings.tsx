"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PortalButton } from "@/components/billing/PortalButton";
import { usePricingModal } from "@/components/billing/pricing-modal-context";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import { openBillingPortal, type PortalState } from "@/lib/billing/actions";
import type { CheckoutReturn } from "@/lib/billing/checkout-return";
import type { SubscriptionStatus } from "@/lib/billing/entitlement";
import { BILLING_SETTINGS_PATH, pricingHref } from "@/lib/billing/paths";
import {
  BILLING_CURRENCY,
  PLANS,
  PLAN_LIMIT_KEYS,
  isPaidPlan,
  type BillingInterval,
  type PlanId,
  type PlanLimitKey,
} from "@/lib/billing/plans";

const leaveFor = (url: string) => window.location.assign(url);

/**
 * Settings › Plan & billing (see app/settings/billing/page.tsx): three cards.
 *
 *   Your plan            which plan, what it costs, when it renews or ends,
 *                        the fee on each sale, and "Change plan".
 *   What you're using    storefronts and team seats against the plan's caps.
 *   Billing & invoices   the Stripe Customer Portal (owner only, 2FA first).
 */
export function BillingSettings({
  plan,
  interval,
  status,
  priceCents,
  currency,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  hasBillingAccount,
  usage,
  canManage,
  available,
  returned,
  portalAction = openBillingPortal,
  navigate = leaveFor,
}: {
  plan: PlanId;
  interval: BillingInterval | null;
  status: SubscriptionStatus | "none";
  priceCents: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasBillingAccount: boolean;
  usage: Record<PlanLimitKey, number | null>;
  canManage: boolean;
  available: boolean;
  returned: CheckoutReturn | null;
  /** openBillingPortal, or a stand-in on /dev/pricing. */
  portalAction?: (prev: PortalState, formData: FormData) => Promise<PortalState>;
  /** Leave for Stripe's page; a full navigation by default. */
  navigate?: (url: string) => void;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const router = useRouter();
  const pricing = usePricingModal();
  const planName = t(`plans.${plan}.name`);
  const paid = isPaidPlan(plan);

  // Back from Stripe Checkout: drop the session id from the address, so a
  // reload does not ask Stripe again, and refresh so the rail's plan chip
  // (rendered by the shell before this page synced) catches up.
  React.useEffect(() => {
    if (!returned) return;
    router.replace(BILLING_SETTINGS_PATH);
  }, [returned, router]);

  const openPlans = () => {
    if (pricing) pricing.open({ source: "settings" });
    else router.push(pricingHref("settings"));
  };

  const renewal = !paid
    ? null
    : status === "past_due"
      ? t("settings.pastDue", { plan: planName })
      : currentPeriodEnd && cancelAtPeriodEnd
        ? t("settings.ends", { date: formatLongDate(currentPeriodEnd, locale) })
        : currentPeriodEnd
          ? t("settings.renews", { date: formatLongDate(currentPeriodEnd, locale) })
          : null;

  return (
    <div className="space-y-6">
      {returned && (
        <p
          role="status"
          data-billing-return={returned.kind}
          className={cn("flex items-center gap-2 font-inter text-sm", returned.kind === "confirmed" ? "text-foreground" : "text-muted-foreground")}
        >
          {returned.kind === "confirmed" && <AnimatedCheck className="size-5 text-success" />}
          {returned.kind === "confirmed"
            ? t("settings.confirmed", { plan: t(`plans.${returned.plan}.name`) })
            : t("settings.pending")}
        </p>
      )}

      <SettingsCard id="plan" title={t("settings.planTitle")} description={t("settings.planDescription")} decoration="glow">
        <div data-billing-plan={plan} className="space-y-1">
          <p className="text-2xl font-semibold text-foreground">{planName}</p>
          <p className={helpTextClass}>
            {paid && priceCents !== null && interval
              ? t("settings.priceLine", {
                  price: formatCents(priceCents, currency ?? BILLING_CURRENCY, locale),
                  interval,
                })
              : t("settings.freeLine")}
          </p>
          {renewal && <p className={cn(helpTextClass, status === "past_due" && "text-destructive")}>{renewal}</p>}
          <p className={helpTextClass}>{t("settings.feeLine", { rate: formatFeeRate(PLANS[plan].feeBps, locale) })}</p>
        </div>
        <div className="mt-5">
          <Button variant={paid ? "secondary" : "primary"} onClick={openPlans}>
            {paid ? t("settings.changePlan") : t("settings.seePlans")}
          </Button>
        </div>
        {!canManage && <p className={cn(infoTextClass, "mt-3")}>{t("settings.memberNote")}</p>}
      </SettingsCard>

      <SettingsCard id="usage" title={t("settings.usageTitle")} description={t("settings.usageDescription")}>
        <ul className="space-y-2">
          {PLAN_LIMIT_KEYS.map((key) => {
            const cap = PLANS[plan].limits[key];
            const used = usage[key];
            if (used === null) return null;
            const over = cap !== null && used > cap;
            return (
              <li key={key} data-billing-usage={key} className="font-inter text-sm text-foreground">
                {cap === null
                  ? t(`settings.usage.${key}Unlimited`, { used })
                  : t(`settings.usage.${key}`, { used, cap })}
                {over && <span className={cn(infoTextClass, "block")}>{t("settings.overLimit")}</span>}
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      {canManage && (
        <SettingsCard id="invoices" title={t("settings.invoicesTitle")} description={t("settings.invoicesDescription")}>
          {hasBillingAccount && available ? (
            <div className="max-w-xs">
              <PortalButton
                id="billing-portal-manage"
                target={{ flow: "manage" }}
                source="settings"
                label={t("settings.manage")}
                variant="secondary"
                action={portalAction}
                navigate={navigate}
              />
            </div>
          ) : (
            <p className={helpTextClass}>{t("settings.noBilling")}</p>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
