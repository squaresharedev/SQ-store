// SERVER ONLY. WHICH FEATURES A STORE'S PLAN SWITCHES ON: hasFeature, the one
// question an API route or a page asks before it lets a gated thing happen.
//
// The answer is read from the database (plan_entitlements, migration
// 20261011_pricing_config): a row means the plan has the feature. Moving a
// feature between plans is a row, not a deploy.
//
// NOTHING IS GATED UNTIL THE SWITCH IS ON. While
// billing_switches.entitlements_enforced is off (as it ships), every plan has
// every feature, exactly as before entitlements existed. The split that is
// seeded is a suggestion still to be confirmed, and several of its features
// are things Free sellers use today.
//
// A READ FAILURE GRANTS THE FEATURE (logged). A gate is an upsell, not a
// security boundary, and refusing a seller their own editor because a config
// table could not be read would be the wrong way round. The same stance as
// the plan limits (lib/billing/limits.ts).
//
// DROPPING TO FREE NEVER BREAKS A LIVE STORE. hasFeature answers "may this be
// changed or created now". What a store already has keeps rendering; callers
// lock the control, they never hide or delete what was made with it.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAccountBilling } from "@/lib/billing/account-plan";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getBillingSwitches } from "@/lib/billing/switches";
import { FEATURE_KEYS, featureKeySchema, type FeatureKey } from "@/lib/pricing";

/** Every feature, for when nothing is gated or the table cannot be read. */
const EVERY_FEATURE: ReadonlySet<FeatureKey> = new Set(FEATURE_KEYS);

/**
 * The features `plan` has, from plan_entitlements. Every feature when the
 * table cannot be read. Once per plan per request.
 */
export const readPlanFeatures = cache(async (plan: PlanId): Promise<ReadonlySet<FeatureKey>> => {
  try {
    const { data, error } = await createAdminClient().from("plan_entitlements").select("feature").eq("plan_id", plan);
    if (error) {
      console.error("[billing] reading the plan's entitlements failed:", error.message);
      return EVERY_FEATURE;
    }
    const features = new Set<FeatureKey>();
    for (const row of data ?? []) {
      const parsed = featureKeySchema.safeParse(row.feature);
      if (parsed.success) features.add(parsed.data);
    }
    return features;
  } catch (error) {
    console.error("[billing] reading the plan's entitlements threw:", error instanceof Error ? error.message : error);
    return EVERY_FEATURE;
  }
});

/**
 * Whether `sellerId`'s plan includes `feature` right now.
 *
 * `sellerId` must be an account the caller has already been authorised on
 * (the active account, or the seller behind a product gate): this reads with
 * the service role and checks nothing about the caller.
 */
export async function hasFeature(sellerId: string, feature: FeatureKey): Promise<boolean> {
  if (!(await getBillingSwitches()).entitlementsEnforced) return true;
  const billing = await readAccountBilling(sellerId);
  if (!billing.ok) return true;
  return (await readPlanFeatures(billing.billing.plan)).has(feature);
}

/**
 * The cheapest plan that includes `feature` (PLAN_IDS runs cheapest first):
 * the plan an upgrade prompt names. Null when no plan has it.
 */
export async function cheapestPlanWithFeature(feature: FeatureKey): Promise<PlanId | null> {
  for (const plan of PLAN_IDS) {
    if ((await readPlanFeatures(plan)).has(feature)) return plan;
  }
  return null;
}
