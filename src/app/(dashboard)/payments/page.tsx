import type { Metadata } from "next";
import { getPaymentsOverview } from "@/lib/payments/mock";
import { PaymentsPage } from "@/components/payments/PaymentsPage";

export const metadata: Metadata = {
  title: "Payments",
};

// PROTECTED by (dashboard)/layout.tsx. UI-only for now: the data layer in
// lib/payments/mock.ts returns Stripe-shaped mock objects; wiring Stripe
// Connect later swaps those implementations without touching this page.
// SECURITY: nothing on this route collects financial data — connecting and
// managing a payout account happens on Stripe's hosted surfaces (redirect).

export default async function PaymentsRoutePage() {
  const overview = await getPaymentsOverview();
  return <PaymentsPage overview={overview} />;
}
