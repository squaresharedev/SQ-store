// SERVER ONLY. The account-level trader identity: the ONE place that turns a
// profile row into what a buyer (or a seller previewing their own page) sees
// as `StorefrontSeller`. The public product page and the storefront
// designer's read-only preview both call this, so the two can never disagree
// about what a seller's identity looks like.
//
// WHY THIS EXISTS. `tax_business_name` / `tax_vat_id` / `tax_country` already
// lived on `profiles`, collected ahead of VAT/invoicing work. Distance-selling
// law also asks for a postal address and a way to reach the seller, which tax
// info alone does not cover — `seller_address` / `seller_email` /
// `seller_phone` (20260905_seller_identity_on_profile) fill that gap. All six
// columns together are the seller's trader identity, set ONCE in Settings ›
// Business & seller details and read by every storefront and every product
// this account has — never duplicated per storefront the way it briefly was
// (storefronts.config.seller, retired the same day this landed).
//
// SECURITY MODEL. `profiles` RLS is select-your-own-row-only (it holds tax
// data and must never carry a broader policy — see 20260706081542 and
// 20260807_scope_sq_app_social_reads). That is correct for Settings, wrong for
// two callers that legitimately need to read someone ELSE's seller identity:
// a buyer with no session at all, and a team member previewing a store they
// do not own. `getSellerIdentity` reads with the SERVICE ROLE for exactly
// that reason, and — like every other service-role read in this codebase —
// gates nothing itself. The caller must have already established the right to
// see this: the public product page's own rate-limit + existence gate
// (lib/products/public.ts), or `can(account.role, "storefront.write")` behind
// an active-account check (app/storefront/[id]/page.tsx).

import { createAdminClient } from "@/lib/supabase/admin";
import type { StorefrontSeller } from "@/types/storefront";

/** Exactly the profile columns a trader identity is built from. */
export const SELLER_IDENTITY_SELECT =
  "tax_business_name, tax_vat_id, tax_country, seller_address, seller_email, seller_phone" as const;

export type SellerIdentityRow = {
  tax_business_name: string | null;
  tax_vat_id: string | null;
  tax_country: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
};

/**
 * A profile row -> the shape the product page renders. Built field by field
 * (never spread) so a future profile column cannot leak into this by default,
 * the same discipline `buildProductPageProduct` uses for the product itself.
 * `null` (no row, or the read failed) is a seller with nothing set yet — an
 * empty object, not an error, since every field here is optional everywhere
 * it is read.
 */
export function buildSellerIdentity(row: SellerIdentityRow | null): StorefrontSeller {
  if (!row) return {};
  return {
    ...(row.tax_business_name ? { businessName: row.tax_business_name } : {}),
    ...(row.seller_address ? { address: row.seller_address } : {}),
    ...(row.seller_email ? { email: row.seller_email } : {}),
    ...(row.tax_vat_id ? { vatId: row.tax_vat_id } : {}),
    ...(row.tax_country ? { country: row.tax_country } : {}),
    ...(row.seller_phone ? { phone: row.seller_phone } : {}),
  };
}

/**
 * One account's trader identity, read with the service role.
 *
 * For a single-use caller (the storefront designer's page load). A caller
 * already holding an admin client for other reads in the same request (the
 * public product page) should select `SELLER_IDENTITY_SELECT` on its own
 * client instead of spinning up a second one — see lib/products/public.ts.
 */
export async function getSellerIdentity(ownerId: string): Promise<StorefrontSeller> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(SELLER_IDENTITY_SELECT)
    .eq("id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[seller-identity] read failed", error);
    return {};
  }
  return buildSellerIdentity(data);
}
