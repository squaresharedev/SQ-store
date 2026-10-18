// SERVER ONLY. The Payments page's REAL data: the seller's connected account,
// and what Stripe says is on it.
//
// lib/payments/mock.ts is the page's data layer and stays that way: it calls
// this when no simulated scenario is switched on, which is always in a
// deployed build. What comes back is the same PaymentsOverview shape either
// way, so the page cannot tell a simulated store from a real one.
//
// READ FROM STRIPE, ON THE SELLER'S ACCOUNT (the Stripe-Account header), never
// from our orders table: a balance and a payout are facts about the seller's
// Stripe, and Stripe is the only place they are true.
//
// BEST-EFFORT PAST THE ACCOUNT. Whether a seller is connected comes from our
// own row and always answers. The balance and payouts are a second question:
// when Stripe cannot be asked, the page shows the connection with empty lists
// rather than failing, and the log says why.
//
// NOT YET READ: the bank account on file (payoutMethod), which stays empty
// and is drawn as "nothing yet". Changing it happens in Stripe's own
// dashboard either way.

import {
  stripeRequest,
  type StripeBalance,
  type StripeBalanceTransaction,
  type StripeList,
  type StripePayout,
} from "@/lib/billing/stripe-api";
import { readPaymentAccount, type PaymentAccount } from "@/lib/payments/connect/account";
import { stripeConnectLive } from "@/lib/payments/connect/config";
import type {
  AccountStatus,
  BalanceTransaction,
  Payout,
  PayoutStatus,
  PaymentsOverview,
  TransactionType,
} from "@/lib/payments/types";

/** How many payouts, and how many ledger lines, the tab shows: a
 *  recent-activity view, not a ledger. */
const PAYOUT_LIMIT = 10;
const TRANSACTION_LIMIT = 10;

const NOT_CONNECTED: AccountStatus = {
  connected: false,
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  requirementsDue: [],
};

function statusOf(account: PaymentAccount | null): AccountStatus {
  if (!account) return NOT_CONNECTED;
  return {
    connected: true,
    accountId: account.stripeAccountId,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    requirementsDue: [],
  };
}

/** Where this seller's Stripe connection stands. Never throws. */
export async function realAccountStatus(ownerId: string | null): Promise<AccountStatus> {
  if (!ownerId || !stripeConnectLive()) return NOT_CONNECTED;
  return statusOf(await readPaymentAccount(ownerId));
}

const PAYOUT_STATUSES: readonly PayoutStatus[] = ["paid", "pending", "in_transit", "canceled", "failed"];
const seconds = (value: number) => new Date(value * 1000).toISOString();

function toPayout(payout: StripePayout): Payout {
  return {
    id: payout.id,
    amountCents: payout.amount,
    currency: payout.currency.toUpperCase(),
    status: PAYOUT_STATUSES.find((status) => status === payout.status) ?? "pending",
    arrivalDate: seconds(payout.arrival_date),
    createdAt: seconds(payout.created),
    method: payout.method === "instant" ? "instant" : "standard",
    // The bank account is not read yet (see NOT YET READ above).
    destinationLast4: "",
    automatic: payout.automatic === true,
    statementDescriptor: payout.statement_descriptor,
  };
}

/** Stripe's ledger types, as the few kinds the page draws. Anything it has no
 *  drawing for (a transfer, a reserve) is an adjustment. */
const TRANSACTION_TYPES: Record<string, TransactionType> = {
  charge: "charge",
  payment: "charge",
  refund: "refund",
  payment_refund: "refund",
  payout: "payout",
  stripe_fee: "stripe_fee",
};

function toTransaction(entry: StripeBalanceTransaction): BalanceTransaction {
  return {
    id: entry.id,
    type: TRANSACTION_TYPES[entry.type] ?? "adjustment",
    amountCents: entry.amount,
    feeCents: entry.fee,
    netCents: entry.net,
    currency: entry.currency.toUpperCase(),
    description: entry.description ?? "",
    createdAt: seconds(entry.created),
    status: entry.status === "available" ? "available" : "pending",
  };
}

/** Everything the Payments page shows, for this seller. Never throws. */
export async function realPaymentsOverview(ownerId: string | null): Promise<PaymentsOverview> {
  const empty: PaymentsOverview = {
    account: NOT_CONNECTED,
    balance: { available: [], pending: [] },
    upcomingPayout: null,
    payoutMethod: null,
    payouts: [],
    transactions: [],
  };
  if (!ownerId || !stripeConnectLive()) return empty;

  const account = await readPaymentAccount(ownerId);
  if (!account) return empty;
  const overview: PaymentsOverview = { ...empty, account: statusOf(account) };

  try {
    const on = { account: account.stripeAccountId };
    const [balance, payouts, transactions] = await Promise.all([
      stripeRequest<StripeBalance>("GET", "/balance", {}, on),
      stripeRequest<StripeList<StripePayout>>("GET", "/payouts", { limit: PAYOUT_LIMIT }, on),
      stripeRequest<StripeList<StripeBalanceTransaction>>(
        "GET",
        "/balance_transactions",
        { limit: TRANSACTION_LIMIT },
        on,
      ),
    ]);
    const money = (bucket: StripeBalance["available"]) =>
      bucket.map((entry) => ({ amountCents: entry.amount, currency: entry.currency.toUpperCase() }));
    overview.balance = { available: money(balance.available), pending: money(balance.pending) };
    overview.payouts = payouts.data.map(toPayout);
    overview.transactions = transactions.data.map(toTransaction);
  } catch (error) {
    console.error("[payments] could not read the account from Stripe:", error instanceof Error ? error.message : error);
  }
  return overview;
}
