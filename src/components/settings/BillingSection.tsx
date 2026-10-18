"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CreditCard, Percent, TriangleAlert, Wallet, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatedCheck } from "@/components/ui/animated-check";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PlanWordmark } from "@/components/billing/PlanWordmark";
import { PortalButton } from "@/components/billing/PortalButton";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { UsageMeter } from "@/components/billing/UsageMeter";
import { CancelPlanButton } from "@/components/billing/CancelPlanDialog";
import { KeepPlanButton } from "@/components/billing/KeepPlanButton";
import { PlanPricesProvider } from "@/components/billing/plan-context";
import { SERVER_BILLING_ACTIONS, navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { directFeeBps } from "@/lib/billing/fees";
import { formatFeeRate } from "@/lib/billing/format";
import type { CheckoutReturn } from "@/lib/billing/checkout-return";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/paths";
import { BILLING_CURRENCY, PLANS, PLAN_LIMIT_KEYS, isPaidPlan } from "@/lib/billing/plans";

/** One line of the plan card: a glyph, then the fact. */
function PlanFact({
  icon: Icon,
  emphasis,
  danger,
  children,
}: {
  icon: LucideIcon;
  /** The headline fact (the price): foreground and medium weight. */
  emphasis?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2.5",
        helpTextClass,
        emphasis && "font-medium text-foreground",
        danger && "text-destructive",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * "Your plan": the plan drawn as its name on the left; what it costs and what
 * it does on the right, in two groups: the subscription (price, renewal), then
 * the fee on each sale. Under them the owner's way out of a paid plan, or back
 * into one that is set to end.
 */
export function YourPlanCard({
  context,
  actions = SERVER_BILLING_ACTIONS,
}: {
  context: PricingContext;
  actions?: BillingActions;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { plan, interval, status, priceCents, currency, currentPeriodEnd, cancelAtPeriodEnd, canManage } = context;
  const planName = t(`plans.${plan}.name`);
  const paid = isPaidPlan(plan);

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
    <SettingsCard id="plan" title={t("settings.planTitle")} description={t("settings.planDescription")}>
      {/* The plan drawn as its name on the left; what it costs and what it
          does on the right, in two groups: the subscription (price, renewal),
          then the fee on each sale. */}
      <div data-billing-plan={plan} className="flex flex-col gap-5 sm:flex-row sm:gap-7">
        <PlanWordmark plan={plan} name={planName} className="sm:w-52 sm:shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-4">
          <div className="space-y-2">
            <PlanFact icon={paid ? CreditCard : Wallet} emphasis>
              {paid && priceCents !== null && interval
                ? t("settings.priceLine", {
                    price: formatCents(priceCents, currency ?? BILLING_CURRENCY, locale),
                    interval,
                  })
                : t("settings.freeLine")}
            </PlanFact>
            {renewal && (
              <PlanFact icon={CalendarClock} danger={status === "past_due"}>
                {renewal}
              </PlanFact>
            )}
          </div>
          <div className="border-t border-border pt-4">
            <PlanFact icon={Percent}>
              {/* A waived store is told so: the plan's rate is not what it pays. */}
              {context.feeWaived
                ? t("settings.feeWaivedLine")
                : t("settings.feeLine", { rate: formatFeeRate(directFeeBps(context.prices, plan), locale) })}
            </PlanFact>
          </div>
          {/* The owner's way out, or back: quiet, but always here, never buried. */}
          {canManage && context.available && context.hasSubscription && isPaidPlan(plan) && currentPeriodEnd && (
            <div data-plan-controls>
              {cancelAtPeriodEnd ? (
                <KeepPlanButton plan={plan} actions={actions} />
              ) : (
                <CancelPlanButton
                  plan={plan}
                  periodEnd={currentPeriodEnd}
                  actions={actions}
                  label={t("settings.cancelPlan")}
                />
              )}
            </div>
          )}
          {!canManage && <p className={infoTextClass}>{t("settings.memberNote")}</p>}
        </div>
      </div>
    </SettingsCard>
  );
}

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
 *
 * Every fee and price under it is read from `context.prices`, the plan prices
 * in force in the database.
 */
export function BillingSection(props: BillingSectionProps) {
  return (
    <PlanPricesProvider prices={props.context.prices}>
      <BillingSectionBody {...props} />
    </PlanPricesProvider>
  );
}

type BillingSectionProps = {
  context: PricingContext;
  /** Back from Stripe Checkout, confirmed (or still pending) on the server. */
  returned: CheckoutReturn | null;
  /** The server calls, or stand-ins on /dev/pricing. */
  actions?: BillingActions;
};

function BillingSectionBody({ context, returned, actions = SERVER_BILLING_ACTIONS }: BillingSectionProps) {
  const t = useTranslations("Billing");
  const router = useRouter();
  const { plan, status, usage, canManage } = context;

  // Back from Stripe Checkout: drop the session id from the address, so a
  // reload does not ask Stripe again, and refresh so the rail's plan chip
  // (rendered by the shell before this page synced) catches up.
  React.useEffect(() => {
    if (!returned) return;
    router.replace(BILLING_SETTINGS_PATH);
  }, [returned, router]);

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

      <YourPlanCard context={context} actions={actions} />

      {canManage && status !== "past_due" && <UpgradeCard context={context} actions={actions} />}

      <SettingsCard id="usage" title={t("settings.usageTitle")} description={t("settings.usageDescription")}>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PLAN_LIMIT_KEYS.map((key) => {
            const cap = PLANS[plan].limits[key];
            const used = usage[key];
            if (used === null) return null;
            return (
              <UsageMeter
                key={key}
                kind={key}
                name={t(`compare.rows.${key}`)}
                used={used}
                cap={cap}
                label={
                  cap === null
                    ? t(`settings.usage.${key}Unlimited`, { used })
                    : t(`settings.usage.${key}`, { used, cap })
                }
                ofCap={cap === null ? "∞" : `/ ${cap}`}
                status={
                  cap === null
                    ? t("compare.unlimited")
                    : used > cap
                      ? t("settings.usage.over", { count: used - cap })
                      : used === cap
                        ? t("settings.usage.full")
                        : t("settings.usage.left", { count: cap - used })
                }
              />
            );
          })}
        </ul>
        {PLAN_LIMIT_KEYS.some((key) => {
          const cap = PLANS[plan].limits[key];
          const used = usage[key];
          return cap !== null && used !== null && used > cap;
        }) && (
          <p role="note" data-billing-over-note className={cn(infoTextClass, "mt-4 flex items-start gap-1.5")}>
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{t("settings.overLimit")}</span>
          </p>
        )}
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
