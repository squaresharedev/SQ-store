// @vitest-environment node
/**
 * The simulated payments ledger must reconcile the way Stripe's does, or the
 * numbers on the tab prove nothing: balances are what the transactions add up
 * to, payouts sweep what had cleared, and every story shows what it claims to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeScenario, getAccountStatus, getPaymentsOverview } from "@/lib/payments/mock";
import {
  buildScenario,
  PAYMENTS_SCENARIOS,
  parseScenario,
  type PaymentsScenario,
} from "@/lib/payments/scenarios";

const NOW = new Date("2026-10-05T12:00:00Z");
const ALL = { payouts: Infinity, transactions: Infinity };
const full = (scenario: PaymentsScenario) => buildScenario(scenario, NOW, ALL);

const sum = (rows: { netCents: number }[]) => rows.reduce((total, row) => total + row.netCents, 0);
const bucketOf = (buckets: { amountCents: number; currency: string }[], currency: string) =>
  buckets.find((b) => b.currency === currency)?.amountCents ?? 0;

describe("simulated ledger reconciles", () => {
  for (const scenario of PAYMENTS_SCENARIOS) {
    it(`${scenario}: balances equal the transactions, per currency`, () => {
      const overview = full(scenario);
      for (const currency of ["EUR", "USD"]) {
        const rows = overview.transactions.filter((t) => t.currency === currency);
        expect(bucketOf(overview.balance.available, currency)).toBe(
          sum(rows.filter((t) => t.status === "available")),
        );
        expect(bucketOf(overview.balance.pending, currency)).toBe(
          sum(rows.filter((t) => t.status === "pending")),
        );
      }
    });

    it(`${scenario}: every row is internally consistent`, () => {
      const overview = full(scenario);
      for (const t of overview.transactions) {
        expect(t.netCents).toBe(t.amountCents - t.feeCents);
        expect(Number.isInteger(t.amountCents) && Number.isInteger(t.feeCents)).toBe(true);
        expect(new Date(t.createdAt).getTime()).toBeLessThan(NOW.getTime());
        if (t.type === "charge") expect(t.amountCents).toBeGreaterThan(0);
        else expect(t.feeCents).toBe(0);
      }
      for (const p of overview.payouts) {
        expect(p.amountCents).toBeGreaterThan(0);
        expect(new Date(p.createdAt).getTime()).toBeLessThan(NOW.getTime());
      }
    });
  }

  it("a paid or pending payout has a matching negative ledger row; failed and canceled do not", () => {
    const overview = full("busy");
    const payoutRows = overview.transactions.filter((t) => t.type === "payout");
    const moved = overview.payouts.filter((p) => p.status !== "failed" && p.status !== "canceled");
    const byAmount = (a: number, b: number) => a - b;
    expect(payoutRows.map((t) => -t.amountCents).sort(byAmount)).toEqual(
      moved.map((p) => p.amountCents).sort(byAmount),
    );
  });

  it("a payout still on its way is never overdue, and a paid one has landed", () => {
    for (const scenario of PAYMENTS_SCENARIOS) {
      for (const p of full(scenario).payouts) {
        const arrival = new Date(p.arrivalDate).getTime();
        if (p.status === "in_transit" || p.status === "pending") {
          expect(arrival, `${scenario} ${p.status}`).toBeGreaterThan(NOW.getTime());
        }
        if (p.status === "paid") expect(arrival, `${scenario} paid`).toBeLessThanOrEqual(NOW.getTime());
      }
    }
  });

  it("charges clear into available only after the clearing window", () => {
    const overview = full("healthy");
    const charges = overview.transactions.filter((t) => t.type === "charge");
    expect(charges.some((t) => t.status === "pending")).toBe(true);
    expect(charges.some((t) => t.status === "available")).toBe(true);
    for (const t of charges.filter((c) => c.status === "pending")) {
      expect(NOW.getTime() - new Date(t.createdAt).getTime()).toBeLessThan(3 * 86_400_000);
    }
  });

  it("dates move with `now`, so the data never goes stale", () => {
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    const a = buildScenario("healthy", NOW).transactions[0];
    const b = buildScenario("healthy", later).transactions[0];
    expect(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).toBe(30 * 86_400_000);
  });

  it("the tab shows a recent slice while the balance still counts everything", () => {
    const sliced = buildScenario("busy", NOW);
    expect(sliced.transactions.length).toBe(12);
    expect(sliced.payouts.length).toBe(10);
    expect(sliced.balance).toEqual(full("busy").balance);
  });
});

describe("each scenario tells its story", () => {
  it("healthy: connected with money moving and one refund", () => {
    const o = full("healthy");
    expect(o.account.connected && o.account.payoutsEnabled).toBe(true);
    expect(o.upcomingPayout?.amountCents).toBe(bucketOf(o.balance.available, "EUR"));
    expect(o.payouts.map((p) => p.status)).toEqual(["in_transit", "paid", "paid"]);
    expect(o.transactions.filter((t) => t.type === "refund")).toHaveLength(1);
  });

  it("busy: every payout status, an instant payout, every transaction type, two currencies", () => {
    const o = full("busy");
    expect(new Set(o.payouts.map((p) => p.status))).toEqual(
      new Set(["paid", "pending", "in_transit", "canceled", "failed"]),
    );
    expect(o.payouts.some((p) => p.method === "instant" && !p.automatic)).toBe(true);
    expect(new Set(o.transactions.map((t) => t.type))).toEqual(
      new Set(["charge", "refund", "payout", "stripe_fee", "adjustment"]),
    );
    expect(o.balance.pending.map((b) => b.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("new: connected with a bank and nothing else", () => {
    const o = buildScenario("new", NOW);
    expect(o.account.connected).toBe(true);
    expect(o.payoutMethod).not.toBeNull();
    expect(o.balance).toEqual({ available: [], pending: [] });
    expect(o.upcomingPayout).toBeNull();
    expect(o.payouts).toEqual([]);
    expect(o.transactions).toEqual([]);
  });

  it("action-needed: payouts off, requirements due, funds stuck, newest payout failed, none scheduled", () => {
    const o = full("action-needed");
    expect(o.account.payoutsEnabled).toBe(false);
    expect(o.account.requirementsDue.length).toBeGreaterThan(0);
    expect(bucketOf(o.balance.available, "EUR")).toBeGreaterThan(0);
    expect(o.payouts[0].status).toBe("failed");
    expect(o.upcomingPayout).toBeNull();
  });

  it("disconnected: nothing at all", () => {
    const o = buildScenario("disconnected", NOW);
    expect(o.account).toMatchObject({ connected: false, accountId: null });
    expect(o.payoutMethod).toBeNull();
    expect(o.transactions).toEqual([]);
  });

  it("carries no long digit runs that could pass for an account number", () => {
    for (const scenario of PAYMENTS_SCENARIOS) {
      const o = full(scenario);
      const identifiers = [
        o.account.accountId ?? "",
        o.payoutMethod?.id ?? "",
        ...o.payouts.map((p) => p.id),
        ...o.transactions.map((t) => t.id),
      ].join(" ");
      expect(identifiers).not.toMatch(/\d{8,}/);
    }
  });
});

describe("the flag and the ?mock= override", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off by default, and an override cannot turn it on", async () => {
    expect(activeScenario("busy")).toBeNull();
    expect((await getAccountStatus()).connected).toBe(false);
    expect((await getPaymentsOverview("busy")).payouts).toEqual([]);
  });

  it("`true` means healthy; a scenario name selects it; an override wins; junk is ignored", () => {
    vi.stubEnv("PAYMENTS_MOCK_DATA", "true");
    expect(activeScenario()).toBe("healthy");
    expect(activeScenario("busy")).toBe("busy");
    expect(activeScenario("nonsense")).toBe("healthy");
    vi.stubEnv("PAYMENTS_MOCK_DATA", "action-needed");
    expect(activeScenario()).toBe("action-needed");
    vi.stubEnv("PAYMENTS_MOCK_DATA", "false");
    expect(activeScenario("busy")).toBeNull();
  });

  it("is ignored in a production build, so a deployed app never shows invented money", async () => {
    vi.stubEnv("PAYMENTS_MOCK_DATA", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(activeScenario()).toBeNull();
    expect(activeScenario("busy")).toBeNull();
    expect((await getAccountStatus()).connected).toBe(false);
  });

  it("parseScenario narrows strings", () => {
    expect(parseScenario("busy")).toBe("busy");
    expect(parseScenario("nope")).toBeNull();
    expect(parseScenario(undefined)).toBeNull();
  });
});
