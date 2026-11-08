// @vitest-environment node
/**
 * The Payments tab's earnings chart and trend tiles read the ledger day by
 * day. Those figures must reconcile with the ledger they come from, stay in
 * one currency, and never compare against a period nobody saw.
 */
import { describe, expect, it } from "vitest";
import {
  buildHistory,
  earnedOn,
  HISTORY_DAYS,
  isQuiet,
  PAYMENTS_RANGES,
  rangeView,
  shiftDay,
  utcDay,
} from "@/lib/payments/history";
import { buildScenario, PAYMENTS_SCENARIOS } from "@/lib/payments/scenarios";
import type { BalanceTransaction } from "@/lib/payments/types";

const NOW = new Date("2026-11-07T12:00:00Z");
const TODAY = utcDay(NOW);

let next = 0;
function row(partial: Partial<BalanceTransaction> & Pick<BalanceTransaction, "type" | "amountCents">): BalanceTransaction {
  next += 1;
  const feeCents = partial.feeCents ?? 0;
  return {
    id: `txn_test_${next}`,
    feeCents,
    netCents: partial.amountCents - feeCents,
    currency: "EUR",
    description: "",
    createdAt: NOW.toISOString(),
    status: "available",
    ...partial,
  };
}
const daysAgo = (days: number, hour = 10) => `${shiftDay(TODAY, -days)}T${String(hour).padStart(2, "0")}:00:00Z`;

describe("buildHistory", () => {
  it("covers HISTORY_DAYS days, oldest first, today last", () => {
    const history = buildHistory([], NOW, { fallbackCurrency: "EUR" });
    expect(history.days).toHaveLength(HISTORY_DAYS);
    expect(history.days.at(-1)?.day).toBe(TODAY);
    expect(history.days[0].day).toBe(shiftDay(TODAY, -(HISTORY_DAYS - 1)));
    expect(HISTORY_DAYS).toBe(Math.max(...PAYMENTS_RANGES) * 2);
    expect(isQuiet(history.days)).toBe(true);
  });

  it("files each movement under its day: a sale's fee and a refund are costs, a payout is paid out", () => {
    const history = buildHistory(
      [
        row({ type: "charge", amountCents: 4500, feeCents: 300, createdAt: daysAgo(2) }),
        row({ type: "charge", amountCents: 1000, feeCents: 100, createdAt: daysAgo(2, 15) }),
        row({ type: "refund", amountCents: -1000, createdAt: daysAgo(1) }),
        row({ type: "stripe_fee", amountCents: -180, createdAt: daysAgo(1) }),
        row({ type: "adjustment", amountCents: 1500, createdAt: daysAgo(1) }),
        row({ type: "payout", amountCents: -3000, createdAt: daysAgo(0) }),
        // A payout that bounced comes back as a positive payout movement.
        row({ type: "payout", amountCents: 3000, createdAt: daysAgo(0, 11) }),
        row({ type: "payout", amountCents: -2500, createdAt: daysAgo(0, 12) }),
      ],
      NOW,
      { fallbackCurrency: "EUR" },
    );
    const [twoDaysAgo, yesterday, today] = history.days.slice(-3);
    expect(twoDaysAgo).toMatchObject({ grossCents: 5500, sales: 2, costsCents: 400, paidOutCents: 0 });
    expect(yesterday).toMatchObject({ grossCents: 0, sales: 0, costsCents: 1000 + 180 - 1500, paidOutCents: 0 });
    expect(today).toMatchObject({ grossCents: 0, sales: 0, costsCents: 0, paidOutCents: 2500 });
    expect(earnedOn(twoDaysAgo)).toBe(5500 - 400);
  });

  it("charts the main currency by value and flags, never adds, the others", () => {
    const history = buildHistory(
      [
        row({ type: "charge", amountCents: 900, currency: "EUR", createdAt: daysAgo(3) }),
        row({ type: "charge", amountCents: 900, currency: "EUR", createdAt: daysAgo(2) }),
        row({ type: "charge", amountCents: 5000, currency: "USD", createdAt: daysAgo(1) }),
      ],
      NOW,
      { fallbackCurrency: "EUR" },
    );
    expect(history.currency).toBe("USD");
    expect(history.otherCurrencies).toBe(true);
    expect(history.days.reduce((sum, day) => sum + day.grossCents, 0)).toBe(5000);
  });

  it("falls back to the given currency when nothing has sold", () => {
    expect(buildHistory([], NOW, { fallbackCurrency: "EUR" }).currency).toBe("EUR");
  });

  it("leaves out days before `from`, and anything outside the window", () => {
    const from = shiftDay(TODAY, -9);
    const history = buildHistory(
      [
        row({ type: "charge", amountCents: 700, createdAt: daysAgo(20) }),
        row({ type: "charge", amountCents: 800, createdAt: daysAgo(HISTORY_DAYS + 5) }),
        row({ type: "charge", amountCents: 900, createdAt: daysAgo(3) }),
      ],
      NOW,
      { fallbackCurrency: "EUR", from },
    );
    expect(history.days).toHaveLength(10);
    expect(history.days[0].day).toBe(from);
    expect(history.days.reduce((sum, day) => sum + day.grossCents, 0)).toBe(900);
  });
});

describe("rangeView", () => {
  const history = buildHistory(
    [
      row({ type: "charge", amountCents: 2000, feeCents: 200, createdAt: daysAgo(10) }),
      row({ type: "charge", amountCents: 3000, feeCents: 300, createdAt: daysAgo(3) }),
      row({ type: "payout", amountCents: -1800, createdAt: daysAgo(2) }),
    ],
    NOW,
    { fallbackCurrency: "EUR" },
  );

  it("totals the period, and its running line ends on that total", () => {
    const view = rangeView(history, 7);
    expect(view.days).toHaveLength(7);
    expect(view.totals).toEqual({ grossCents: 3000, sales: 1, costsCents: 300, paidOutCents: 1800, earnedCents: 2700 });
    expect(view.earnedRunning.at(-1)).toBe(view.totals.earnedCents);
  });

  it("compares with the period before when something happened in it", () => {
    const view = rangeView(history, 7);
    expect(view.before?.earnedCents).toBe(1800);
    expect(view.earnedRunningBefore).toHaveLength(7);
    expect(view.earnedRunningBefore?.at(-1)).toBe(1800);
  });

  it("does not compare with a period in which nothing happened", () => {
    const view = rangeView(history, 30);
    expect(view.before).toBeNull();
    expect(view.earnedRunningBefore).toBeNull();
  });

  it("does not compare with a period the ledger was not read back to", () => {
    const short = buildHistory([row({ type: "charge", amountCents: 500, createdAt: daysAgo(1) })], NOW, {
      fallbackCurrency: "EUR",
      from: shiftDay(TODAY, -10),
    });
    expect(rangeView(short, 7).before).toBeNull();
    expect(rangeView(short, 30).days).toHaveLength(11);
  });
});

describe("the simulated stories carry a history", () => {
  it("reconciles with the full ledger: gross less costs is the net of everything but payouts", () => {
    const overview = buildScenario("busy", NOW);
    const ledger = buildScenario("busy", NOW, { payouts: Infinity, transactions: Infinity }).transactions;
    const history = overview.history!;
    const euro = ledger.filter((t) => t.currency === history.currency);
    const earned = history.days.reduce((sum, day) => sum + earnedOn(day), 0);
    const paidOut = history.days.reduce((sum, day) => sum + day.paidOutCents, 0);
    expect(earned).toBe(euro.filter((t) => t.type !== "payout").reduce((sum, t) => sum + t.netCents, 0));
    expect(paidOut).toBe(-euro.filter((t) => t.type === "payout").reduce((sum, t) => sum + t.netCents, 0));
    // Busy also sells in dollars, which the chart says it leaves out.
    expect(history.currency).toBe("EUR");
    expect(history.otherCurrencies).toBe(true);
  });

  it("is null without a connected account, and quiet for a store that has not sold", () => {
    for (const scenario of PAYMENTS_SCENARIOS) {
      const overview = buildScenario(scenario, NOW);
      if (!overview.account.connected) expect(overview.history).toBeNull();
      else expect(overview.history?.days).toHaveLength(HISTORY_DAYS);
    }
    expect(isQuiet(buildScenario("new", NOW).history!.days)).toBe(true);
  });
});
