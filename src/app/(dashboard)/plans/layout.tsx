import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/i18n/ScopedIntlProvider";

/**
 * Plans section scope. Adds the full Billing namespace for the plan picker and
 * portal button, plus Auth.stepUp and Auth.factorPicker because PortalButton
 * mounts a step-up form (via StepUpScope in StepUp.tsx).
 */
export default function PlansSectionLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="plans">{children}</ScopedIntlProvider>;
}
