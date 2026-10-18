import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPaymentsOverview } from "@/lib/payments/mock";
import { readFeesThisMonth } from "@/lib/billing/fee-ledger";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { requireUser } from "@/lib/auth/session";
import { PAYMENTS_PATH } from "@/lib/dashboard/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard.metadata.payments");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx. UI-only for now: the data layer in
// lib/payments/mock.ts returns Stripe-shaped mock objects; wiring Stripe
// Connect later swaps those implementations without touching this page.
// SECURITY: nothing on this route collects financial data — connecting and
// managing a payout account happens on Stripe's hosted surfaces (redirect).
// ?mock=<scenario> picks a simulated story, and only while PAYMENTS_MOCK_DATA
// is on (see lib/payments/mock.ts); otherwise it is ignored.

export default async function PaymentsRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ mock?: string | string[] }>;
}) {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(PAYMENTS_PATH);
  const { mock } = await searchParams;
  // What Square Share took this month comes from OUR ledger, not Stripe's:
  // it is the one figure on this page that is about the store's dealings with
  // us. For the active store, which the server has just re-validated. Null
  // (the tile is left out) when it cannot be read.
  const account = await getActiveAccount();
  const [overview, fees] = await Promise.all([
    getPaymentsOverview(Array.isArray(mock) ? mock[0] : mock),
    account && can(account.role, "store.read") ? readFeesThisMonth(account.accountId) : null,
  ]);
  const feesThisMonth = fees?.map(({ currency, netCents }) => ({ currency, amountCents: netCents })) ?? null;
  return <PaymentsPage overview={overview} feesThisMonth={feesThisMonth} />;
}
