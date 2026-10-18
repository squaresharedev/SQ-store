// SIMULATED payments data, built as a LEDGER so the figures reconcile the way
// Stripe's do: the balance is what the transactions add up to, a payout takes
// whatever had cleared by the day it was created, and a card sale only counts
// as available a few days after it was made. Pure and I/O-free: `now` is a
// parameter, so every date is relative to it (nothing goes stale) and a test
// can pin it.
//
// Used by ./mock.ts (the /payments tab, behind PAYMENTS_MOCK_DATA) and by the
// /dev/payments harness. Each scenario is a story the UI has to tell well:
// pick the one that exercises the state you are working on.

import { saleFee } from "@/lib/billing/fees";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import type {
  AccountStatus,
  Balance,
  BalanceTransaction,
  MoneyAmount,
  PaymentsOverview,
  Payout,
  PayoutMethod,
  PayoutStatus,
  TransactionType,
  UpcomingPayout,
} from "./types";

/** The stories on offer. `healthy` is what `PAYMENTS_MOCK_DATA=true` means. */
export const PAYMENTS_SCENARIOS = [
  "healthy",
  "busy",
  "new",
  "action-needed",
  "disconnected",
] as const;
export type PaymentsScenario = (typeof PAYMENTS_SCENARIOS)[number];

/** What each scenario is for, shown in the dev harness. */
export const PAYMENTS_SCENARIO_NOTES: Record<PaymentsScenario, string> = {
  healthy: "Connected, steady sales, weekly payouts, one in transit, one refund.",
  busy: "Two months of sales: every payout status, instant payout, USD pending, fees and adjustments, lists past their display limit.",
  new: "Just connected: bank on file, no sales, no payouts, every empty state.",
  "action-needed": "Stripe needs information: payouts disabled, money stuck in available, a failed payout, requirements due.",
  disconnected: "No Stripe account: what a seller sees before connecting.",
};

/** Days a card sale sits in pending before it becomes available. */
const CLEAR_DAYS = 3;
/** Days a standard payout takes to reach the bank. */
const TRANSIT_DAYS = 2;
/** How many rows the tab shows (it is a recent-activity view, not a ledger). */
const PAYOUT_LIMIT = 10;
const TRANSACTION_LIMIT = 12;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Stripe's card processing rate on top of the platform fee, in bps plus a flat cent amount. */
const PROCESSING_BPS = 150;
const PROCESSING_FLAT_CENTS = 25;

/** The sample seller's own plan, which sets the platform fee on each sale. */
const SELLER_PLAN = "starter";

const DESCRIPTOR = "SQUARESHARE PAYOUT";
const EUR = "EUR";
const USD = "USD";

type SaleSpec = {
  daysAgo: number;
  hour: number;
  title: string;
  amountCents: number;
  currency?: string;
  /** Days ago the whole sale was refunded; must be after the sale cleared. */
  refundedDaysAgo?: number;
};

type PayoutSpec = {
  daysAgo: number;
  hour: number;
  status: PayoutStatus;
  method?: "standard" | "instant";
};

/** A balance movement that is not a sale: a Stripe fee, a dispute, a correction. */
type ExtraSpec = {
  daysAgo: number;
  hour: number;
  type: Extract<TransactionType, "stripe_fee" | "adjustment">;
  description: string;
  amountCents: number;
};

type ScenarioSpec = {
  account: AccountStatus;
  method: PayoutMethod | null;
  sales: SaleSpec[];
  payouts: PayoutSpec[];
  extras: ExtraSpec[];
};

const ACCOUNT_ID = "acct_demo_2K9fLpQ";

const CONNECTED: AccountStatus = {
  connected: true,
  accountId: ACCOUNT_ID,
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  requirementsDue: [],
};

const METHOD: PayoutMethod = {
  id: "ba_demo_1XyzAb",
  type: "bank_account",
  bankName: "AIB",
  last4: "1234",
  currency: EUR,
  country: "IE",
  isDefault: true,
};

const PRODUCTS = [
  { title: "Riso print 'Night swim'", amountCents: 4500 },
  { title: "Ceramic mug", amountCents: 3800 },
  { title: "Sticker pack", amountCents: 900 },
  { title: "Linen tote", amountCents: 2400 },
  { title: "Roundhouse coffee table", amountCents: 48000 },
  { title: "Zine, issue 4", amountCents: 1200 },
  { title: "Enamel pin set", amountCents: 1800 },
  { title: "Screen print, A2", amountCents: 7200 },
];

/** A fixed pseudo-random sequence: the same sales every run, so screenshots and tests are stable. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Two months of sales, roughly one a day with gaps, the newest still pending. */
function busySales(): SaleSpec[] {
  const next = sequence(7);
  const sales: SaleSpec[] = [];
  for (let daysAgo = 58; daysAgo >= 0; daysAgo -= 1) {
    if (next() < 0.3) continue;
    const product = PRODUCTS[Math.floor(next() * PRODUCTS.length)];
    sales.push({
      daysAgo,
      hour: 8 + Math.floor(next() * 12),
      title: product.title,
      amountCents: product.amountCents,
    });
  }
  // One refund, once the sale it reverses had cleared.
  const refundable = sales.find((sale) => sale.daysAgo === 30) ?? sales.find((sale) => sale.daysAgo > 30);
  if (refundable) refundable.refundedDaysAgo = refundable.daysAgo - 5;
  // Two dollar sales, both too recent to have cleared: a second pending bucket.
  sales.push(
    { daysAgo: 1, hour: 10, title: "Screen print, A2 (US)", amountCents: 8600, currency: USD },
    { daysAgo: 0, hour: 9, title: "Zine, issue 4 (US)", amountCents: 1500, currency: USD },
  );
  return sales;
}

const SPECS: Record<PaymentsScenario, ScenarioSpec> = {
  healthy: {
    account: CONNECTED,
    method: METHOD,
    sales: [
      { daysAgo: 22, hour: 16, title: "Riso print 'Night swim'", amountCents: 4500 },
      { daysAgo: 20, hour: 11, title: "Ceramic mug (embed)", amountCents: 8100 },
      { daysAgo: 18, hour: 14, title: "Sticker pack", amountCents: 2500, refundedDaysAgo: 11 },
      { daysAgo: 15, hour: 9, title: "Linen tote", amountCents: 2400 },
      { daysAgo: 12, hour: 19, title: "Screen print, A2", amountCents: 7200 },
      { daysAgo: 9, hour: 13, title: "Zine, issue 4", amountCents: 1200 },
      { daysAgo: 6, hour: 17, title: "Enamel pin set", amountCents: 1800 },
      { daysAgo: 4, hour: 10, title: "Roundhouse coffee table", amountCents: 48000 },
      { daysAgo: 2, hour: 16, title: "Ceramic mug", amountCents: 3800 },
      { daysAgo: 1, hour: 11, title: "Riso print 'Night swim'", amountCents: 4500 },
      { daysAgo: 0, hour: 8, title: "Sticker pack", amountCents: 900 },
    ],
    payouts: [
      { daysAgo: 14, hour: 9, status: "paid" },
      { daysAgo: 7, hour: 9, status: "paid" },
      { daysAgo: 1, hour: 9, status: "in_transit" },
    ],
    extras: [],
  },

  busy: {
    account: CONNECTED,
    method: METHOD,
    sales: busySales(),
    payouts: [
      { daysAgo: 49, hour: 9, status: "paid" },
      { daysAgo: 42, hour: 9, status: "paid" },
      { daysAgo: 35, hour: 9, status: "canceled" },
      { daysAgo: 28, hour: 9, status: "paid" },
      { daysAgo: 21, hour: 9, status: "failed" },
      { daysAgo: 20, hour: 15, status: "paid", method: "instant" },
      { daysAgo: 14, hour: 9, status: "paid" },
      { daysAgo: 7, hour: 9, status: "paid" },
      // Sent yesterday, so it is still on its way: a standard payout lands two days on.
      { daysAgo: 1, hour: 9, status: "in_transit" },
      { daysAgo: 0, hour: 7, status: "pending" },
    ],
    extras: [
      { daysAgo: 40, hour: 12, type: "stripe_fee", description: "Stripe fee · instant payout", amountCents: -180 },
      { daysAgo: 26, hour: 10, type: "adjustment", description: "Adjustment · dispute fee", amountCents: -1500 },
      { daysAgo: 10, hour: 10, type: "adjustment", description: "Adjustment · dispute won, fee returned", amountCents: 1500 },
    ],
  },

  new: {
    account: CONNECTED,
    method: METHOD,
    sales: [],
    payouts: [],
    extras: [],
  },

  "action-needed": {
    account: {
      ...CONNECTED,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirementsDue: ["individual.verification.document", "external_account"],
    },
    method: METHOD,
    sales: [
      { daysAgo: 16, hour: 12, title: "Screen print, A2", amountCents: 7200 },
      { daysAgo: 12, hour: 15, title: "Roundhouse coffee table", amountCents: 48000 },
      { daysAgo: 8, hour: 10, title: "Ceramic mug", amountCents: 3800 },
      { daysAgo: 5, hour: 18, title: "Linen tote", amountCents: 2400 },
      { daysAgo: 1, hour: 14, title: "Riso print 'Night swim'", amountCents: 4500 },
    ],
    payouts: [{ daysAgo: 6, hour: 9, status: "failed" }],
    extras: [],
  },

  disconnected: {
    account: {
      connected: false,
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirementsDue: [],
    },
    method: null,
    sales: [],
    payouts: [],
    extras: [],
  },
};

/** The instant `daysAgo` days (and `hour` hours into that UTC day) before `now`. */
function at(now: Date, daysAgo: number, hour: number): Date {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * MS_PER_DAY;
  return new Date(day + hour * MS_PER_HOUR);
}

/** Like `at`, but never later than a minute ago: a "today at 9:00" event is not in the future at 8:00. */
function past(now: Date, daysAgo: number, hour: number): Date {
  return new Date(Math.min(at(now, daysAgo, hour).getTime(), now.getTime() - 60_000));
}

/** What Stripe and the platform keep from a sale: card processing plus the plan's fee. */
function feeOn(amountCents: number): number {
  const processing = Math.round((amountCents * PROCESSING_BPS) / 10_000) + PROCESSING_FLAT_CENTS;
  return processing + saleFee(PLAN_PRICE_SEED, SELLER_PLAN, amountCents).platformFeeCents;
}

/** The whole ledger of one currency, walked in time order. */
type CurrencyLedger = {
  transactions: BalanceTransaction[];
  payouts: Payout[];
  available: number;
  pending: number;
};

type Step =
  | { at: number; kind: "delta"; cents: number }
  | { at: number; kind: "payout"; spec: PayoutSpec };

function walkCurrency(
  spec: Pick<ScenarioSpec, "sales" | "payouts" | "extras">,
  currency: string,
  now: Date,
  ids: () => string,
): CurrencyLedger {
  const nowMs = now.getTime();
  const transactions: BalanceTransaction[] = [];
  const steps: Step[] = [];
  let pending = 0;

  for (const sale of spec.sales) {
    const madeAt = past(now, sale.daysAgo, sale.hour);
    const clearsAt = madeAt.getTime() + CLEAR_DAYS * MS_PER_DAY;
    const fee = feeOn(sale.amountCents);
    const net = sale.amountCents - fee;
    const cleared = clearsAt <= nowMs;
    transactions.push({
      id: `txn_demo_${ids()}`,
      type: "charge",
      amountCents: sale.amountCents,
      feeCents: fee,
      netCents: net,
      currency,
      description: `Sale · ${sale.title}`,
      createdAt: madeAt.toISOString(),
      status: cleared ? "available" : "pending",
    });
    if (cleared) steps.push({ at: clearsAt, kind: "delta", cents: net });
    else pending += net;

    if (sale.refundedDaysAgo !== undefined) {
      const refundedAt = past(now, sale.refundedDaysAgo, sale.hour);
      transactions.push({
        id: `txn_demo_${ids()}`,
        type: "refund",
        amountCents: -sale.amountCents,
        feeCents: 0,
        netCents: -sale.amountCents,
        currency,
        description: `Refund · ${sale.title}`,
        createdAt: refundedAt.toISOString(),
        status: "available",
      });
      steps.push({ at: refundedAt.getTime(), kind: "delta", cents: -sale.amountCents });
    }
  }

  for (const extra of spec.extras) {
    const when = past(now, extra.daysAgo, extra.hour);
    transactions.push({
      id: `txn_demo_${ids()}`,
      type: extra.type,
      amountCents: extra.amountCents,
      feeCents: 0,
      netCents: extra.amountCents,
      currency,
      description: extra.description,
      createdAt: when.toISOString(),
      status: "available",
    });
    steps.push({ at: when.getTime(), kind: "delta", cents: extra.amountCents });
  }

  for (const payout of spec.payouts) {
    steps.push({ at: past(now, payout.daysAgo, payout.hour).getTime(), kind: "payout", spec: payout });
  }

  // A balance change at the same instant as a payout lands first.
  steps.sort((a, b) => a.at - b.at || (a.kind === "delta" ? -1 : 1));

  let available = 0;
  const payouts: Payout[] = [];
  for (const step of steps) {
    if (step.kind === "delta") {
      available += step.cents;
      continue;
    }
    const sweep = Math.max(0, available);
    if (sweep === 0) continue;
    const createdAt = new Date(step.at);
    const method = step.spec.method ?? "standard";
    const arrival =
      method === "instant"
        ? createdAt
        : at(createdAt, -TRANSIT_DAYS, 0);
    payouts.push({
      id: `po_demo_${ids()}`,
      amountCents: sweep,
      currency,
      status: step.spec.status,
      arrivalDate: arrival.toISOString(),
      createdAt: createdAt.toISOString(),
      method,
      destinationLast4: METHOD.last4,
      automatic: method === "standard",
      statementDescriptor: DESCRIPTOR,
    });
    // A failed or canceled payout hands the money back; the next one retries it.
    if (step.spec.status !== "failed" && step.spec.status !== "canceled") {
      available -= sweep;
      transactions.push({
        id: `txn_demo_${ids()}`,
        type: "payout",
        amountCents: -sweep,
        feeCents: 0,
        netCents: -sweep,
        currency,
        description: `Payout to bank ····${METHOD.last4}`,
        createdAt: createdAt.toISOString(),
        status: "available",
      });
    }
  }

  return { transactions, payouts, available, pending };
}

/** A running counter for ids: short, unique, and nothing that looks like an account number. */
function idSource(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${n.toString(36).padStart(3, "0")}Qx`;
  };
}

function bucket(amountCents: number, currency: string): MoneyAmount[] {
  return amountCents === 0 ? [] : [{ amountCents, currency }];
}

/**
 * One scenario's whole overview, as `getPaymentsOverview` returns it.
 * `limits` exists so a test can read the full ledger instead of the tab's
 * recent-activity slice.
 */
export function buildScenario(
  scenario: PaymentsScenario,
  now: Date = new Date(),
  limits: { payouts?: number; transactions?: number } = {},
): PaymentsOverview {
  const spec = SPECS[scenario];
  const ids = idSource();
  const currencies = [EUR, USD];
  const ledgers = currencies.map((currency) => ({
    currency,
    ledger: walkCurrency(
      {
        sales: spec.sales.filter((sale) => (sale.currency ?? EUR) === currency),
        // Payouts and adjustments settle into the bank on file, which is euro.
        payouts: currency === EUR ? spec.payouts : [],
        extras: currency === EUR ? spec.extras : [],
      },
      currency,
      now,
      ids,
    ),
  }));

  const newestFirst = <T extends { createdAt: string }>(rows: T[]) =>
    [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const balance: Balance = {
    available: ledgers.flatMap(({ currency, ledger }) => bucket(ledger.available, currency)),
    pending: ledgers.flatMap(({ currency, ledger }) => bucket(ledger.pending, currency)),
  };

  const euro = ledgers[0].ledger;
  // Stripe sweeps the available balance on the next payout day; none while payouts are off.
  const upcomingPayout: UpcomingPayout =
    spec.account.payoutsEnabled && euro.available > 0
      ? { amountCents: euro.available, currency: EUR, expectedAt: at(now, -1, 0).toISOString() }
      : null;

  return {
    account: spec.account,
    balance,
    upcomingPayout,
    payoutMethod: spec.method,
    payouts: newestFirst(ledgers.flatMap(({ ledger }) => ledger.payouts)).slice(0, limits.payouts ?? PAYOUT_LIMIT),
    transactions: newestFirst(ledgers.flatMap(({ ledger }) => ledger.transactions)).slice(
      0,
      limits.transactions ?? TRANSACTION_LIMIT,
    ),
  };
}

/** Narrow an arbitrary string (an env value, a query param) to a scenario. */
export function parseScenario(value: string | null | undefined): PaymentsScenario | null {
  return (PAYMENTS_SCENARIOS as readonly string[]).includes(value ?? "")
    ? (value as PaymentsScenario)
    : null;
}
