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
//
// MOCK FLAG. Set PAYMENTS_MOCK_DATA in the environment to enable simulated
// account, balance, payout and transaction data (the stories live in
// ./scenarios.ts):
//   PAYMENTS_MOCK_DATA=true       the `healthy` scenario
//   PAYMENTS_MOCK_DATA=<scenario> that scenario (busy, new, action-needed, ...)
// With the flag on, /payments?mock=<scenario> switches story per request.
// Off by default so a real seller never sees fabricated financial figures as
// if they were their own, and IGNORED IN A PRODUCTION BUILD whatever it is set
// to: a deployed Worker with the variable left on would otherwise show every
// seller invented balances. The /payments page and the overview's Needs-attention
// module both read from getAccountStatus(), so the two can never disagree
// about whether Stripe is connected.

import { getActiveAccount } from "@/lib/team/account-context";
import { realAccountStatus, realPaymentsOverview } from "@/lib/payments/connect/overview";
import {
  buildScenario,
  parseScenario,
  type PaymentsScenario,
} from "./scenarios";
import type {
  AccountStatus,
  Balance,
  BalanceTransaction,
  PaymentsOverview,
  Payout,
  PayoutMethod,
  UpcomingPayout,
} from "./types";

/** What PAYMENTS_MOCK_DATA=true stands for. */
const DEFAULT_SCENARIO: PaymentsScenario = "healthy";

/**
 * The scenario to simulate, or null for the real (empty, disconnected) state.
 * Reads the flag at call time (not at import time) so tests can stub
 * `process.env.PAYMENTS_MOCK_DATA` with `vi.stubEnv()` without needing to
 * reset and re-import the module. `override` (the page's ?mock= param) only
 * counts while the flag is on, so it can never turn data on by itself.
 * Never in a production build: see MOCK FLAG above.
 */
export function activeScenario(override?: string | null): PaymentsScenario | null {
  if (process.env.NODE_ENV === "production") return null;
  const flag = process.env.PAYMENTS_MOCK_DATA;
  if (!flag || flag === "false") return null;
  return parseScenario(override) ?? parseScenario(flag) ?? DEFAULT_SCENARIO;
}

/** The overview for the active scenario, or the real empty one. */
function overviewFor(override?: string | null): PaymentsOverview {
  return buildScenario(activeScenario(override) ?? "disconnected");
}

/**
 * Where the ACTIVE store's Stripe connection stands. The simulated scenario's
 * when one is switched on (development only), otherwise the real one, from the
 * store's own connected account (lib/payments/connect/overview.ts).
 */
export async function getAccountStatus(): Promise<AccountStatus> {
  if (activeScenario()) return overviewFor().account;
  return realAccountStatus((await getActiveAccount())?.accountId ?? null);
}

/** TODO(stripe): replace with `stripe.balance.retrieve(...)` on the connected account. */
export async function getBalance(): Promise<Balance> {
  return overviewFor().balance;
}

/** TODO(stripe): derive from `stripe.payouts.list({ status: "pending" })` + schedule. */
export async function getUpcomingPayout(): Promise<UpcomingPayout> {
  return overviewFor().upcomingPayout;
}

/** TODO(stripe): replace with `stripe.accounts.listExternalAccounts(...)`. */
export async function getPayoutMethod(): Promise<PayoutMethod | null> {
  return overviewFor().payoutMethod;
}

/** TODO(stripe): replace with `stripe.payouts.list(...)` on the connected account. */
export async function listPayouts(): Promise<Payout[]> {
  // TODO(notifications:payment): when the Stripe `payout.failed` webhook fires,
  // notify the seller. The producer belongs in the webhook handler (which knows
  // the seller's user id):
  //   await createNotification({ userId: sellerId, type: "payment",
  //     title: "A payout failed", body: "Your bank rejected a payout. Check your details.",
  //     data: { href: "/payments" } });
  // (from "@/lib/notifications/create"). Not wired: payouts are still mock data.
  return overviewFor().payouts;
}

/** TODO(stripe): replace with `stripe.balanceTransactions.list(...)`. */
export async function listBalanceTransactions(): Promise<BalanceTransaction[]> {
  return overviewFor().transactions;
}

/**
 * One fetch for the whole page. Swapping the functions above swaps this too.
 * `scenario` is the page's ?mock= param; the real implementation ignores it.
 */
export async function getPaymentsOverview(scenario?: string | null): Promise<PaymentsOverview> {
  if (activeScenario(scenario)) return overviewFor(scenario);
  return realPaymentsOverview((await getActiveAccount())?.accountId ?? null);
}
