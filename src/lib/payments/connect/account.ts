// SERVER ONLY. A seller's connected Stripe account: the row that says which
// Stripe account is whose (seller_payment_accounts), and the few calls that
// create and refresh it.
//
// THE ROW IS THE TRUST ANCHOR. An incoming Stripe event names a connected
// account (event.account); this table is what turns that into a seller. So the
// account id is written ONLY here, from Stripe's own answer to our own
// request, never from anything a browser or an event's metadata said. The
// table is service-role only for the same reason (20261008_seller_payment_accounts).
//
// EXPRESS ACCOUNTS. Stripe hosts the onboarding (identity, bank details) and
// the seller's payout dashboard; this app never collects or stores financial
// data. A DIRECT charge is then made on the seller's account, which is what
// keeps the seller, not Square Share, the merchant of record
// (lib/checkout/stripe-provider.ts).

import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/app-url";
import {
  stripeKeyIsLive,
  stripeRequest,
  type StripeAccount,
  type StripeAccountLink,
} from "@/lib/billing/stripe-api";
import { PAYMENTS_CONNECT_RETURN_PATH } from "@/lib/payments/paths";

/** A seller's connected account, as this app knows it. */
export type PaymentAccount = {
  ownerId: string;
  stripeAccountId: string;
  /** Stripe will take payments on it: what checkout reads. */
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  livemode: boolean;
};

const SELECT = "owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, livemode";

type Row = {
  owner_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  livemode: boolean;
};

const toAccount = (row: Row): PaymentAccount => ({
  ownerId: row.owner_id,
  stripeAccountId: row.stripe_account_id,
  chargesEnabled: row.charges_enabled,
  payoutsEnabled: row.payouts_enabled,
  detailsSubmitted: row.details_submitted,
  livemode: row.livemode,
});

/** This seller's connected account, or null when they have none (or the read
 *  failed: an account we cannot read is one we cannot charge). */
export async function readPaymentAccount(ownerId: string): Promise<PaymentAccount | null> {
  const { data, error } = await createAdminClient()
    .from("seller_payment_accounts")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[payments] account read failed:", error.message);
    return null;
  }
  return data ? toAccount(data as Row) : null;
}

/** The seller a connected account belongs to, or null when it is not one of
 *  ours. How an event from Stripe finds its store. */
export async function readPaymentAccountByStripeId(stripeAccountId: string): Promise<PaymentAccount | null> {
  const { data, error } = await createAdminClient()
    .from("seller_payment_accounts")
    .select(SELECT)
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`resolving the connected account failed: ${error.message}`);
  return data ? toAccount(data as Row) : null;
}

/**
 * Whether this account can take a payment through THIS deployment right now:
 * Stripe says it may, and it is the same mode as our key (a live deployment
 * never charges a test-mode account, and the other way round).
 */
export function canTakePayments(account: PaymentAccount | null): account is PaymentAccount {
  return account !== null && account.chargesEnabled && account.livemode === stripeKeyIsLive();
}

/** Record what Stripe says about an account. Only the three facts: the id and
 *  the owner never change once the row exists. */
async function saveAccountFacts(stripeAccountId: string, facts: StripeAccount): Promise<void> {
  const { error } = await createAdminClient()
    .from("seller_payment_accounts")
    .update({
      charges_enabled: facts.charges_enabled === true,
      payouts_enabled: facts.payouts_enabled === true,
      details_submitted: facts.details_submitted === true,
    })
    .eq("stripe_account_id", stripeAccountId);
  if (error) throw new Error(`saving the connected account failed: ${error.message}`);
}

/** An account.updated event's payload, applied. The caller has already
 *  checked the event is about this account. */
export async function applyAccountFacts(facts: StripeAccount): Promise<void> {
  await saveAccountFacts(facts.id, facts);
}

/** Ask Stripe where the seller's account stands and record the answer. Called
 *  when the seller comes back from onboarding, so the page they land on is
 *  already true rather than waiting on an event. */
export async function refreshPaymentAccount(ownerId: string): Promise<PaymentAccount | null> {
  const account = await readPaymentAccount(ownerId);
  if (!account) return null;
  const facts = await stripeRequest<StripeAccount>("GET", `/accounts/${account.stripeAccountId}`);
  await saveAccountFacts(account.stripeAccountId, facts);
  return readPaymentAccount(ownerId);
}

/**
 * The seller's connected account, created on first use.
 *
 * Idempotent twice over: Stripe is asked with a key derived from the owner, so
 * a double click cannot create two accounts, and the row's primary key is the
 * owner, so two cannot be recorded.
 */
export async function ensurePaymentAccount(owner: {
  ownerId: string;
  email: string | null;
  /** ISO 3166-1 alpha-2, when the seller has said where they trade from. */
  country: string | null;
}): Promise<PaymentAccount> {
  const existing = await readPaymentAccount(owner.ownerId);
  if (existing) return existing;

  const created = await stripeRequest<StripeAccount>(
    "POST",
    "/accounts",
    {
      type: "express",
      ...(owner.country ? { country: owner.country } : {}),
      ...(owner.email ? { email: owner.email } : {}),
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { owner_id: owner.ownerId },
    },
    { idempotencyKey: `connect_account_${owner.ownerId}` },
  );

  const { error } = await createAdminClient()
    .from("seller_payment_accounts")
    .upsert(
      {
        owner_id: owner.ownerId,
        stripe_account_id: created.id,
        charges_enabled: created.charges_enabled === true,
        payouts_enabled: created.payouts_enabled === true,
        details_submitted: created.details_submitted === true,
        livemode: stripeKeyIsLive(),
      },
      { onConflict: "owner_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`recording the connected account failed: ${error.message}`);

  const account = await readPaymentAccount(owner.ownerId);
  if (!account) throw new Error("the connected account was created but could not be read back");
  return account;
}

/**
 * A one-use link into Stripe's hosted onboarding. Both ways out come back to
 * the same route (app/api/payments/connect/return), which re-reads the account
 * from Stripe: "done" and "the link expired, start again" are told apart by
 * what Stripe then says, not by which URL was hit.
 */
export async function onboardingLink(stripeAccountId: string): Promise<string> {
  const returnUrl = appUrl(PAYMENTS_CONNECT_RETURN_PATH);
  const link = await stripeRequest<StripeAccountLink>("POST", "/account_links", {
    account: stripeAccountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: returnUrl,
  });
  return link.url;
}
