"use client";

import * as React from "react";
import type { PricingSource } from "@/lib/billing/paths";
import type { PlanId } from "@/lib/billing/plans";

/**
 * The pricing modal's handle, provided by PricingModalProvider. Its own
 * module so that anything can open the modal (ActionErrorNotice, the sidebar
 * chip, the profile menu) without importing the modal itself, which imports
 * some of those back.
 */
export type PricingModalApi = {
  /** Open the plans, recording where from (for the funnel). */
  open: (options: { source: PricingSource }) => void;
  /** The plan the active store is on, for the chip and the profile menu.
   *  Null when it could not be read. */
  plan: PlanId | null;
};

export const PricingModalContext = React.createContext<PricingModalApi | null>(null);

/** The modal's opener, or null outside a dashboard shell (a surface there
 *  falls back to a link to Settings › Plan & billing). */
export function usePricingModal(): PricingModalApi | null {
  return React.useContext(PricingModalContext);
}
