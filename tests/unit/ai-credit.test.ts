// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AI_CREDIT_MARGIN,
  AI_PLATFORM_DAILY_CENTS,
  aiCreditAllowance,
  aiCreditCharge,
  aiCreditPeriod,
  hasAiCreditLeft,
  MICROS_PER_CENT,
} from "@/lib/billing/ai-credit";
import { PLANS } from "@/lib/billing/plans";
import { COMPLETE_CALL } from "@/lib/suggestions/complete-listing";
import { DESCRIBE_LIMITS } from "@/lib/suggestions/describe";
import { describeListingMaxCost } from "@/lib/suggestions/describe-listing";

// THE PROMISE THIS FILE KEEPS: AI writing help cannot cost the platform more
// per store per month than the plan's credit, less the margin, and a Pro
// store's worst month leaves the plan profitable.
describe("the AI credit", () => {
  it("charges every call its cost plus 20%, rounded up", () => {
    expect(AI_CREDIT_MARGIN).toBe(0.2);
    expect(aiCreditCharge(100)).toBe(120);
    expect(aiCreditCharge(158.4)).toBe(191);
    expect(aiCreditCharge(0)).toBe(0);
  });

  it("is EUR 10 a month on Pro and nothing below it", () => {
    expect(aiCreditAllowance("pro")).toBe(1_000 * MICROS_PER_CENT);
    expect(aiCreditAllowance("starter")).toBe(0);
    expect(aiCreditAllowance("free")).toBe(0);
    for (const plan of Object.values(PLANS)) {
      expect(plan.aiCreditCents > 0, plan.id).toBe(plan.perks.aiSuggestions);
    }
  });

  it("caps a Pro store's model spend at USD 8.33 a month, a fifth of a EUR 40 plan", () => {
    // Credit is counted 1 USD of cost = 1 EUR of credit (the dollar is worth
    // less), so the most the platform pays is the credit over the margin.
    const worstMonthUsd = aiCreditAllowance("pro") / (1 + AI_CREDIT_MARGIN) / 1_000_000;
    expect(worstMonthUsd).toBeCloseTo(8.33, 2);
    expect(worstMonthUsd).toBeLessThan(40 * 0.25);
  });

  it("never overshoots: the most a call can cost is held before it, and the largest hold is about a cent", () => {
    // The largest request there is: the whole listing in "&", five bytes a
    // character once escaped, every byte a token at the dearest rate.
    const worst = {
      mode: "write" as const,
      title: "&".repeat(DESCRIBE_LIMITS.title),
      text: "&".repeat(DESCRIBE_LIMITS.text),
      facts: Array.from({ length: 6 }, () => ({
        label: "&".repeat(DESCRIBE_LIMITS.factLabel),
        value: "&".repeat(DESCRIBE_LIMITS.factValue),
      })),
      language: "en",
    };
    const largestHold = aiCreditCharge(describeListingMaxCost(worst));
    expect(largestHold).toBeLessThan(1.5 * MICROS_PER_CENT);
    // So a store is turned away with at most that much of its month unspent.
    expect(largestHold / aiCreditAllowance("pro")).toBeLessThan(0.002);
    expect(COMPLETE_CALL.maxTokens).toBeLessThanOrEqual(4_000);
  });

  it("caps the platform's day at EUR 100 of credit, USD 83 of model calls", () => {
    expect(AI_PLATFORM_DAILY_CENTS).toBe(10_000);
    expect(AI_PLATFORM_DAILY_CENTS / 100 / (1 + AI_CREDIT_MARGIN)).toBeCloseTo(83.33, 2);
  });

  it("knows when it is spent", () => {
    expect(hasAiCreditLeft({ allowance: 100, used: 99, renewsAt: "" })).toBe(true);
    expect(hasAiCreditLeft({ allowance: 100, used: 100, renewsAt: "" })).toBe(false);
    expect(hasAiCreditLeft({ allowance: 0, used: 0, renewsAt: "" })).toBe(false);
  });

  it("runs by calendar month in UTC", () => {
    expect(aiCreditPeriod(new Date("2026-11-04T16:00:00Z"))).toEqual({
      start: "2026-11-01",
      day: "2026-11-04",
      renewsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(aiCreditPeriod(new Date("2026-12-31T23:59:59Z"))).toEqual({
      start: "2026-12-01",
      day: "2026-12-31",
      renewsAt: "2027-01-01T00:00:00.000Z",
    });
  });
});
