import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Discounts section scope. Adds Discounts plus ProductPage.sale because
 * DiscountExample renders "Was X, now Y" in the buyer's own words.
 */
export default function DiscountsSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="discounts">{children}</ScopedIntlProvider>;
}
