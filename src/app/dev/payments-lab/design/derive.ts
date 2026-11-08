import type { BalanceTransaction } from "@/lib/payments/types";
import { labPhoto, splitDescription, type LabDay } from "../fixtures";

/** A range's totals, and the same for the range before it when the history reaches that far. */
export type RangeTotals = { earned: number; gross: number; sales: number; costs: number; paidOut: number };

export type RangeView = {
  days: LabDay[];
  previous: LabDay[] | null;
  now: RangeTotals;
  before: RangeTotals | null;
  /** Earnings adding up day by day over the range (and over the one before, for the dashed line). */
  cumulative: number[];
  cumulativeBefore: number[] | null;
};

function totals(days: LabDay[]): RangeTotals {
  return days.reduce(
    (sum, day) => ({
      earned: sum.earned + day.earned,
      gross: sum.gross + day.gross,
      sales: sum.sales + day.sales,
      costs: sum.costs + day.costs,
      paidOut: sum.paidOut + day.paidOut,
    }),
    { earned: 0, gross: 0, sales: 0, costs: 0, paidOut: 0 },
  );
}

const runningSum = (values: number[]) => {
  let sum = 0;
  return values.map((value) => (sum += value));
};

/** The last `range` days of the series, with the period before it. */
export function rangeView(all: LabDay[], range: number): RangeView {
  const days = all.slice(-range);
  const previous = all.length >= range * 2 ? all.slice(-range * 2, -range) : null;
  return {
    days,
    previous,
    now: totals(days),
    before: previous ? totals(previous) : null,
    cumulative: runningSum(days.map((day) => day.earned)),
    cumulativeBefore: previous ? runningSum(previous.map((day) => day.earned)) : null,
  };
}

/** What sold best over the days in view: name, photo, how many, and what it earned. */
export function topProducts(ledger: BalanceTransaction[], since: string, limit = 4) {
  const byName = new Map<string, { name: string; photo: string; count: number; earned: number }>();
  for (const txn of ledger) {
    if (txn.type !== "charge" || txn.createdAt < since || txn.currency !== "EUR") continue;
    const { name } = splitDescription(txn.description);
    const entry = byName.get(name) ?? { name, photo: labPhoto(name), count: 0, earned: 0 };
    entry.count += 1;
    entry.earned += txn.netCents;
    byName.set(name, entry);
  }
  return [...byName.values()].sort((a, b) => b.earned - a.earned).slice(0, limit);
}
