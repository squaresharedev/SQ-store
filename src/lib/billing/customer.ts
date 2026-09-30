// SERVER ONLY. The billing customer behind an account: created the first time
// its owner goes to checkout, then reused for every checkout, portal visit and
// webhook after.
//
// ONE CUSTOMER PER ACCOUNT, even under a race. Two tabs pressing Upgrade at
// once both ask the provider to create the customer with the same idempotency
// key (Stripe answers both with the same customer), and seller_billing's
// primary key lets only one row in; the loser reads the winner's id back.
//
// The webhook finds the account from this row (stripe_customer_id), never
// from anything an event carries in its metadata: this row is written only
// here, by the server, for the signed-in owner.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/locales";
import type { BillingProvider } from "@/lib/billing/provider";

/**
 * The account's customer id, creating the customer (and its seller_billing
 * row) if this is the account's first checkout. `ownerId` must be the
 * signed-in owner: the profile is read under their own session.
 */
export async function ensureBillingCustomer(
  provider: BillingProvider,
  owner: { ownerId: string; email: string | null; locale: Locale },
  existingCustomerId: string | null,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;

  // The business details the seller already gave for the publish gate, so
  // the invoice carries their company and the VAT ID reverse-charges.
  const { data: profile } = await (await createClient())
    .from("profiles")
    .select("tax_business_name, tax_country, tax_vat_id")
    .eq("id", owner.ownerId)
    .maybeSingle();

  const customerId = await provider.createCustomer({
    ownerId: owner.ownerId,
    email: owner.email,
    name: profile?.tax_business_name?.trim() || null,
    country: profile?.tax_country?.trim().toUpperCase() || null,
    vatId: profile?.tax_vat_id?.trim() || null,
    locale: owner.locale,
  });

  const admin = createAdminClient();
  const { error: insertError } = await admin
    .from("seller_billing")
    .upsert({ owner_id: owner.ownerId, stripe_customer_id: customerId }, { onConflict: "owner_id", ignoreDuplicates: true });
  if (insertError) throw new Error(`storing the billing customer failed: ${insertError.message}`);

  // Whoever won a race, the stored id is the account's customer.
  const { data: stored, error: readError } = await admin
    .from("seller_billing")
    .select("stripe_customer_id")
    .eq("owner_id", owner.ownerId)
    .single();
  if (readError || !stored) throw new Error(`reading the billing customer back failed: ${readError?.message}`);
  return stored.stripe_customer_id;
}
