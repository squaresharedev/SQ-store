import { describe, expect, it } from "vitest";
import {
  COMPARE_GROUPS,
  INCLUDED_FEATURE_KEYS,
  PLAN_FEATURE_KEYS,
  cheapestPlanWith,
  gainsOver,
  planCardFeatures,
  planFeatures,
  planHas,
} from "@/lib/billing/features";
import { PLAN_IDS, PLAN_LIMIT_KEYS, PLAN_PERK_KEYS, PLANS, RECOMMENDED_PLAN, nextPlanUp } from "@/lib/billing/plans";

/** A cap as a comparable number: unlimited ranks above any count. */
const rank = (cap: number | null) => (cap === null ? Number.POSITIVE_INFINITY : cap);

// The feature lists every plan surface reads (cards, comparison table, the
// Settings upsell), derived from the catalog. The rule the user set: paid
// plans ADD, they never take anything away from Free.

describe("plan features", () => {
  it("never takes a perk or a cap away going up a plan", () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const below = PLAN_IDS[i - 1]!;
      const plan = PLAN_IDS[i]!;
      for (const perk of PLAN_PERK_KEYS) {
        if (PLANS[below].perks[perk]) expect(PLANS[plan].perks[perk], `${plan}.${perk}`).toBe(true);
      }
      for (const key of PLAN_LIMIT_KEYS) {
        expect(rank(PLANS[plan].limits[key]), plan + "." + key).toBeGreaterThanOrEqual(rank(PLANS[below].limits[key]));
      }
    }
  });

  it("gives Free the core and the orders export, and no paid-only perk", () => {
    expect(planFeatures("free")).toEqual(["fee", "products", "storefronts", "teamSeats", "core", "ordersExport"]);
    expect(planHas("free", "ordersExport")).toBe(true);
    for (const perk of ["earlyAccess", "analyticsExport", "prioritySupport"] as const) {
      expect(planHas("free", perk), perk).toBe(false);
    }
  });

  it("lists what each paid plan adds over the one below it", () => {
    expect(planCardFeatures("free")).toEqual({ below: null, features: planFeatures("free") });
    expect(planCardFeatures("starter")).toEqual({
      below: "free",
      features: ["fee", "products", "storefronts", "teamSeats", "earlyAccess"],
    });
    expect(planCardFeatures("pro")).toEqual({
      below: "starter",
      features: ["fee", "products", "storefronts", "teamSeats", "analyticsExport", "prioritySupport"],
    });
  });

  it("gives the upsell a reason on every step up", () => {
    for (const plan of PLAN_IDS) {
      const next = nextPlanUp(plan);
      if (next) expect(gainsOver(plan, next).length, `${plan} -> ${next}`).toBeGreaterThan(0);
    }
    expect(nextPlanUp("pro")).toBeNull();
  });

  it("names the cheapest plan with a perk, for a locked button", () => {
    expect(cheapestPlanWith("ordersExport")).toBe("free");
    expect(cheapestPlanWith("analyticsExport")).toBe("pro");
    expect(cheapestPlanWith("prioritySupport")).toBe("pro");
  });

  it("recommends Starter", () => {
    expect(RECOMMENDED_PLAN).toBe("starter");
  });
});

describe("the comparison table", () => {
  const rows = COMPARE_GROUPS.flatMap((group) => group.rows);

  it("shows every plan feature (bar the cards' summary line) and every included one, once each", () => {
    const expected = [...PLAN_FEATURE_KEYS.filter((key) => key !== "core"), ...INCLUDED_FEATURE_KEYS];
    expect([...rows].sort()).toEqual([...expected].sort());
  });

  it("ticks every included feature on every plan, Free first among them", () => {
    for (const key of INCLUDED_FEATURE_KEYS) {
      for (const plan of PLAN_IDS) expect(planHas(plan, key), `${plan}.${key}`).toBe(true);
    }
  });
});
