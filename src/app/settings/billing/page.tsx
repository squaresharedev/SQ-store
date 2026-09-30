import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BillingSettings } from "@/components/billing/BillingSettings";
import { requireUser } from "@/lib/auth/session";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { billingProvider } from "@/lib/billing/availability";
import { confirmCheckoutReturn, type CheckoutReturn } from "@/lib/billing/checkout-return";
import { countPlanUsage } from "@/lib/billing/limits";
import { BILLING_SETTINGS_PATH, CHECKOUT_SESSION_PARAM } from "@/lib/billing/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.billing");
  return { title: t("title") };
}

/**
 * Settings › Plan & billing: the plan the store is on, what it costs, the fee
 * each sale pays, how much of the plan's limits is used, and the way to its
 * invoices and card (the Stripe Customer Portal).
 *
 * About the ACTIVE store, like the plans themselves: a plan belongs to a store,
 * so a teammate working on someone else's store sees that store's plan, read
 * only. Changing it is the owner's alone (billing.manage), re-checked by every
 * action regardless of what this page renders.
 *
 * Stripe Checkout returns here with `?session_id=`. When it does, the account
 * is synced with Stripe before rendering (lib/billing/checkout-return.ts), so
 * the owner sees their new plan straight away rather than after the webhook.
 */
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser(BILLING_SETTINGS_PATH);
  const account = await getActiveAccount();
  if (!account) return null;
  const canManage = account.isOwner && can(account.role, "billing.manage");

  const sessionId = (await searchParams)[CHECKOUT_SESSION_PARAM];
  let returned: CheckoutReturn | null = null;
  if (canManage && typeof sessionId === "string") {
    returned = await confirmCheckoutReturn(account.accountId, sessionId);
  }

  // Read after any sync above, so the page shows the plan it just confirmed.
  const [billing, storefronts, teamSeats] = await Promise.all([
    readAccountBilling(account.accountId),
    countPlanUsage(account.accountId, "storefronts"),
    countPlanUsage(account.accountId, "teamSeats"),
  ]);
  if (!billing.ok) {
    const t = await getTranslations("Billing.settings");
    return <p className="font-inter text-sm text-destructive">{t("unavailable")}</p>;
  }

  const { billing: b } = billing;
  return (
    <BillingSettings
      plan={b.plan}
      interval={b.interval}
      status={b.status}
      priceCents={b.priceCents}
      currency={b.currency}
      currentPeriodEnd={b.currentPeriodEnd}
      cancelAtPeriodEnd={b.cancelAtPeriodEnd}
      hasBillingAccount={b.customerId !== null}
      usage={{ storefronts, teamSeats }}
      canManage={canManage}
      available={billingProvider() !== null}
      returned={returned}
    />
  );
}
