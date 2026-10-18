// THE PRICING VOCABULARY: every persisted word the money layer uses, as a
// strict list with its Zod schema. A value outside its list is refused at the
// boundary rather than stored.
//
// THE WORKING COPY OF @squaresharedev/pricing (SQ-system, packages/pricing).
// Edit both together until the Store consumes the published package: the
// files differ only in their import extensions.
//
// MIRRORED IN POSTGRES (supabase/migrations/20261011_pricing_config.sql):
//   PLAN_IDS         <-> enum public.plan_id
//   FEE_ENTRY_KINDS  <-> enum public.fee_entry_kind
//   FEATURE_KEYS     <-> enum public.feature_key
// tests/integration/36-pricing-config.test.ts compares each pair.
// SALE_ORIGINS has no enum of its own: an order's origin is stored as
// orders.channel (see originForChannel in the Store's lib/billing/origin.ts).

import { z } from "zod";

/** Every seller plan, cheapest first. */
export const PLAN_IDS = ["free", "starter", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const planIdSchema = z.enum(PLAN_IDS);

/** How often a plan is billed. */
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const billingIntervalSchema = z.enum(BILLING_INTERVALS);

/**
 * Where a sale came from. The first three are the seller's own doors and pay
 * the plan's direct fee; `marketplace` is a buyer the marketplace brought, and
 * pays the marketplace fee instead.
 */
export const SALE_ORIGINS = ["embed", "purchase_button", "hosted_storefront", "marketplace"] as const;
export type SaleOrigin = (typeof SALE_ORIGINS)[number];
export const saleOriginSchema = z.enum(SALE_ORIGINS);

/** Whether a sale pays the plan's direct fee (every origin but the marketplace). */
export function isDirectOrigin(origin: SaleOrigin): boolean {
  return origin !== "marketplace";
}

/** What one fee ledger row records. A refund kind is always a negative amount. */
export const FEE_ENTRY_KINDS = ["platform_fee", "ad_fee", "platform_fee_refund", "ad_fee_refund"] as const;
export type FeeEntryKind = (typeof FEE_ENTRY_KINDS)[number];
export const feeEntryKindSchema = z.enum(FEE_ENTRY_KINDS);

/** The features a plan can switch on (plan_entitlements). */
export const FEATURE_KEYS = [
  "freeform_editor",
  "custom_fonts",
  "remove_badge",
  "discount_codes",
  "multiple_storefronts",
  "analytics",
  "priority_support",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const featureKeySchema = z.enum(FEATURE_KEYS);
