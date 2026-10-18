/**
 * WHAT ONE SALE OWES (lib/billing/sale-fee.ts): the fee is decided by the
 * server from the database, and each thing that sets it is pinned here
 * because each is a way to charge a seller the wrong amount:
 *
 *   - nothing at all while fees are switched off, and nothing for a waived
 *     seller, with the plan still snapshotted;
 *   - the plan's direct rate on a sale through any of the seller's own doors,
 *     its marketplace rate on one the marketplace brought;
 *   - on everything the buyer pays;
 *   - and a refusal (null) rather than a guess whenever the plan, the prices
 *     or the waiver cannot be read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountBillingResult } from "@/lib/billing/account-plan";
import type { PlanPrices } from "@/lib/billing/fees";
import type { BillingSwitches } from "@/lib/billing/switches";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";

const state = vi.hoisted(() => ({
  billing: null as unknown,
  prices: null as unknown,
  switches: null as unknown,
  waiver: { data: null as { owner_id: string } | null, error: null as { message: string } | null },
  priceReads: 0,
  waiverReads: 0,
}));

vi.mock("@/lib/billing/account-plan", () => ({
  readAccountBilling: vi.fn(async () => state.billing as AccountBillingResult),
}));
vi.mock("@/lib/billing/catalog", () => ({
  readPlanPrices: vi.fn(async () => {
    state.priceReads += 1;
    return state.prices as PlanPrices | null;
  }),
}));
vi.mock("@/lib/billing/switches", () => ({
  readBillingSwitches: vi.fn(async () => state.switches as BillingSwitches),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.waiverReads += 1;
            return state.waiver;
          },
        }),
      }),
    }),
  }),
}));

import { CHANNEL_ORIGIN, originForChannel } from "@/lib/billing/origin";
import { sellerSaleFee } from "@/lib/billing/sale-fee";
import { SALE_ORIGINS } from "@/lib/pricing";
import { ORDER_CHANNELS, type OrderChannel } from "@/types/order-view";

const SELLER = "5f0c4d0e-6c2b-4f0e-9a43-0d6a0a7b1c11";

const onPlan = (plan: "free" | "starter" | "pro"): AccountBillingResult => ({
  ok: true,
  billing: {
    plan,
    storedPlan: plan === "free" ? null : plan,
    status: plan === "free" ? "none" : "active",
    interval: plan === "free" ? null : "month",
    priceCents: null,
    currency: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    paidUntil: null,
    customerId: null,
    subscriptionId: null,
  },
});

const sale = (channel: OrderChannel = "embed", amountCents = 2500) =>
  sellerSaleFee({ sellerId: SELLER, amountCents, channel });

beforeEach(() => {
  state.billing = onPlan("free");
  state.prices = PLAN_PRICE_SEED;
  state.switches = { planLimitsEnforced: false, feesEnabled: true, entitlementsEnforced: false };
  state.waiver = { data: null, error: null };
  state.priceReads = 0;
  state.waiverReads = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("with fees switched on", () => {
  it("charges a EUR 25 embed sale on Free EUR 1.25", async () => {
    expect(await sale("embed")).toEqual({
      sellerPlan: "free",
      platformFeeBps: 500,
      platformFeeCents: 125,
      adRateBps: null,
      adFeeCents: 0,
      applicationFeeCents: 125,
      feeCapped: false,
    });
  });

  it("charges the plan in force at checkout: 50 cents on Starter, 13 on Pro", async () => {
    state.billing = onPlan("starter");
    expect(await sale("button")).toMatchObject({ sellerPlan: "starter", platformFeeBps: 200, applicationFeeCents: 50 });
    state.billing = onPlan("pro");
    expect(await sale("direct")).toMatchObject({ sellerPlan: "pro", platformFeeBps: 50, applicationFeeCents: 13 });
  });

  it("charges every one of the seller's own doors the same", async () => {
    for (const channel of ["embed", "button", "direct"] as const) {
      expect((await sale(channel))?.applicationFeeCents, channel).toBe(125);
    }
  });

  it("charges the marketplace fee on a sale the marketplace brought", async () => {
    expect(await sale("marketplace")).toMatchObject({ platformFeeBps: 800, applicationFeeCents: 200 });
  });

  it("is worked out on everything the buyer pays", async () => {
    // EUR 20 of items and EUR 5 of delivery is a EUR 25 sale.
    expect((await sale("embed", 2000 + 500))?.platformFeeCents).toBe(125);
  });

  it("charges a waived seller nothing, with the plan still on the order", async () => {
    state.waiver = { data: { owner_id: SELLER }, error: null };
    state.billing = onPlan("starter");
    expect(await sale("embed")).toEqual({
      sellerPlan: "starter",
      platformFeeBps: 0,
      platformFeeCents: 0,
      adRateBps: null,
      adFeeCents: 0,
      applicationFeeCents: 0,
      feeCapped: false,
    });
  });

  it("follows a rate changed in the database", async () => {
    state.prices = PLAN_PRICE_SEED.map((price) => (price.planId === "free" ? { ...price, directFeeBps: 400 } : price));
    expect((await sale("embed"))?.applicationFeeCents).toBe(100);
  });

  it("logs a sale the 30% cap cut down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.prices = PLAN_PRICE_SEED.map((price) => ({ ...price, directFeeBps: 4500 }));
    expect(await sale("embed")).toMatchObject({ applicationFeeCents: 750, feeCapped: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("application fee capped"));
  });
});

describe("with fees switched off", () => {
  beforeEach(() => {
    state.switches = { planLimitsEnforced: false, feesEnabled: false, entitlementsEnforced: false };
  });

  it("charges nothing, on any plan and through any door, and still says which plan", async () => {
    for (const plan of ["free", "starter", "pro"] as const) {
      state.billing = onPlan(plan);
      for (const channel of ORDER_CHANNELS) {
        expect(await sale(channel), `${plan}/${channel}`).toMatchObject({
          sellerPlan: plan,
          platformFeeBps: 0,
          applicationFeeCents: 0,
        });
      }
    }
  });

  it("does not need the prices or the waiver to say so", async () => {
    state.prices = null;
    state.waiver = { data: null, error: { message: "relation does not exist" } };
    expect((await sale())?.applicationFeeCents).toBe(0);
    expect(state.priceReads).toBe(0);
    expect(state.waiverReads).toBe(0);
  });
});

describe("what cannot be read is refused, never guessed", () => {
  it("refuses when the seller's plan cannot be read", async () => {
    state.billing = { ok: false };
    expect(await sale()).toBeNull();
  });

  it("refuses when the plan prices cannot be read", async () => {
    state.prices = null;
    expect(await sale()).toBeNull();
  });

  it("refuses when the waiver cannot be checked: a waived seller must not be charged by accident", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.waiver = { data: null, error: { message: "timeout" } };
    expect(await sale()).toBeNull();
  });
});

describe("a sale's origin", () => {
  it("gives every channel an origin from the pricing vocabulary", () => {
    for (const channel of ORDER_CHANNELS) expect(SALE_ORIGINS).toContain(originForChannel(channel));
    expect(CHANNEL_ORIGIN).toEqual({
      embed: "embed",
      button: "purchase_button",
      direct: "hosted_storefront",
      marketplace: "marketplace",
    });
  });
});
