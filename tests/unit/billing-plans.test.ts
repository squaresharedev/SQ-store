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
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { findPlanPrice } from "@/lib/pricing";

/** A plan's seeded monthly price row. */
const seeded = (plan: (typeof PLAN_IDS)[number]) => {
  const price = findPlanPrice(PLAN_PRICE_SEED, plan);
  if (!price) throw new Error(`no seeded price for ${plan}`);
  return price;
};

/**
 * The catalog's own consistency, and the seeded prices' (what plan_prices
 * starts with). Whatever the final numbers are, these hold, or the plans page
 * would tell a seller something that is not true.
 */
describe("the plan catalog", () => {
  it("starts everyone on a Free plan that costs nothing", () => {
    expect(DEFAULT_PLAN).toBe("free");
    expect(seeded("free").priceCents).toBe(0);
    expect(seeded("free").stripeLookupKey).toBeNull();
  });

  it("gives every paid plan a price and a Stripe lookup key that names it", () => {
    for (const plan of PAID_PLAN_IDS) {
      const price = seeded(plan);
      expect(price.priceCents).toBeGreaterThan(0);
      expect(price.stripeLookupKey).toMatch(new RegExp(`^${plan}_${price.interval}_[a-z]{3}_v\\d+$`));
      // The webhook reads the plan back out of this key.
      expect(planForLookupKey(price.stripeLookupKey!)).toEqual({ plan, interval: price.interval });
    }
  });

  it("never uses one lookup key twice, and seeds one row per plan", () => {
    const keys = PLAN_PRICE_SEED.flatMap((price) => (price.stripeLookupKey ? [price.stripeLookupKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(PLAN_PRICE_SEED.map((price) => price.planId)).toEqual([...PLAN_IDS]);
    for (const price of PLAN_PRICE_SEED) expect(BILLING_INTERVALS).toContain(price.interval);
  });

  it("gets cheaper per sale as the subscription gets dearer, through either door", () => {
    for (let i = 1; i < PLAN_IDS.length; i += 1) {
      const lower = seeded(PLAN_IDS[i - 1]!);
      const upper = seeded(PLAN_IDS[i]!);
      expect(upper.priceCents).toBeGreaterThan(lower.priceCents);
      expect(upper.directFeeBps).toBeLessThan(lower.directFeeBps);
      expect(upper.marketplaceFeeBps).toBeLessThan(lower.marketplaceFeeBps);
    }
  });

  it("charges more for a sale the marketplace brought than for the seller's own", () => {
    for (const plan of PLAN_IDS) {
      expect(seeded(plan).marketplaceFeeBps, plan).toBeGreaterThan(seeded(plan).directFeeBps);
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
      for (const bps of [seeded(plan).directFeeBps, seeded(plan).marketplaceFeeBps]) {
        expect(Number.isInteger(bps)).toBe(true);
        expect(bps).toBeGreaterThanOrEqual(0);
        expect(bps).toBeLessThanOrEqual(10_000);
      }
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
