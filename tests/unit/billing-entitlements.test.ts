/**
 * WHICH FEATURES A PLAN SWITCHES ON (lib/billing/entitlements.ts).
 *
 * hasFeature is the question a route or a page asks before a gated thing
 * happens. Pinned here: nothing is gated while the switch is off, the answer
 * comes from the plan_entitlements rows of the plan in force, and a read that
 * fails grants the feature rather than lock a seller out of their own store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountBillingResult } from "@/lib/billing/account-plan";
import type { BillingSwitches } from "@/lib/billing/switches";
import { ENTITLEMENT_SEED } from "@/lib/billing/pricing-seed";
import { FEATURE_KEYS, type FeatureKey, type PlanId } from "@/lib/pricing";

const state = vi.hoisted(() => ({
  enforced: true,
  billing: null as unknown,
  rows: {} as Record<string, readonly string[]>,
  failReads: false,
  reads: [] as string[],
}));

vi.mock("@/lib/billing/switches", () => ({
  getBillingSwitches: vi.fn(
    async (): Promise<BillingSwitches> => ({
      planLimitsEnforced: false,
      feesEnabled: false,
      entitlementsEnforced: state.enforced,
    }),
  ),
}));
vi.mock("@/lib/billing/account-plan", () => ({
  readAccountBilling: vi.fn(async () => state.billing as AccountBillingResult),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async (_column: string, plan: string) => {
          state.reads.push(plan);
          return state.failReads
            ? { data: null, error: { message: "timeout" } }
            : { data: (state.rows[plan] ?? []).map((feature) => ({ feature })), error: null };
        },
      }),
    }),
  }),
}));
// Outside a request there is nothing to cache per: every call asks.
vi.mock("react", async (importActual) => ({
  ...(await importActual<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

import { cheapestPlanWithFeature, hasFeature } from "@/lib/billing/entitlements";

const SELLER = "5f0c4d0e-6c2b-4f0e-9a43-0d6a0a7b1c11";
const onPlan = (plan: PlanId) => {
  state.billing = { ok: true, billing: { plan } };
};

beforeEach(() => {
  state.enforced = true;
  state.failReads = false;
  state.reads = [];
  state.rows = ENTITLEMENT_SEED;
  onPlan("free");
});
afterEach(() => vi.restoreAllMocks());

describe("hasFeature", () => {
  it("gates nothing while the switch is off: every plan has every feature, and nothing is read", async () => {
    state.enforced = false;
    for (const feature of FEATURE_KEYS) expect(await hasFeature(SELLER, feature), feature).toBe(true);
    expect(state.reads).toEqual([]);
  });

  it("answers from the rows of the plan in force once it is on", async () => {
    const has = async (plan: PlanId) => {
      onPlan(plan);
      const held: FeatureKey[] = [];
      for (const feature of FEATURE_KEYS) if (await hasFeature(SELLER, feature)) held.push(feature);
      return held;
    };
    // The suggested split: Free has none of the gated features.
    expect(await has("free")).toEqual([]);
    expect(await has("starter")).toEqual(["freeform_editor", "custom_fonts", "remove_badge", "discount_codes"]);
    expect(await has("pro")).toEqual([...FEATURE_KEYS]);
  });

  it("follows a feature moved to another plan in the database", async () => {
    state.rows = { ...ENTITLEMENT_SEED, free: ["discount_codes"] };
    expect(await hasFeature(SELLER, "discount_codes")).toBe(true);
    expect(await hasFeature(SELLER, "analytics")).toBe(false);
  });

  it("ignores a row naming a feature this build does not know", async () => {
    state.rows = { free: ["time_travel", "analytics"] };
    expect(await hasFeature(SELLER, "analytics")).toBe(true);
    expect(await hasFeature(SELLER, "custom_fonts")).toBe(false);
  });

  it("grants the feature when the plan or the table cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.billing = { ok: false };
    expect(await hasFeature(SELLER, "analytics")).toBe(true);
    onPlan("free");
    state.failReads = true;
    expect(await hasFeature(SELLER, "analytics")).toBe(true);
  });
});

describe("cheapestPlanWithFeature", () => {
  it("names the plan an upgrade prompt points at", async () => {
    expect(await cheapestPlanWithFeature("discount_codes")).toBe("starter");
    expect(await cheapestPlanWithFeature("analytics")).toBe("pro");
  });

  it("is null for a feature no plan has", async () => {
    state.rows = { free: [], starter: [], pro: [] };
    expect(await cheapestPlanWithFeature("analytics")).toBeNull();
  });
});
