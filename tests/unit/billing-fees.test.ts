// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  breakEvenCents,
  cheapestPlanFor,
  monthlyCostCents,
  monthlyPriceCents,
  platformFeeCents,
  saleFee,
  yearlySavingCents,
} from "@/lib/billing/fees";
import { PLANS, PLAN_IDS } from "@/lib/billing/plans";

describe("platformFeeCents", () => {
  it("charges the rate on the subtotal, rounding half up to the cent", () => {
    expect(platformFeeCents(1000, 300)).toBe(30);
    // 3% of 1.99 is 5.97 cents: rounds to 6.
    expect(platformFeeCents(199, 300)).toBe(6);
    // 5% of 10 cents is exactly 0.5: half rounds up.
    expect(platformFeeCents(10, 500)).toBe(1);
    // 5% of 9 cents is 0.45: down.
    expect(platformFeeCents(9, 500)).toBe(0);
  });

  it("is never negative and never more than the sale", () => {
    expect(platformFeeCents(1000, 0)).toBe(0);
    expect(platformFeeCents(-50, 300)).toBe(0);
    expect(platformFeeCents(1000, 20_000)).toBe(1000);
    expect(platformFeeCents(1000, -5)).toBe(0);
  });

  it("stays exact on large amounts (integer maths, no float drift)", () => {
    expect(platformFeeCents(99_999_999, 100)).toBe(1_000_000);
  });
});

describe("saleFee", () => {
  it("snapshots the rate and the plan with the amount", () => {
    expect(saleFee("starter", 2500)).toEqual({ platformFeeCents: 75, platformFeeBps: 300, sellerPlan: "starter" });
    expect(saleFee("free", 2500).platformFeeBps).toBe(PLANS.free.feeBps);
  });
});

describe("monthly costs", () => {
  it("spreads a yearly price over twelve months", () => {
    expect(monthlyPriceCents("pro", "month")).toBe(PLANS.pro.priceCents.month);
    expect(monthlyPriceCents("pro", "year")).toBe(Math.round(PLANS.pro.priceCents.year / 12));
    expect(monthlyPriceCents("free", "year")).toBe(0);
  });

  it("adds the subscription and the fee on the month's sales", () => {
    const sales = 100_000;
    expect(monthlyCostCents("starter", "month", sales)).toBe(
      PLANS.starter.priceCents.month + platformFeeCents(sales, PLANS.starter.feeBps),
    );
  });
});

describe("breakEvenCents", () => {
  it("is where the dearer plan's lower fee has paid for its price", () => {
    for (const interval of ["month", "year"] as const) {
      for (let i = 0; i < PLAN_IDS.length - 1; i += 1) {
        const lower = PLAN_IDS[i]!;
        const upper = PLAN_IDS[i + 1]!;
        const at = breakEvenCents(lower, upper, interval);
        expect(at).not.toBeNull();
        // At the break-even the upper plan is no dearer; a euro below it, it is.
        expect(monthlyCostCents(upper, interval, at!)).toBeLessThanOrEqual(monthlyCostCents(lower, interval, at!));
        expect(monthlyCostCents(upper, interval, at! - 100)).toBeGreaterThan(monthlyCostCents(lower, interval, at! - 100));
      }
    }
  });

  it("is null when the other plan's fee is not lower", () => {
    expect(breakEvenCents("pro", "free", "month")).toBeNull();
  });
});

describe("cheapestPlanFor", () => {
  it("recommends Free to a shop with no sales, and never a subscription that saves nothing", () => {
    expect(cheapestPlanFor(0, "month")).toBe("free");
  });

  it("agrees with the break-even points", () => {
    const toStarter = breakEvenCents("free", "starter", "month")!;
    const toPro = breakEvenCents("starter", "pro", "month")!;
    const freeToPro = breakEvenCents("free", "pro", "month")!;
    // Pro's own crossover with Free comes before Starter's with Pro, so between
    // Free->Pro and Starter->Pro the answer depends on which is lower overall.
    expect(cheapestPlanFor(Math.min(toStarter, freeToPro) - 100, "month")).toBe("free");
    expect(cheapestPlanFor(Math.max(toPro, freeToPro) + 100_000, "month")).toBe("pro");
  });
});

describe("yearlySavingCents", () => {
  it("is what twelve monthly payments cost over the yearly price", () => {
    for (const plan of PLAN_IDS) {
      const { month, year } = PLANS[plan].priceCents;
      expect(yearlySavingCents(plan)).toBe(Math.max(0, month * 12 - year));
    }
  });
});
