// SERVER ONLY. Which billing provider this process uses (see
// lib/billing/availability.ts for the switches, lib/billing/provider.ts for
// the interface).

import { billingProvider } from "@/lib/billing/availability";
import type { BillingProvider } from "@/lib/billing/provider";
import { stripeBillingProvider } from "@/lib/billing/stripe-provider";
import { testBillingProvider } from "@/lib/billing/test-provider";

/** The provider for this process, or null when plans cannot be bought here. */
export function getBillingProvider(): BillingProvider | null {
  switch (billingProvider()) {
    case "stripe":
      return stripeBillingProvider;
    case "test":
      return testBillingProvider;
    default:
      return null;
  }
}
