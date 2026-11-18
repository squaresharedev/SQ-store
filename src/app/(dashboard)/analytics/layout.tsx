import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Analytics section scope. Adds the Analytics namespace for the charts and
 * trend tiles on the analytics page.
 */
export default function AnalyticsSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="analytics">{children}</ScopedIntlProvider>;
}
