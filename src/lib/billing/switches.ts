// SERVER ONLY. THE LAUNCH SWITCHES of the money layer: one row
// (billing_switches), read in one place. Each ships OFF and is turned on in
// the database, by a person, when the thing it gates is ready:
//
//   planLimitsEnforced    plan limits refuse creates (lib/billing/limits.ts,
//                         and the enforce_plan_limit trigger reads the same row)
//   feesEnabled           a sale is charged its per-sale fee
//                         (lib/billing/sale-fee.ts); off, every sale pays
//                         nothing, as in the closed beta
//   entitlementsEnforced  plan_entitlements gates features
//                         (lib/billing/entitlements.ts); off, every plan has
//                         every feature
//
// A READ FAILURE READS AS ALL OFF, including a database the migration has not
// reached: a switch that cannot be read must not start charging or locking.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

export type BillingSwitches = {
  planLimitsEnforced: boolean;
  feesEnabled: boolean;
  entitlementsEnforced: boolean;
};

const ALL_OFF: BillingSwitches = { planLimitsEnforced: false, feesEnabled: false, entitlementsEnforced: false };

export async function readBillingSwitches(): Promise<BillingSwitches> {
  try {
    const { data, error } = await createAdminClient()
      .from("billing_switches")
      .select("plan_limits_enforced, fees_enabled, entitlements_enforced")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return ALL_OFF;
    return {
      planLimitsEnforced: data.plan_limits_enforced === true,
      feesEnabled: data.fees_enabled === true,
      entitlementsEnforced: data.entitlements_enforced === true,
    };
  } catch {
    return ALL_OFF;
  }
}

/** readBillingSwitches, once per request. */
export const getBillingSwitches = cache(readBillingSwitches);
