// THE LEDGER DAY BY DAY, for the Payments tab's earnings chart and trend
// tiles. Pure and I/O-free: the simulated stories (./scenarios.ts) and the
// real Stripe read (./connect/overview.ts) both hand it balance transactions
// and get the same shape back, so the page cannot tell one from the other.
//
// EARNED IS WHAT REACHED THE BALANCE: gross sales minus what came off them
// (the fees on each sale, refunds, Stripe's own fees, corrections). A payout
// is not a cost, it is the balance leaving for the bank, so it is counted on
// its own. The figures reconcile: gross - costs = earned.
//
// ONE CURRENCY. A chart has one scale. The store's main currency is the one
// most of its sales are in; money in any other is flagged, never converted.

import { runningTotal } from "@/lib/series";
import type { BalanceTransaction, PaymentsDay, PaymentsHistory } from "./types";

/** The periods the tab offers, in days. */
export const PAYMENTS_RANGES = [7, 30, 90] as const;
export type PaymentsRange = (typeof PAYMENTS_RANGES)[number];

/** The period the tab opens on. */
export const DEFAULT_PAYMENTS_RANGE: PaymentsRange = 30;

/** How far back the history reaches: the longest period and the one before it. */
export const HISTORY_DAYS = Math.max(...PAYMENTS_RANGES) * 2;

const MS_PER_DAY = 86_400_000;

/** The UTC day an instant falls on, as "YYYY-MM-DD". */
export const utcDay = (instant: Date | string): string => new Date(instant).toISOString().slice(0, 10);

/** The day `days` after a "YYYY-MM-DD" day (before it, when negative). */
export const shiftDay = (day: string, days: number): string =>
  utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY));

/** The currency most of these sales are in, by value; `fallback` when there are none. */
function mainCurrency(rows: BalanceTransaction[], fallback: string): string {
  const gross = new Map<string, number>();
  for (const row of rows) {
    if (row.type === "charge") gross.set(row.currency, (gross.get(row.currency) ?? 0) + row.amountCents);
  }
  let main = fallback;
  let most = 0;
  for (const [currency, cents] of gross) {
    if (cents > most) {
      main = currency;
      most = cents;
    }
  }
  return main;
}

/**
 * The last HISTORY_DAYS days of the ledger, today included. `from` starts it
 * later, when the ledger was only read back that far (see connect/overview):
 * a day that was not read is left out rather than drawn as a quiet one.
 */
export function buildHistory(
  transactions: BalanceTransaction[],
  now: Date,
  options: { fallbackCurrency: string; from?: string | null },
): PaymentsHistory {
  const today = utcDay(now);
  const windowStart = shiftDay(today, -(HISTORY_DAYS - 1));
  const from = options.from && options.from > windowStart ? options.from : windowStart;
  const inWindow = transactions.filter((row) => {
    const day = utcDay(row.createdAt);
    return day >= from && day <= today;
  });
  const currency = mainCurrency(inWindow, options.fallbackCurrency);

  const days: PaymentsDay[] = [];
  const byDay = new Map<string, PaymentsDay>();
  for (let day = from; day <= today; day = shiftDay(day, 1)) {
    const entry: PaymentsDay = { day, grossCents: 0, sales: 0, costsCents: 0, paidOutCents: 0 };
    days.push(entry);
    byDay.set(day, entry);
  }

  let otherCurrencies = false;
  for (const row of inWindow) {
    const entry = byDay.get(utcDay(row.createdAt));
    if (!entry) continue;
    if (row.currency !== currency) {
      otherCurrencies = true;
      continue;
    }
    if (row.type === "charge") {
      entry.grossCents += row.amountCents;
      entry.sales += 1;
      entry.costsCents += row.feeCents;
    } else if (row.type === "payout") {
      entry.paidOutCents -= row.netCents;
    } else {
      entry.costsCents -= row.netCents;
    }
  }
  return { currency, days, otherCurrencies };
}

/** A period's figures. `earnedCents` is gross less costs. */
export type PaymentsTotals = {
  grossCents: number;
  sales: number;
  costsCents: number;
  paidOutCents: number;
  earnedCents: number;
};

export type PaymentsRangeView = {
  /** The period's days, oldest first. */
  days: PaymentsDay[];
  totals: PaymentsTotals;
  /** The same figures for the period before. Null when the history does not
   *  reach back that far or nothing at all happened in it: a store that did
   *  not exist yet is not a store that earned nothing. */
  before: PaymentsTotals | null;
  /** Earnings adding up day by day, and the same over the period before. */
  earnedRunning: number[];
  earnedRunningBefore: number[] | null;
};

export const earnedOn = (day: PaymentsDay): number => day.grossCents - day.costsCents;

/** Whether nothing at all happened on these days. */
export const isQuiet = (days: PaymentsDay[]): boolean =>
  days.every((day) => day.sales === 0 && day.costsCents === 0 && day.paidOutCents === 0);

function totalsOf(days: PaymentsDay[]): PaymentsTotals {
  const totals = { grossCents: 0, sales: 0, costsCents: 0, paidOutCents: 0, earnedCents: 0 };
  for (const day of days) {
    totals.grossCents += day.grossCents;
    totals.sales += day.sales;
    totals.costsCents += day.costsCents;
    totals.paidOutCents += day.paidOutCents;
    totals.earnedCents += earnedOn(day);
  }
  return totals;
}

/** The last `range` days of the history, against the `range` days before them. */
export function rangeView(history: PaymentsHistory, range: PaymentsRange): PaymentsRangeView {
  const days = history.days.slice(-range);
  const previous = history.days.length >= range * 2 ? history.days.slice(-range * 2, -range) : [];
  const compared = previous.length > 0 && !isQuiet(previous);
  return {
    days,
    totals: totalsOf(days),
    before: compared ? totalsOf(previous) : null,
    earnedRunning: runningTotal(days.map(earnedOn)),
    earnedRunningBefore: compared ? runningTotal(previous.map(earnedOn)) : null,
  };
}
