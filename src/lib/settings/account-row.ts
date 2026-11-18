// SERVER ONLY. One cached profiles read per render, with billing and the
// staff plan grant embedded, keyed by accountId. The dashboard shell and
// every seller page that opens behind it converge on this one query instead
// of each issuing separate reads for the same row.
//
// WHAT IS JOINED. `seller_billing` and `plan_grants` both have owner_id as
// their primary key, referencing profiles.id; PostgREST returns each as a
// single embedded object (or null when the row does not exist). This lets
// one round-trip replace the shell's two and each page's additional reads.
//
// TRUST MODEL. Exactly the service-role / accountId-keyed trust model of the
// individual reads it replaces. The accountId was validated by getActiveAccount
// before any of these functions are reached; this function never re-checks it
// and never takes an accountId from a request.
//
// MISSING GRANT TABLE. isMissingTableError is kept here: when the
// 20261019_plan_grants migration has not reached a database yet, the query
// fails on the embedded plan_grants reference and we fall back to reading
// without it. plan_grant is then null in the result, which every consumer
// treats as "no active grant" (the same soft-failure path the old
// readActiveGrant used).

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError } from "@/lib/supabase/errors";

// The profiles columns the account row includes.
//
// These strings must match the named constants in their home modules:
//   TRADER_GATE_SELECT in seller-identity.ts
//   SHIPPING_POLICY_SELECT in shipping-policy.ts
//   BILLING_SELECT in account-plan.ts
//   GRANT_SELECT in grants.ts
//
// They are kept here as one inline join so the select string stays in sync
// without creating a circular import between account-row.ts and those modules.
const IDENTITY_COLS =
  "tax_business_name, tax_vat_id, tax_country, seller_address, seller_email, seller_phone, seller_phone_verified_at, seller_bio, seller_email_verified_at" as const;

const SHIPPING_COL = "shipping_policy" as const;

// Matches BILLING_SELECT in account-plan.ts exactly.
const BILLING_COLS =
  "plan, paid_until, status, billing_interval, price_cents, currency, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id" as const;

// Matches GRANT_SELECT in grants.ts exactly.
const GRANT_COLS = "plan, starts_at, ends_at" as const;

const FULL_SELECT =
  `${IDENTITY_COLS}, ${SHIPPING_COL}, billing:seller_billing(${BILLING_COLS}), plan_grant:plan_grants(${GRANT_COLS})` as const;

const NO_GRANT_SELECT =
  `${IDENTITY_COLS}, ${SHIPPING_COL}, billing:seller_billing(${BILLING_COLS})` as const;

/** The embedded seller_billing object returned by the account row. Matches
 *  the BILLING_SELECT columns in account-plan.ts. */
export type AccountBillingEmbed = {
  plan: string | null;
  paid_until: string | null;
  status: string | null;
  billing_interval: string | null;
  price_cents: number | null;
  currency: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

/** The embedded plan_grants object returned by the account row. Matches
 *  GRANT_SELECT from grants.ts (plan, starts_at, ends_at). */
export type AccountGrantEmbed = {
  plan: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

/** One profiles row with billing and plan grant embedded. Null means the
 *  account has no profiles row, which should not happen for a validated
 *  accountId but is handled gracefully by every consumer. */
export type AccountRow = {
  // Trader identity columns (matches TRADER_GATE_SELECT from seller-identity.ts)
  tax_business_name: string | null;
  tax_vat_id: string | null;
  tax_country: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_phone_verified_at: string | null;
  seller_bio: string | null;
  seller_email_verified_at: string | null;
  // Shipping policy column (matches SHIPPING_POLICY_SELECT from shipping-policy.ts)
  shipping_policy: unknown;
  // Embedded one-to-one joins (single object or null, never an array, because
  // owner_id is the primary key on each child table)
  billing: AccountBillingEmbed | null;
  plan_grant: AccountGrantEmbed | null;
};

export type AccountRowResult = { ok: true; row: AccountRow | null } | { ok: false };

async function readAccountRow(accountId: string): Promise<AccountRowResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select(FULL_SELECT)
      .eq("id", accountId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        // plan_grants table not yet in this database: re-read without the
        // grant embed so the shell keeps working during a pending migration.
        const { data: d2, error: e2 } = await admin
          .from("profiles")
          .select(NO_GRANT_SELECT)
          .eq("id", accountId)
          .maybeSingle();
        if (e2) {
          console.error("[account-row] fallback read failed:", e2.code, e2.message);
          return { ok: false };
        }
        return {
          ok: true,
          row: d2
            ? { ...(d2 as unknown as Omit<AccountRow, "plan_grant">), plan_grant: null }
            : null,
        };
      }
      console.error("[account-row] read failed:", error.code, error.message);
      return { ok: false };
    }
    return { ok: true, row: data as unknown as AccountRow | null };
  } catch (err) {
    // createAdminClient throws without the service-role env key.
    console.error(
      "[account-row] client unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false };
  }
}

/** One profiles read per render (React cache), keyed by accountId. Covers
 *  trader identity, shipping policy, billing, and the staff plan grant in a
 *  single round trip. Callers derive from the result via their own cached
 *  helpers; they never re-read profiles for data this row supplies. */
export const getAccountRow = cache(readAccountRow);
