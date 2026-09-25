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
// `seller_phone` (20260905_seller_identity_on_profile) fill that gap. Those six
// columns together are the seller's trader identity, set ONCE in Settings ›
// Business & seller details and read by every storefront and every product
// this account has — never duplicated per storefront the way it briefly was
// (storefronts.config.seller, retired the same day this landed). `seller_bio`
// (20260916_seller_bio) is read alongside them because it is shown in the same
// Seller section, but it is edited from Settings › Account (next to the
// username — see updateBio in lib/settings/actions.ts), not from this page,
// and it is optional and not part of the publish gate.
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

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverError, traderIdentityRequired, type ActionError } from "@/lib/errors";
import { sellerEmailVerificationRequired } from "@/lib/settings/seller-email-verification";
import {
  missingTraderIdentity,
  type TraderIdentityField,
  type TraderIdentityInput,
} from "@/lib/settings/trader-identity";
import type { StorefrontSeller } from "@/types/storefront";

/** Exactly the profile columns a trader identity is built from. */
export const SELLER_IDENTITY_SELECT =
  "tax_business_name, tax_vat_id, tax_country, seller_address, seller_email, seller_phone, seller_bio" as const;

export type SellerIdentityRow = {
  tax_business_name: string | null;
  tax_vat_id: string | null;
  tax_country: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_bio: string | null;
};

/**
 * The identity columns PLUS the one the publish gate needs and a buyer must
 * never see: whether the contact address has been proven
 * (20260909_seller_email_verification).
 *
 * Kept as a separate constant rather than widened into
 * {@link SELLER_IDENTITY_SELECT} so the buyer-facing read stays exactly the
 * columns a buyer is shown. Anything selecting this must build the page's
 * seller block with `buildSellerIdentity` (which copies field by field and
 * therefore cannot carry the extra column) and the gate's input with
 * {@link buildTraderIdentityInput}.
 */
export const TRADER_GATE_SELECT =
  `${SELLER_IDENTITY_SELECT}, seller_email_verified_at` as const;

export type TraderGateRow = SellerIdentityRow & {
  seller_email_verified_at: string | null;
};

/** A row -> what the publish gate asks about. Verification is a boolean here;
 *  when it was proven is nobody's business but the audit trail's. */
export function buildTraderIdentityInput(
  row: TraderGateRow | null,
): TraderIdentityInput {
  return {
    ...buildSellerIdentity(row),
    emailVerified: Boolean(row?.seller_email_verified_at),
  };
}

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
    ...(row.seller_bio ? { bio: row.seller_bio } : {}),
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
    console.error("[seller-identity] read failed:", error.code, error.message);
    return {};
  }
  return buildSellerIdentity(data);
}

/**
 * Whether this account may publish or sell, and what it is still missing.
 *
 * The WRITE-SIDE half of the publish gate (lib/settings/trader-identity.ts owns
 * the rule itself). Every action that puts something on sale asks this before
 * it writes: creating or editing an `active` product, switching a storefront's
 * embed on. The public READ side does not call this — the buyer-facing paths
 * already hold the profile row and apply `missingTraderIdentity` to it
 * directly, so a page render never pays for a second query.
 *
 * `{ ok: false }` is a read failure, kept distinct from "nothing filled in":
 * a seller whose details are complete must not be told to go and add them
 * because a query blipped, and equally must not be waved through. Callers turn
 * it into a plain server error and the write is refused either way — a legal
 * disclosure gate is the wrong place to fail open.
 *
 * Deduped per render (some pages check this and also render the warning).
 */
export const getTraderIdentityStatus = cache(
  async (
    ownerId: string,
  ): Promise<{ ok: true; missing: TraderIdentityField[] } | { ok: false }> => {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("profiles")
        .select(TRADER_GATE_SELECT)
        .eq("id", ownerId)
        .maybeSingle();
      if (error) {
        // Fields spelled out: a PostgrestError logged whole prints as `{}` in
        // the dev overlay, which hides the one thing worth reading (a missing
        // column is how an unapplied migration shows up here).
        console.error(
          "[seller-identity] publish-gate read failed:",
          error.code,
          error.message,
        );
        return { ok: false };
      }
      return {
        ok: true,
        missing: missingTraderIdentity(
          buildTraderIdentityInput(data as TraderGateRow | null),
          { requireVerifiedEmail: sellerEmailVerificationRequired() },
        ),
      };
    } catch (err) {
      // createAdminClient THROWS when the service-role env is missing or
      // wrong, and this gate now sits in front of a save the seller pressed.
      // An unhandled throw there is a crashed action with no message; a caught
      // one is a refusal that says something. (This is not hypothetical: a bad
      // prod SUPABASE_SERVICE_ROLE_KEY has taken buyer-facing paths down here
      // before.)
      console.error(
        "[seller-identity] publish-gate client unavailable:",
        err instanceof Error ? err.message : String(err),
      );
      return { ok: false };
    }
  },
);

/**
 * The publish gate as one call, for every server action that puts something in
 * front of buyers: `null` to proceed, an `ActionError` to refuse with.
 *
 * Lives here rather than in any one action file because three unrelated write
 * paths need it (a product going `active`, a CSV import landing live rows, a
 * storefront's embed being switched on) and a gate that each of them
 * re-implements is a gate that eventually disagrees with itself.
 *
 * Always pass the ACCOUNT id, never the signed-in user's: the details a buyer
 * needs belong to the trader whose store this is, and a team member cannot
 * stand in for them.
 */
export async function publishBlockedError(
  accountId: string,
): Promise<ActionError | null> {
  const identity = await getTraderIdentityStatus(accountId);
  // A read failure refuses rather than waving the publish through: see
  // getTraderIdentityStatus for why this end fails closed.
  if (!identity.ok) return serverError("checkSellerDetails");
  if (identity.missing.length === 0) return null;
  return traderIdentityRequired(identity.missing);
}
