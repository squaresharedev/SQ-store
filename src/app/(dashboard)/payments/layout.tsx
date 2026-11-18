import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Payments section scope. Adds the Payments namespace for the earnings chart,
 * balance summary, payout history, and Stripe connection UI.
 */
export default function PaymentsSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="payments">{children}</ScopedIntlProvider>;
}
