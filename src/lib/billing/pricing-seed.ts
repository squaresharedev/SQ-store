// WHAT THE PRICING TABLES ARE SEEDED WITH: plan_prices (option A, locked on
// 10 Oct 2026) and plan_entitlements.
//
// NOT WHAT THE APP CHARGES FROM. The running app reads both tables from the
// database (lib/billing/catalog.ts, entitlements.ts), so a price or a fee
// changes without a deploy. This copy exists for everything that has no
// database to ask: the dev galleries' fixtures, the seed script, the
// Playwright helpers and the unit tests.
//
// MIRROR of the seed in supabase/migrations/20261011_pricing_config.sql.
// tests/integration/36-pricing-config.test.ts reads both and fails when they
// disagree: edit the two in the same change.
//
// IMPORT-FREE apart from the pricing contract (itself import-free), for the
// same reason as plans.ts: scripts import this file by relative path.

import type { FeatureKey, PlanId } from "../pricing/enums.ts";
import type { PlanPrice } from "../pricing/plan-price.ts";

/** When the seeded rows take effect: the day the numbers were locked. */
export const PLAN_PRICE_SEED_FROM = "2026-10-10T00:00:00+00:00";

const seeded = (
  row: Pick<PlanPrice, "planId" | "priceCents" | "directFeeBps" | "marketplaceFeeBps" | "stripeLookupKey">,
): PlanPrice => ({
  ...row,
  version: 1,
  interval: "month",
  listPriceCents: null,
  currency: "EUR",
  effectiveFrom: PLAN_PRICE_SEED_FROM,
  effectiveTo: null,
});

/**
 * One monthly row per plan. Yearly billing is not sold yet: it starts the day
 * a yearly row is added for every paid plan, with no code change.
 *
 * The marketplace fees (8%, 7%, 6%) are defaults Adrian has not confirmed.
 */
export const PLAN_PRICE_SEED: readonly PlanPrice[] = [
  seeded({ planId: "free", priceCents: 0, directFeeBps: 500, marketplaceFeeBps: 800, stripeLookupKey: null }),
  seeded({
    planId: "starter",
    priceCents: 1200,
    directFeeBps: 200,
    marketplaceFeeBps: 700,
    stripeLookupKey: "starter_month_eur_v1",
  }),
  seeded({
    planId: "pro",
    priceCents: 3900,
    directFeeBps: 50,
    marketplaceFeeBps: 600,
    stripeLookupKey: "pro_month_eur_v1",
  }),
];

/**
 * Which features each plan switches on: the suggested split, which Adrian can
 * move. A feature listed for a plan is one it has; Free has none of the gated
 * ones. Inert until billing_switches.entitlements_enforced is on.
 *
 * MIRROR of the plan_entitlements seed in the same migration.
 */
export const ENTITLEMENT_SEED: Record<PlanId, readonly FeatureKey[]> = {
  free: [],
  starter: ["freeform_editor", "custom_fonts", "remove_badge", "discount_codes"],
  pro: [
    "freeform_editor",
    "custom_fonts",
    "remove_badge",
    "discount_codes",
    "multiple_storefronts",
    "analytics",
    "priority_support",
  ],
};
