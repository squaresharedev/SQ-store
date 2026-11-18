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
// an active-account check (app/storefront/(designer)/[id]/page.tsx).

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverError, traderIdentityRequired, type ActionError } from "@/lib/errors";
import { emailProofRequired } from "@/lib/contact-verification/availability";
import { emailAddress } from "@/lib/validation/inputs";
import { emailQualityProblem } from "@/lib/validation/email-quality";
import { addressQualityProblem } from "@/lib/validation/address-quality";
import { formatPhoneInternational } from "@/lib/validation/phone";
import {
  isTraderIdentityComplete,
  missingTraderIdentity,
  type TraderIdentityField,
  type TraderIdentityInput,
} from "@/lib/settings/trader-identity";
import { getAccountRow } from "@/lib/settings/account-row";
import type { StorefrontSeller } from "@/types/storefront";

/**
 * Exactly the profile columns a trader identity is built from. The phone's
 * PROOF rides along because it decides whether the phone is shown at all
 * (see buildSellerIdentity); the timestamp itself never reaches a buyer.
 */
export const SELLER_IDENTITY_SELECT =
  "tax_business_name, tax_vat_id, tax_country, seller_address, seller_email, seller_phone, seller_phone_verified_at, seller_bio" as const;

export type SellerIdentityRow = {
  tax_business_name: string | null;
  tax_vat_id: string | null;
  tax_country: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_phone_verified_at: string | null;
  seller_bio: string | null;
};

/**
 * The identity columns PLUS the one the publish gate needs and a buyer must
 * never see: whether the contact email has been proven
 * (20260926_contact_verification).
 *
 * Kept as a separate constant rather than widened into
 * {@link SELLER_IDENTITY_SELECT} so the buyer-facing read stays the columns a
 * buyer's view is built from. Anything selecting this must build the page's
 * seller block with `buildSellerIdentity` (which copies field by field and
 * therefore cannot carry the extra column) and the gate's input with
 * {@link buildTraderIdentityInput}.
 */
export const TRADER_GATE_SELECT =
  `${SELLER_IDENTITY_SELECT}, seller_email_verified_at` as const;

export type TraderGateRow = SellerIdentityRow & {
  seller_email_verified_at: string | null;
};

/**
 * Would the settings form accept this email today? The gate asks, rather than
 * trusting that every stored value came through the form: `profiles` is
 * writable by its owner over the REST API too, and a placeholder written that
 * way must count as missing, not as present.
 */
function plausibleEmail(email: string): boolean {
  return emailAddress("contactEmail").safeParse(email).success && !emailQualityProblem(email);
}

/**
 * A row -> what the publish gate asks about. A stored value the settings form
 * would refuse (see above, and addressQualityProblem) counts as absent, so the
 * gate is the same wall whichever way the row was written. Verification is a
 * boolean here; when it was proven is nobody's business but the audit trail's.
 *
 * Builds ONLY the four fields missingTraderIdentity reads (businessName,
 * address, email, emailVerified) directly from the row, applying the same
 * normalisation buildSellerIdentity uses. This avoids the libphonenumber call
 * inside buildSellerIdentity, which is irrelevant to the publish gate.
 */
export function buildTraderIdentityInput(
  row: TraderGateRow | null,
): TraderIdentityInput {
  const rawAddress = row?.seller_address || undefined;
  const rawEmail = row?.seller_email || undefined;
  return {
    ...(row?.tax_business_name ? { businessName: row.tax_business_name } : {}),
    ...(rawAddress && !addressQualityProblem(rawAddress) ? { address: rawAddress } : {}),
    ...(rawEmail && plausibleEmail(rawEmail) ? { email: rawEmail } : {}),
    emailVerified: Boolean(row?.seller_email_verified_at),
  };
}

/**
 * THE READ SIDE OF THE PUBLISH GATE, as every public page asks it: may this
 * seller's offers be shown to a buyer? Pass `null` when the row could not be
 * read: that fails closed, since an identity we could not read is one we
 * cannot display.
 */
export function sellerMaySell(row: TraderGateRow | null): boolean {
  return isTraderIdentityComplete(buildTraderIdentityInput(row), {
    requireVerifiedEmail: emailProofRequired(),
  });
}

/**
 * A profile row -> the shape the product page renders. Built field by field
 * (never spread) so a future profile column cannot leak into this by default,
 * the same discipline `buildProductPageProduct` uses for the product itself.
 * `null` (no row, or the read failed) is a seller with nothing set yet — an
 * empty object, not an error, since every field here is optional everywhere
 * it is read.
 *
 * THE PHONE IS SHOWN ONLY ONCE PROVEN (a code texted to it and typed back,
 * lib/contact-verification). It is optional and never part of the publish
 * gate, so withholding an unproven one blocks nobody from selling; showing
 * one would put a number on the page that nobody has shown they answer.
 * Formatted for reading ("+353 87 123 4567"); stored as E.164.
 */
export function buildSellerIdentity(row: SellerIdentityRow | null): StorefrontSeller {
  if (!row) return {};
  return {
    ...(row.tax_business_name ? { businessName: row.tax_business_name } : {}),
    ...(row.seller_address ? { address: row.seller_address } : {}),
    ...(row.seller_email ? { email: row.seller_email } : {}),
    ...(row.tax_vat_id ? { vatId: row.tax_vat_id } : {}),
    ...(row.tax_country ? { country: row.tax_country } : {}),
    ...(row.seller_phone && row.seller_phone_verified_at
      ? { phone: formatPhoneInternational(row.seller_phone) }
      : {}),
    ...(row.seller_bio ? { bio: row.seller_bio } : {}),
  };
}

/**
 * One account's trader identity, read with the service role.
 *
 * For a single-use caller (the public product page, route handlers) that
 * issues its own narrow read. Dashboard pages should call
 * {@link getAccountSellerIdentity} instead to share the account row read that
 * the shell has already issued.
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
 * The account's seller identity, derived from the React-cached account row
 * (getAccountRow). Use on dashboard pages where the shell has already
 * fetched the account row; prefer {@link getSellerIdentity} for public pages
 * and route handlers that issue their own narrow read.
 */
export const getAccountSellerIdentity = cache(async (accountId: string): Promise<StorefrontSeller> => {
  const result = await getAccountRow(accountId);
  if (!result.ok || !result.row) return {};
  return buildSellerIdentity(result.row as SellerIdentityRow);
});

/**
 * Whether this account may publish or sell, and what it is still missing.
 *
 * The WRITE-SIDE half of the publish gate (lib/settings/trader-identity.ts owns
 * the rule itself). Every action that puts something on sale asks this before
 * it writes: creating or editing an `active` product, switching a storefront's
 * embed on. The public READ side does not call this -- the buyer-facing paths
 * already hold the profile row and apply `missingTraderIdentity` to it
 * directly, so a page render never pays for a second query.
 *
 * `{ ok: false }` is a read failure, kept distinct from "nothing filled in":
 * a seller whose details are complete must not be told to go and add them
 * because a query blipped, and equally must not be waved through. Callers turn
 * it into a plain server error and the write is refused either way -- a legal
 * disclosure gate is the wrong place to fail open.
 *
 * Deduped per render via the account row cache (getAccountRow), so the shell
 * and the page reading this together cost one round trip, not two.
 */
export const getTraderIdentityStatus = cache(
  async (
    ownerId: string,
  ): Promise<{ ok: true; missing: TraderIdentityField[] } | { ok: false }> => {
    const result = await getAccountRow(ownerId);
    if (!result.ok) {
      console.error("[seller-identity] publish-gate read failed: account row unavailable");
      return { ok: false };
    }
    return {
      ok: true,
      missing: missingTraderIdentity(
        buildTraderIdentityInput(result.row as TraderGateRow | null),
        { requireVerifiedEmail: emailProofRequired() },
      ),
    };
  },
);

/**
 * Narrow UNCACHED read of the trader gate columns, for publishBlockedError.
 *
 * The publish gate must never depend on the billing join or on the React
 * render cache: it runs inside server actions where cache() is a no-op, and
 * its security guarantee is that any read failure refuses rather than waves
 * through. A fresh narrow read of only the columns it needs is the safest
 * expression of that guarantee.
 *
 * Fields spelled out in the error log: a PostgrestError printed whole shows
 * as `{}` in the dev overlay, hiding the one thing worth reading (a missing
 * column signals an unapplied migration).
 */
async function readTraderGateUncached(
  ownerId: string,
): Promise<{ ok: true; missing: TraderIdentityField[] } | { ok: false }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select(TRADER_GATE_SELECT)
      .eq("id", ownerId)
      .maybeSingle();
    if (error) {
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
        { requireVerifiedEmail: emailProofRequired() },
      ),
    };
  } catch (err) {
    // createAdminClient THROWS when the service-role env is missing or wrong.
    // An unhandled throw here is a crashed action with no message; a caught
    // one is a refusal that says something. (A bad prod service-role key has
    // taken buyer-facing paths down here before.)
    console.error(
      "[seller-identity] publish-gate client unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false };
  }
}

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
 *
 * Uses an UNCACHED narrow profiles read (readTraderGateUncached), not the
 * account row cache: actions run outside a render, the billing join is
 * irrelevant here, and the gate must not depend on cached state from an
 * earlier render that may be stale.
 */
export async function publishBlockedError(
  accountId: string,
): Promise<ActionError | null> {
  const identity = await readTraderGateUncached(accountId);
  // A read failure refuses rather than waving the publish through: see the
  // comments in readTraderGateUncached for why this end fails closed.
  if (!identity.ok) return serverError("checkSellerDetails");
  if (identity.missing.length === 0) return null;
  return traderIdentityRequired(identity.missing);
}
