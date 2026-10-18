"use client";

import * as React from "react";
import type { PlanPrices } from "@/lib/billing/fees";
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

/**
 * THE PLAN PRICES IN FORCE (plan_prices, read by the server in
 * lib/billing/catalog.ts), provided once by whichever page describes plans
 * (the plans page, Settings > Plan & billing) so every card, table and
 * calculator under it reads its prices and fees from the same rows.
 *
 * There is no default on purpose: a plan drawn outside a provider would have
 * to show a price from somewhere other than the database.
 */
const PlanPricesContext = React.createContext<PlanPrices | null>(null);

export function PlanPricesProvider({ prices, children }: { prices: PlanPrices; children: React.ReactNode }) {
  return <PlanPricesContext.Provider value={prices}>{children}</PlanPricesContext.Provider>;
}

/** The plan prices in force. Throws outside a PlanPricesProvider. */
export function usePlanPrices(): PlanPrices {
  const prices = React.useContext(PlanPricesContext);
  if (!prices) throw new Error("usePlanPrices needs a PlanPricesProvider above it");
  return prices;
}
