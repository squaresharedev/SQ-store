// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  emptySnapshot,
  normalizeSubscription,
  pickCurrentSubscription,
  planTransition,
} from "@/lib/billing/sync";
import { RENEWAL_SLACK_HOURS } from "@/lib/billing/plans";
import type { StripeSubscription } from "@/lib/billing/stripe-api";

const NOW = new Date("2026-09-30T12:00:00Z");
const PERIOD_END = Math.floor(new Date("2026-10-30T12:00:00Z").getTime() / 1000);

/** A subscription in the shape of API version `basil`: the period lives on the item. */
function subscription(overrides: Partial<StripeSubscription> & { lookupKey?: string | null } = {}): StripeSubscription {
  const { lookupKey = "pro_month_eur_v1", ...rest } = overrides;
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    created: 1_700_000_000,
    cancel_at_period_end: false,
    canceled_at: null,
    livemode: false,
    metadata: {},
    items: {
      data: [
        {
          id: "si_1",
          current_period_end: PERIOD_END,
          price: {
            id: "price_1",
            lookup_key: lookupKey,
            unit_amount: 4000,
            currency: "eur",
            active: true,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...rest,
  };
}

describe("normalizeSubscription", () => {
  it("reads the plan from the price's lookup key and the period from the item", () => {
    const snapshot = normalizeSubscription(subscription(), NOW);
    expect(snapshot).toMatchObject({
      subscriptionId: "sub_1",
      plan: "pro",
      interval: "month",
      status: "active",
      priceCents: 4000,
      currency: "EUR",
      cancelAtPeriodEnd: false,
    });
    expect(snapshot.currentPeriodEnd?.getTime()).toBe(PERIOD_END * 1000);
    expect(snapshot.paidUntil?.getTime()).toBe(PERIOD_END * 1000 + RENEWAL_SLACK_HOURS * 3_600_000);
  });

  it("grants no plan for a price this app does not know", () => {
    const snapshot = normalizeSubscription(subscription({ lookupKey: "mystery_plan" }), NOW);
    expect(snapshot.plan).toBeNull();
    expect(snapshot.paidUntil).toBeNull();
  });

  it("ends a cancelled subscription now", () => {
    const snapshot = normalizeSubscription(subscription({ status: "canceled", canceled_at: 1_700_000_500 }), NOW);
    expect(snapshot.paidUntil).toEqual(NOW);
    expect(snapshot.canceledAt?.getTime()).toBe(1_700_000_500_000);
  });

  it("reads an unknown status as incomplete, which grants nothing", () => {
    const snapshot = normalizeSubscription(subscription({ status: "brand_new_status" }), NOW);
    expect(snapshot.status).toBe("incomplete");
    expect(snapshot.paidUntil).toEqual(NOW);
  });

  it("describes a customer with nothing as no plan at all", () => {
    expect(emptySnapshot(true)).toMatchObject({ plan: null, status: "none", paidUntil: null, livemode: true });
  });
});

describe("pickCurrentSubscription", () => {
  it("prefers the newest live subscription over a newer cancelled one", () => {
    const live = subscription({ id: "sub_live", created: 100 });
    const cancelled = subscription({ id: "sub_old", status: "canceled", created: 200 });
    expect(pickCurrentSubscription([cancelled, live])?.id).toBe("sub_live");
  });

  it("falls back to the newest of any status", () => {
    const older = subscription({ id: "sub_a", status: "canceled", created: 100 });
    const newer = subscription({ id: "sub_b", status: "incomplete_expired", created: 200 });
    expect(pickCurrentSubscription([older, newer])?.id).toBe("sub_b");
  });

  it("is null for a customer with none", () => {
    expect(pickCurrentSubscription([])).toBeNull();
  });
});

describe("planTransition", () => {
  it("names what the seller would notice", () => {
    expect(planTransition("free", "pro")).toBe("upgraded");
    expect(planTransition("pro", "free")).toBe("downgraded");
    expect(planTransition("starter", "pro")).toBe("plan_changed");
    expect(planTransition("pro", "pro")).toBeNull();
  });
});
