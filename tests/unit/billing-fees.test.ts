// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  breakEvenCents,
  cheapestPlanFor,
  directFeeBps,
  intervalListPriceCents,
  intervalPriceCents,
  launchDiscountPercent,
  monthlyCostCents,
  monthlyListPriceCents,
  monthlyPriceCents,
  noSaleFee,
  planPrice,
  saleFee,
  soldIntervals,
  yearlyFreeMonths,
  yearlySavingCents,
  type PlanPrices,
} from "@/lib/billing/fees";
import { PAID_PLAN_IDS, PLAN_IDS } from "@/lib/billing/plans";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { feeCents, type PlanPrice } from "@/lib/pricing";

// The arithmetic on a set of plan prices. Nothing here knows a price of its
// own: every figure is worked out from the rows it is handed, which is what
// lets a row changed in the database change every page.

const SEED: PlanPrices = PLAN_PRICE_SEED;
const seeded = (plan: (typeof PLAN_IDS)[number]): PlanPrice => planPrice(SEED, plan);

/** The seed plus a yearly row per paid plan at ten months' price. */
const WITH_YEARLY: PlanPrices = [
  ...SEED,
  ...PAID_PLAN_IDS.map((plan) => ({
    ...seeded(plan),
    interval: "year" as const,
    priceCents: seeded(plan).priceCents * 10,
    stripeLookupKey: `${plan}_year_eur_v1`,
  })),
];

/** Starter on a launch price: EUR 12 charged, EUR 15 regular (150 a year). */
const WITH_LAUNCH: PlanPrices = WITH_YEARLY.map((price) =>
  price.planId === "starter"
    ? { ...price, listPriceCents: price.interval === "year" ? 15_000 : 1500 }
    : price,
);

describe("saleFee", () => {
  it("snapshots the rate and the plan with every part of the fee", () => {
    expect(saleFee(SEED, "starter", 2500)).toEqual({
      sellerPlan: "starter",
      platformFeeBps: 200,
      platformFeeCents: 50,
      adRateBps: null,
      adFeeCents: 0,
      applicationFeeCents: 50,
      feeCapped: false,
    });
    expect(saleFee(SEED, "free", 2500).platformFeeBps).toBe(directFeeBps(SEED, "free"));
  });

  it("charges the plan's marketplace fee on a sale the marketplace brought", () => {
    expect(saleFee(SEED, "starter", 2500, { origin: "marketplace" })).toMatchObject({
      platformFeeBps: 700,
      platformFeeCents: 175,
      applicationFeeCents: 175,
    });
  });

  it("charges a waived seller nothing, and a free order nothing, without refusing either", () => {
    expect(saleFee(SEED, "pro", 2500, { feeWaiver: true })).toEqual(noSaleFee("pro"));
    // computeFees refuses an amount of nothing; an order of nothing never reaches it.
    expect(saleFee(SEED, "free", 0)).toEqual(noSaleFee("free"));
  });

  it("follows the rows it is handed, not a number of its own", () => {
    const dearer = SEED.map((price) => (price.planId === "free" ? { ...price, directFeeBps: 650 } : price));
    expect(saleFee(dearer, "free", 2500).platformFeeCents).toBe(163);
  });
});

describe("planPrice", () => {
  it("answers with the monthly row for a plan not sold by the year", () => {
    expect(planPrice(SEED, "pro", "year").interval).toBe("month");
    expect(planPrice(WITH_YEARLY, "pro", "year").interval).toBe("year");
  });

  it("throws rather than invent a price for a plan with none", () => {
    expect(() => planPrice(SEED.filter((price) => price.planId !== "pro"), "pro")).toThrow(/no price in force/);
  });
});

describe("soldIntervals", () => {
  it("sells monthly only, until every paid plan has a yearly price", () => {
    expect(soldIntervals(SEED)).toEqual(["month"]);
    expect(soldIntervals(WITH_YEARLY)).toEqual(["month", "year"]);
    // One plan priced yearly and not the other compares nothing.
    expect(soldIntervals(WITH_YEARLY.filter((p) => !(p.planId === "pro" && p.interval === "year")))).toEqual(["month"]);
  });
});

describe("monthly costs", () => {
  it("spreads a yearly price over twelve months", () => {
    expect(monthlyPriceCents(WITH_YEARLY, "pro", "month")).toBe(3900);
    expect(monthlyPriceCents(WITH_YEARLY, "pro", "year")).toBe(Math.round(39_000 / 12));
    expect(intervalPriceCents(WITH_YEARLY, "pro", "year")).toBe(39_000);
    expect(monthlyPriceCents(WITH_YEARLY, "free", "year")).toBe(0);
  });

  it("adds the subscription and the fee on the month's sales", () => {
    const sales = 100_000;
    expect(monthlyCostCents(SEED, "starter", "month", sales)).toBe(1200 + feeCents(sales, 200));
    expect(monthlyCostCents(SEED, "free", "month", sales)).toBe(5000);
  });
});

describe("breakEvenCents", () => {
  it("is where the dearer plan's lower fee has paid for its price", () => {
    for (const interval of soldIntervals(WITH_YEARLY)) {
      for (let i = 0; i < PLAN_IDS.length - 1; i += 1) {
        const lower = PLAN_IDS[i]!;
        const upper = PLAN_IDS[i + 1]!;
        const at = breakEvenCents(WITH_YEARLY, lower, upper, interval);
        expect(at).not.toBeNull();
        // At the break-even the upper plan is no dearer; a euro below it, it is.
        expect(monthlyCostCents(WITH_YEARLY, upper, interval, at!)).toBeLessThanOrEqual(
          monthlyCostCents(WITH_YEARLY, lower, interval, at!),
        );
        expect(monthlyCostCents(WITH_YEARLY, upper, interval, at! - 100)).toBeGreaterThan(
          monthlyCostCents(WITH_YEARLY, lower, interval, at! - 100),
        );
      }
    }
  });

  it("puts Starter's at EUR 400 a month and Pro's at EUR 1 800", () => {
    // 12 / (5% - 2%), and (39 - 12) / (2% - 0.5%).
    expect(breakEvenCents(SEED, "free", "starter", "month")).toBe(40_000);
    expect(breakEvenCents(SEED, "starter", "pro", "month")).toBe(180_000);
  });

  it("is null when the other plan's fee is not lower", () => {
    expect(breakEvenCents(SEED, "pro", "free", "month")).toBeNull();
  });
});

describe("the upgrade hint", () => {
  it("is what the plan above would have saved at the store's own sales", () => {
    const saved = (sales: number) =>
      monthlyCostCents(SEED, "free", "month", sales) - monthlyCostCents(SEED, "starter", "month", sales);
    // EUR 1 000 of sales: 50 in fees on Free against 12 + 20 on Starter.
    expect(saved(100_000)).toBe(1800);
    // Above EUR 400 it saves something; at EUR 400 exactly, nothing.
    expect(saved(50_000)).toBe(300);
    expect(saved(40_000)).toBe(0);
    expect(saved(30_000)).toBeLessThan(0);
  });
});

describe("cheapestPlanFor", () => {
  it("recommends Free to a shop with no sales, and never a subscription that saves nothing", () => {
    expect(cheapestPlanFor(SEED, 0, "month")).toBe("free");
    expect(cheapestPlanFor(SEED, 40_000, "month")).toBe("free");
  });

  it("agrees with the break-even points", () => {
    const toStarter = breakEvenCents(SEED, "free", "starter", "month")!;
    const toPro = breakEvenCents(SEED, "starter", "pro", "month")!;
    expect(cheapestPlanFor(SEED, toStarter - 100, "month")).toBe("free");
    expect(cheapestPlanFor(SEED, toStarter + 100, "month")).toBe("starter");
    expect(cheapestPlanFor(SEED, toPro + 100, "month")).toBe("pro");
  });
});

describe("yearly billing", () => {
  it("is what twelve monthly payments cost over the yearly price", () => {
    for (const plan of PAID_PLAN_IDS) {
      const month = intervalPriceCents(WITH_YEARLY, plan, "month");
      expect(yearlySavingCents(WITH_YEARLY, plan)).toBe(month * 2);
    }
    expect(yearlySavingCents(WITH_YEARLY, "free")).toBe(0);
  });

  it("gives every paid plan the months the Yearly chip promises", () => {
    // "2 months free" is said once, beside the toggle, so it has to be true
    // of each paid plan, not of the best one.
    expect(yearlyFreeMonths(WITH_YEARLY)).toBe(2);
    const stingy = WITH_YEARLY.map((price) =>
      price.planId === "pro" && price.interval === "year" ? { ...price, priceCents: 3900 * 11 } : price,
    );
    expect(yearlyFreeMonths(stingy)).toBe(1);
  });

  it("promises nothing while no yearly price is sold", () => {
    expect(yearlyFreeMonths(SEED)).toBe(0);
    for (const plan of PLAN_IDS) expect(yearlySavingCents(SEED, plan), plan).toBe(0);
  });
});

describe("the launch price", () => {
  it("is on no seeded plan: what is charged is the regular price", () => {
    for (const plan of PLAN_IDS) {
      expect(monthlyListPriceCents(SEED, plan, "month"), plan).toBeNull();
      expect(launchDiscountPercent(SEED, plan, "month"), plan).toBe(0);
    }
  });

  it("shows a regular price above what the row charges, and nothing on the others", () => {
    expect(monthlyListPriceCents(WITH_LAUNCH, "starter", "month")).toBe(1500);
    expect(monthlyPriceCents(WITH_LAUNCH, "starter", "month")).toBe(1200);
    expect(launchDiscountPercent(WITH_LAUNCH, "starter", "month")).toBe(20);
    for (const plan of ["free", "pro"] as const) {
      expect(monthlyListPriceCents(WITH_LAUNCH, plan, "month"), plan).toBeNull();
      expect(launchDiscountPercent(WITH_LAUNCH, plan, "month"), plan).toBe(0);
    }
  });

  it("is the same saving yearly, spread over twelve months like the price", () => {
    expect(launchDiscountPercent(WITH_LAUNCH, "starter", "year")).toBe(20);
    expect(intervalListPriceCents(WITH_LAUNCH, "starter", "year")).toBe(15_000);
    expect(monthlyListPriceCents(WITH_LAUNCH, "starter", "year")).toBe(1250);
  });

  it("never claims a regular price at or below the price charged", () => {
    // A struck-through price that is not above the real one is no discount
    // at all, and showing it would be a false claim.
    const flat = SEED.map((price) => (price.planId === "starter" ? { ...price, listPriceCents: 1200 } : price));
    expect(monthlyListPriceCents(flat, "starter", "month")).toBeNull();
    expect(launchDiscountPercent(flat, "starter", "month")).toBe(0);
  });
});
