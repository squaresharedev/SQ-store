// MOCK data layer for the Payments tab. Every function is async and returns
// Stripe-shaped types (see ./types.ts) so the later Stripe Connect wiring is a
// drop-in body swap — callers and UI stay untouched.
//
// SECURITY INVARIANTS (hold these when wiring the real API too):
// - Only masked identifiers (last4) ever reach the client. No account numbers,
//   no routing numbers, no card PANs, no API keys or tokens.
// - Connecting / editing a payout account happens exclusively on Stripe's
//   HOSTED onboarding + Express dashboard, reached by redirect. This app never
//   renders a form that collects financial data.

import type {
  AccountStatus,
  Balance,
  BalanceTransaction,
  PaymentsOverview,
  Payout,
  PayoutMethod,
  UpcomingPayout,
} from "./types";

/** Flip to false to preview the not-connected onboarding state. */
const MOCK_CONNECTED = true;

const MOCK_ACCOUNT: AccountStatus = {
  connected: MOCK_CONNECTED,
  accountId: MOCK_CONNECTED ? "acct_demo_2K9fLpQ" : null,
  chargesEnabled: MOCK_CONNECTED,
  payoutsEnabled: MOCK_CONNECTED,
  detailsSubmitted: MOCK_CONNECTED,
  requirementsDue: [],
};

const MOCK_BALANCE: Balance = {
  available: [{ amountCents: 48250, currency: "EUR" }],
  pending: [{ amountCents: 12600, currency: "EUR" }],
};

const MOCK_UPCOMING: UpcomingPayout = {
  amountCents: 48250,
  currency: "EUR",
  expectedAt: "2026-07-08T00:00:00Z",
};

const MOCK_METHOD: PayoutMethod = {
  id: "ba_demo_1XyzAb",
  type: "bank_account",
  bankName: "AIB",
  last4: "1234",
  currency: "EUR",
  country: "IE",
  isDefault: true,
};

const MOCK_PAYOUTS: Payout[] = [
  {
    id: "po_demo_9QrTuV",
    amountCents: 32400,
    currency: "EUR",
    status: "in_transit",
    arrivalDate: "2026-07-06T00:00:00Z",
    createdAt: "2026-07-03T09:15:00Z",
    method: "standard",
    destinationLast4: "1234",
    automatic: true,
    statementDescriptor: "SQUARESHARE PAYOUT",
  },
  {
    id: "po_demo_7MnOpQ",
    amountCents: 51900,
    currency: "EUR",
    status: "paid",
    arrivalDate: "2026-06-29T00:00:00Z",
    createdAt: "2026-06-26T09:15:00Z",
    method: "standard",
    destinationLast4: "1234",
    automatic: true,
    statementDescriptor: "SQUARESHARE PAYOUT",
  },
  {
    id: "po_demo_5IjKlM",
    amountCents: 18750,
    currency: "EUR",
    status: "paid",
    arrivalDate: "2026-06-22T00:00:00Z",
    createdAt: "2026-06-19T09:15:00Z",
    method: "standard",
    destinationLast4: "1234",
    automatic: true,
    statementDescriptor: "SQUARESHARE PAYOUT",
  },
  {
    id: "po_demo_3EfGhI",
    amountCents: 9900,
    currency: "EUR",
    status: "failed",
    arrivalDate: "2026-06-15T00:00:00Z",
    createdAt: "2026-06-12T09:15:00Z",
    method: "standard",
    destinationLast4: "1234",
    automatic: true,
    statementDescriptor: "SQUARESHARE PAYOUT",
  },
];

const MOCK_TRANSACTIONS: BalanceTransaction[] = [
  {
    id: "txn_demo_8StUvW",
    type: "charge",
    amountCents: 4500,
    feeCents: 450,
    netCents: 4050,
    currency: "EUR",
    description: "Sale · Riso print 'Night swim'",
    createdAt: "2026-07-04T16:42:00Z",
    status: "pending",
  },
  {
    id: "txn_demo_6OpQrS",
    type: "charge",
    amountCents: 8100,
    feeCents: 810,
    netCents: 7290,
    currency: "EUR",
    description: "Sale · Ceramic mug (embed)",
    createdAt: "2026-07-03T11:08:00Z",
    status: "pending",
  },
  {
    id: "txn_demo_4KlMnO",
    type: "payout",
    amountCents: -32400,
    feeCents: 0,
    netCents: -32400,
    currency: "EUR",
    description: "Payout to bank ····1234",
    createdAt: "2026-07-03T09:15:00Z",
    status: "available",
  },
  {
    id: "txn_demo_2GhIjK",
    type: "refund",
    amountCents: -2500,
    feeCents: 0,
    netCents: -2500,
    currency: "EUR",
    description: "Refund · Sticker pack",
    createdAt: "2026-07-01T19:30:00Z",
    status: "available",
  },
];

/** TODO(stripe): replace with `stripe.accounts.retrieve(...)` for the seller. */
export async function getAccountStatus(): Promise<AccountStatus> {
  return MOCK_ACCOUNT;
}

/** TODO(stripe): replace with `stripe.balance.retrieve(...)` on the connected account. */
export async function getBalance(): Promise<Balance> {
  return MOCK_CONNECTED ? MOCK_BALANCE : { available: [], pending: [] };
}

/** TODO(stripe): derive from `stripe.payouts.list({ status: "pending" })` + schedule. */
export async function getUpcomingPayout(): Promise<UpcomingPayout> {
  return MOCK_CONNECTED ? MOCK_UPCOMING : null;
}

/** TODO(stripe): replace with `stripe.accounts.listExternalAccounts(...)`. */
export async function getPayoutMethod(): Promise<PayoutMethod | null> {
  return MOCK_CONNECTED ? MOCK_METHOD : null;
}

/** TODO(stripe): replace with `stripe.payouts.list(...)` on the connected account. */
export async function listPayouts(): Promise<Payout[]> {
  return MOCK_CONNECTED ? MOCK_PAYOUTS : [];
}

/** TODO(stripe): replace with `stripe.balanceTransactions.list(...)`. */
export async function listBalanceTransactions(): Promise<BalanceTransaction[]> {
  return MOCK_CONNECTED ? MOCK_TRANSACTIONS : [];
}

/** One fetch for the whole page. Swapping the functions above swaps this too. */
export async function getPaymentsOverview(): Promise<PaymentsOverview> {
  const [account, balance, upcomingPayout, payoutMethod, payouts, transactions] =
    await Promise.all([
      getAccountStatus(),
      getBalance(),
      getUpcomingPayout(),
      getPayoutMethod(),
      listPayouts(),
      listBalanceTransactions(),
    ]);
  return { account, balance, upcomingPayout, payoutMethod, payouts, transactions };
}
