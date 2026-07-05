// Stripe-shaped view types for the Payments tab. Field names and enums mirror
// the Stripe Connect objects (Account, Balance, Payout, ExternalAccount,
// BalanceTransaction) so wiring the real API later is a pure swap of the mock
// implementations in ./mock.ts — the UI never changes.
//
// SECURITY: these types can never carry full account/card numbers. The only
// identifying field anywhere is `last4`; everything else is status metadata.

/** One money bucket. Integer cents ALWAYS — never floats (see lib/format/money). */
export type MoneyAmount = {
  amountCents: number;
  currency: string;
};

/** Mirrors the relevant slice of Stripe's Account object. */
export type AccountStatus = {
  connected: boolean;
  /** Stripe account id, e.g. "acct_…" — safe to display, not a secret. */
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Outstanding Stripe onboarding requirements (empty when verified). */
  requirementsDue: string[];
};

/** Mirrors Stripe's Balance object (per-currency buckets). */
export type Balance = {
  available: MoneyAmount[];
  pending: MoneyAmount[];
};

export type PayoutStatus =
  | "paid"
  | "pending"
  | "in_transit"
  | "canceled"
  | "failed";

/** Mirrors Stripe's Payout object. */
export type Payout = {
  /** e.g. "po_…" */
  id: string;
  amountCents: number;
  currency: string;
  status: PayoutStatus;
  /** When the money lands (ISO date). */
  arrivalDate: string;
  createdAt: string;
  method: "standard" | "instant";
  /** Last4 of the destination bank account — the ONLY bank identifier kept. */
  destinationLast4: string;
  automatic: boolean;
  statementDescriptor: string | null;
};

/** Mirrors Stripe's ExternalAccount (bank_account) object — masked fields only. */
export type PayoutMethod = {
  /** e.g. "ba_…" */
  id: string;
  type: "bank_account" | "card";
  bankName: string;
  /** Last 4 digits only. Full numbers never exist in this app. */
  last4: string;
  currency: string;
  country: string;
  isDefault: boolean;
};

export type TransactionType =
  | "charge"
  | "refund"
  | "payout"
  | "stripe_fee"
  | "adjustment";

/** Mirrors Stripe's BalanceTransaction object. */
export type BalanceTransaction = {
  /** e.g. "txn_…" */
  id: string;
  type: TransactionType;
  /** Signed: charges positive, refunds/payouts/fees negative. */
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  description: string;
  createdAt: string;
  status: "available" | "pending";
};

/** The upcoming automatic payout, if one is scheduled. */
export type UpcomingPayout = {
  amountCents: number;
  currency: string;
  expectedAt: string;
} | null;

/** Everything the /payments page needs, fetched in one place. */
export type PaymentsOverview = {
  account: AccountStatus;
  balance: Balance;
  upcomingPayout: UpcomingPayout;
  payoutMethod: PayoutMethod | null;
  payouts: Payout[];
  transactions: BalanceTransaction[];
};
