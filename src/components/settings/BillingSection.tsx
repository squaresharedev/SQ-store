"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PortalButton } from "@/components/billing/PortalButton";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { SERVER_BILLING_ACTIONS, navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import type { CheckoutReturn } from "@/lib/billing/checkout-return";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/paths";
import { BILLING_CURRENCY, PLANS, PLAN_LIMIT_KEYS, isPaidPlan } from "@/lib/billing/plans";

/**
 * Settings › Plan & billing (see app/settings/billing/page.tsx):
 *
 *   Your plan            which plan, what it costs, when it renews or ends,
 *                        and the fee on each sale.
 *   The upgrade          for the owner: the plan one step up and what it
 *                        would change for this store (UpgradeCard); on the top
 *                        plan, what it includes.
 *   What you're using    storefronts and team seats against the plan's caps.
 *   Billing & invoices   the Stripe Customer Portal (owner only, 2FA first).
 *
 * The upgrade is left out while a payment is failing: the one thing worth
 * asking then is a working card, which "Manage billing" is for.
 */
export function BillingSection({
  context,
  returned,
  actions = SERVER_BILLING_ACTIONS,
}: {
  context: PricingContext;
  /** Back from Stripe Checkout, confirmed (or still pending) on the server. */
  returned: CheckoutReturn | null;
  /** The server calls, or stand-ins on /dev/pricing. */
  actions?: BillingActions;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const router = useRouter();
  const { plan, interval, status, priceCents, currency, currentPeriodEnd, cancelAtPeriodEnd, usage, canManage } =
    context;
  const planName = t(`plans.${plan}.name`);
  const paid = isPaidPlan(plan);

  // Back from Stripe Checkout: drop the session id from the address, so a
  // reload does not ask Stripe again, and refresh so the rail's plan chip
  // (rendered by the shell before this page synced) catches up.
  React.useEffect(() => {
    if (!returned) return;
    router.replace(BILLING_SETTINGS_PATH);
  }, [returned, router]);

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

      <SettingsCard id="plan" title={t("settings.planTitle")} description={t("settings.planDescription")}>
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
        {!canManage && <p className={cn(infoTextClass, "mt-3")}>{t("settings.memberNote")}</p>}
      </SettingsCard>

      {canManage && status !== "past_due" && <UpgradeCard context={context} actions={actions} />}

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
          {context.hasBillingAccount && context.available ? (
            <div className="max-w-xs">
              <PortalButton
                id="billing-portal-manage"
                target={{ flow: "manage" }}
                source="settings"
                label={t("settings.manage")}
                variant="secondary"
                action={actions.openPortal}
                navigate={navigateOf(actions)}
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
