import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPaymentsOverview } from "@/lib/payments/mock";
import { PaymentsPage } from "@/components/payments/PaymentsPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard.metadata.payments");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx. UI-only for now: the data layer in
// lib/payments/mock.ts returns Stripe-shaped mock objects; wiring Stripe
// Connect later swaps those implementations without touching this page.
// SECURITY: nothing on this route collects financial data — connecting and
// managing a payout account happens on Stripe's hosted surfaces (redirect).

export default async function PaymentsRoutePage() {
  const overview = await getPaymentsOverview();
  return <PaymentsPage overview={overview} />;
}
