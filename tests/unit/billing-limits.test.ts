import { describe, expect, it } from "vitest";
import { LIMIT_SOURCE, PRICING_SOURCES } from "@/lib/billing/paths";
import { PLANS, PLAN_LIMIT_KEYS } from "@/lib/billing/plans";
import { planLimitReached } from "@/lib/errors";
import { english } from "../setup/translate";

// The refusal a seller reads when their plan has no room for one more of
// something: it names the plan and its cap, and offers the plans page only
// when there is a bigger plan on it.

describe("planLimitReached", () => {
  it("names the plan and the cap for every capped thing", () => {
    expect(english(planLimitReached("products", "free", PLANS.free.limits.products!).message)).toBe(
      "Your Free plan includes 20 products, and your store has them all.",
    );
    expect(english(planLimitReached("products", "starter", PLANS.starter.limits.products!).message)).toBe(
      "Your Starter plan includes 60 products, and your store has them all.",
    );
    for (const key of PLAN_LIMIT_KEYS) {
      expect(english(planLimitReached(key, "free", 1).message), key).toMatch(/^Your Free plan includes 1 /);
    }
  });

  it("links to the plans page under the limit's own funnel source", () => {
    for (const key of PLAN_LIMIT_KEYS) {
      const error = planLimitReached(key, "free", 1);
      expect(error.code).toBe("plan_limit");
      expect(error.action?.href, key).toBe(`/plans?from=${LIMIT_SOURCE[key]}`);
      expect(PRICING_SOURCES).toContain(LIMIT_SOURCE[key]);
    }
  });

  it("offers no upgrade on the top plan: the way out is to remove one", () => {
    const error = planLimitReached("products", "pro", PLANS.pro.limits.products!);
    expect(error.action).toBeUndefined();
    expect(english(error.message)).toBe("Your Pro plan includes 500 products, and your store has them all.");
    expect(english(error.fix!)).toMatch(/^Remove one you no longer need/);
  });
});

describe("the product caps", () => {
  it("are the owner's numbers: 20 on Free, 60 on Starter, 500 on Pro", () => {
    expect([PLANS.free, PLANS.starter, PLANS.pro].map((plan) => plan.limits.products)).toEqual([20, 60, 500]);
  });
});
