import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Overview section scope. Layered on top of appChrome (from the parent
 * (dashboard)/layout.tsx) via nested ExtendMessages. Adds the keys the
 * overview page uniquely needs: dashboard metrics, recent orders, the setup
 * checklist, and the install offer.
 */
export default function DashboardSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="dashboard">{children}</ScopedIntlProvider>;
}
