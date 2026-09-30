// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  BILLING_INTERVALS,
  DEFAULT_PLAN,
  PAID_PLAN_IDS,
  PLANS,
  PLAN_IDS,
  PLAN_LIMIT_KEYS,
  parseBillingInterval,
  parsePaidPlanId,
  parsePlanId,
  planForLookupKey,
} from "@/lib/billing/plans";

/**
 * The catalog's own consistency. Whatever the final numbers are, these hold,
 * or the pricing modal would tell a seller something that is not true.
 */
describe("the plan catalog", () => {
  it("starts everyone on a Free plan that costs nothing", () => {
    expect(DEFAULT_PLAN).toBe("free");
    expect(PLANS.free.priceCents).toEqual({ month: 0, year: 0 });
    expect(PLANS.free.lookupKey).toBeNull();
  });

  it("gives every paid plan a price and a Stripe lookup key per interval", () => {
    for (const plan of PAID_PLAN_IDS) {
      for (const interval of BILLING_INTERVALS) {
        expect(PLANS[plan].priceCents[interval]).toBeGreaterThan(0);
        expect(PLANS[plan].lookupKey?.[interval]).toMatch(new RegExp(`^${plan}_${interval}_[a-z]{3}_v\\d+$`));
      }
    }
  });

  it("never uses one lookup key twice", () => {
    const keys = PAID_PLAN_IDS.flatMap((plan) => BILLING_INTERVALS.map((i) => PLANS[plan].lookupKey![i]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never charges more for a year than for twelve months", () => {
    for (const plan of PLAN_IDS) {
      expect(PLANS[plan].priceCents.year).toBeLessThanOrEqual(PLANS[plan].priceCents.month * 12);
    }
  });

  it("gets cheaper per sale as the subscription gets dearer", () => {
    for (let i = 1; i < PLAN_IDS.length; i += 1) {
      const lower = PLANS[PLAN_IDS[i - 1]!];
      const upper = PLANS[PLAN_IDS[i]!];
      expect(upper.priceCents.month).toBeGreaterThan(lower.priceCents.month);
      expect(upper.feeBps).toBeLessThan(lower.feeBps);
    }
  });

  it("only ever raises limits on a dearer plan", () => {
    const rank = (cap: number | null) => (cap === null ? Number.POSITIVE_INFINITY : cap);
    for (const key of PLAN_LIMIT_KEYS) {
      for (let i = 1; i < PLAN_IDS.length; i += 1) {
        expect(rank(PLANS[PLAN_IDS[i]!].limits[key])).toBeGreaterThanOrEqual(rank(PLANS[PLAN_IDS[i - 1]!].limits[key]));
      }
    }
  });

  it("keeps fees within a whole sale", () => {
    for (const plan of PLAN_IDS) {
      expect(Number.isInteger(PLANS[plan].feeBps)).toBe(true);
      expect(PLANS[plan].feeBps).toBeGreaterThanOrEqual(0);
      expect(PLANS[plan].feeBps).toBeLessThanOrEqual(10_000);
    }
  });

  it("recommends exactly one plan", () => {
    expect(PLAN_IDS.filter((plan) => PLANS[plan].recommended)).toHaveLength(1);
  });
});

describe("parsing untrusted values", () => {
  it("narrows plans, paid plans and intervals", () => {
    expect(parsePlanId("pro")).toBe("pro");
    expect(parsePlanId("enterprise")).toBeNull();
    expect(parsePlanId(3)).toBeNull();
    expect(parsePaidPlanId("free")).toBeNull();
    expect(parsePaidPlanId("starter")).toBe("starter");
    expect(parseBillingInterval("year")).toBe("year");
    expect(parseBillingInterval("week")).toBeNull();
  });

  it("reads a plan from a lookup key's shape, grandfathered versions included", () => {
    expect(planForLookupKey("pro_year_eur_v1")).toEqual({ plan: "pro", interval: "year" });
    // A later price version is still the same plan.
    expect(planForLookupKey("starter_month_eur_v7")).toEqual({ plan: "starter", interval: "month" });
    expect(planForLookupKey("free_month_eur_v1")).toBeNull();
    expect(planForLookupKey("enterprise_month_eur_v1")).toBeNull();
    expect(planForLookupKey("pro_monthly")).toBeNull();
  });
});
