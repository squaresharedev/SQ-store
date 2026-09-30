// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_STATUSES,
  computePaidUntil,
  effectivePlan,
  isLiveSubscription,
  parseSubscriptionStatus,
} from "@/lib/billing/entitlement";
import { PAST_DUE_GRACE_DAYS, RENEWAL_SLACK_HOURS } from "@/lib/billing/plans";

const NOW = new Date("2026-09-30T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("effectivePlan: the one rule every reader shares", () => {
  it("is Free with no billing row", () => {
    expect(effectivePlan(null, NOW)).toBe("free");
    expect(effectivePlan(undefined, NOW)).toBe("free");
  });

  it("is the paid plan until paid_until, then Free", () => {
    expect(effectivePlan({ plan: "pro", paid_until: "2026-10-01T00:00:00Z" }, NOW)).toBe("pro");
    expect(effectivePlan({ plan: "pro", paid_until: "2026-09-30T12:00:00Z" }, NOW)).toBe("free");
    expect(effectivePlan({ plan: "pro", paid_until: "2026-09-01T00:00:00Z" }, NOW)).toBe("free");
  });

  it("never grants a plan it cannot read", () => {
    expect(effectivePlan({ plan: "enterprise", paid_until: "2999-01-01T00:00:00Z" }, NOW)).toBe("free");
    expect(effectivePlan({ plan: "free", paid_until: "2999-01-01T00:00:00Z" }, NOW)).toBe("free");
    expect(effectivePlan({ plan: "pro", paid_until: null }, NOW)).toBe("free");
    expect(effectivePlan({ plan: "pro", paid_until: "not a date" }, NOW)).toBe("free");
  });
});

describe("computePaidUntil", () => {
  const periodEnd = new Date("2026-10-30T12:00:00Z");

  it("gives an active plan its period plus renewal slack", () => {
    expect(computePaidUntil("active", periodEnd, false, NOW).getTime()).toBe(
      periodEnd.getTime() + RENEWAL_SLACK_HOURS * HOUR,
    );
    expect(computePaidUntil("trialing", periodEnd, false, NOW).getTime()).toBe(
      periodEnd.getTime() + RENEWAL_SLACK_HOURS * HOUR,
    );
  });

  it("ends a plan set to cancel exactly at its period end", () => {
    expect(computePaidUntil("active", periodEnd, true, NOW)).toEqual(periodEnd);
  });

  it("keeps a past-due plan through the grace period while Stripe retries", () => {
    expect(computePaidUntil("past_due", periodEnd, false, NOW).getTime()).toBe(
      periodEnd.getTime() + PAST_DUE_GRACE_DAYS * 24 * HOUR,
    );
  });

  it("ends every other status now", () => {
    for (const status of ["canceled", "unpaid", "paused", "incomplete", "incomplete_expired"] as const) {
      expect(computePaidUntil(status, periodEnd, false, NOW)).toEqual(NOW);
    }
  });

  it("ends a plan with no known period now", () => {
    expect(computePaidUntil("active", null, false, NOW)).toEqual(NOW);
  });
});

describe("statuses", () => {
  it("parses every Stripe status and nothing else", () => {
    for (const status of SUBSCRIPTION_STATUSES) expect(parseSubscriptionStatus(status)).toBe(status);
    expect(parseSubscriptionStatus("none")).toBeNull();
    expect(parseSubscriptionStatus("ACTIVE")).toBeNull();
  });

  it("treats a subscription as live while a second checkout would double it", () => {
    expect(isLiveSubscription("active")).toBe(true);
    expect(isLiveSubscription("past_due")).toBe(true);
    expect(isLiveSubscription("canceled")).toBe(false);
    expect(isLiveSubscription("none")).toBe(false);
    expect(isLiveSubscription(null)).toBe(false);
  });
});
