// SERVER ONLY. The account-level shipping and returns terms: the ONE place
// that turns a profile row into the `SellerShippingPolicy` every reader uses.
// The hosted product page, the storefront designer's read-only summary and the
// product form's shipping picker all go through here, so none of them can be
// looking at a different policy from the others.
//
// WHY THIS EXISTS. These terms used to be `storefronts.config.policies` and
// `storefronts.config.shippingProfiles`, edited in the designer's side panel.
// A storefront is a PRESENTATION of one catalogue rather than a separate
// business, so a seller with two storefronts was retyping the same returns
// policy with no second answer to give, and the design surface is the wrong
// place to be deciding who pays return postage. Moved to
// `profiles.shipping_policy` by 20260905_shipping_policy_on_profile, the same
// move (and the same day) as the trader identity in seller-identity.ts.
//
// SECURITY MODEL. Identical to seller-identity.ts, and for the same reason:
// `profiles` RLS is select-your-own-row-only, which is right for Settings and
// wrong for the two callers that legitimately read someone ELSE's terms — a
// buyer with no session, and a team member previewing a store they do not own.
// `getShippingPolicy` reads with the SERVICE ROLE and, like every other
// service-role read here, gates nothing itself: the caller must already have
// established the right to see this (the public page's own rate-limit and
// existence gate, or `can(account.role, "storefront.write")` behind an
// active-account check).

import { createAdminClient } from "@/lib/supabase/admin";
import { shippingPolicySchema } from "@/lib/validation/shipping-policy";
import { EMPTY_SHIPPING_POLICY, type SellerShippingPolicy } from "@/types/shipping-policy";

/** The one column a shipping policy is built from. */
export const SHIPPING_POLICY_SELECT = "shipping_policy" as const;

export type ShippingPolicyRow = {
  shipping_policy: unknown;
};

/**
 * A stored jsonb value -> the shape every reader uses.
 *
 * PARSED, NOT CAST. The column is jsonb, so what comes back is whatever was
 * last written to it, and a row written before a field existed (or by a
 * service-role script that skipped the action) is a real possibility. Running
 * the same schema the write boundary uses means a reader can never be handed a
 * shape it does not expect; a value that fails is an EMPTY policy, not a
 * throw, because a seller whose terms will not parse should see a page missing
 * its shipping section rather than a page that 500s.
 */
export function buildShippingPolicy(row: ShippingPolicyRow | null): SellerShippingPolicy {
  if (!row || row.shipping_policy === null || row.shipping_policy === undefined) {
    return EMPTY_SHIPPING_POLICY;
  }
  const parsed = shippingPolicySchema.safeParse(row.shipping_policy);
  if (!parsed.success) {
    console.error("[shipping-policy] stored value failed to parse", parsed.error.issues[0]);
    return EMPTY_SHIPPING_POLICY;
  }
  return parsed.data;
}

/**
 * One account's shipping terms, read with the service role.
 *
 * For a single-use caller (the storefront designer's page load, the product
 * form's picker). A caller already holding an admin client for other reads in
 * the same request should select `SHIPPING_POLICY_SELECT` on its own client
 * instead of spinning up a second one — see lib/products/public.ts, which
 * takes this column alongside the seller identity in one select.
 */
export async function getShippingPolicy(ownerId: string): Promise<SellerShippingPolicy> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(SHIPPING_POLICY_SELECT)
    .eq("id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[shipping-policy] read failed", error);
    return EMPTY_SHIPPING_POLICY;
  }
  return buildShippingPolicy(data as ShippingPolicyRow | null);
}
