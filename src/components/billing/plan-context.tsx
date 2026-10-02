"use client";

import * as React from "react";
import type { PlanId } from "@/lib/billing/plans";

/**
 * The ACTIVE store's plan, provided once by DashboardShell so the rail's plan
 * chip and the profile menu can name it without each asking the server.
 * Null when it could not be read: those surfaces then show no plan at all
 * rather than a guessed one.
 */
const AccountPlanContext = React.createContext<PlanId | null>(null);

export function AccountPlanProvider({ plan, children }: { plan: PlanId | null; children: React.ReactNode }) {
  return <AccountPlanContext.Provider value={plan}>{children}</AccountPlanContext.Provider>;
}

/** The active store's plan, or null outside a dashboard shell or when unread. */
export function useAccountPlan(): PlanId | null {
  return React.useContext(AccountPlanContext);
}
