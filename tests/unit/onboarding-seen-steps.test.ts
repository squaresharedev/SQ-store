// @vitest-environment node
/**
 * lib/onboarding/seen-steps.ts: the setup-seen cookie that decides which
 * checklist steps play their "done" moment. The rules that matter: no history
 * animates nothing, another account's history is no history, and only steps
 * done SINCE the last look count.
 */
import { describe, expect, it } from "vitest";
import {
  newlyDoneSteps,
  parseSeenSteps,
  serializeSeenSteps,
} from "@/lib/onboarding/seen-steps";

const steps = (done: string[]) =>
  (["seller-details", "product", "storefront", "publish"] as const).map((id) => ({
    id,
    done: done.includes(id),
  }));

describe("setup-seen cookie", () => {
  it("round-trips, including an empty set", () => {
    expect(parseSeenSteps(serializeSeenSteps("acct-1", ["seller-details", "product"]), "acct-1"))
      .toEqual(["seller-details", "product"]);
    expect(parseSeenSteps(serializeSeenSteps("acct-1", []), "acct-1")).toEqual([]);
  });

  it("is no history when missing, unreadable, or another account's", () => {
    expect(parseSeenSteps(undefined, "acct-1")).toBeNull();
    expect(parseSeenSteps("", "acct-1")).toBeNull();
    expect(parseSeenSteps("garbage", "acct-1")).toBeNull();
    expect(parseSeenSteps("acct-2:product", "acct-1")).toBeNull();
  });

  it("drops step ids it does not know rather than failing the value", () => {
    expect(parseSeenSteps("acct-1:product|renamed-step", "acct-1")).toEqual(["product"]);
  });
});

describe("newlyDoneSteps", () => {
  it("animates nothing without a history", () => {
    expect(newlyDoneSteps(steps(["seller-details", "product"]), null)).toEqual([]);
  });

  it("returns only the steps done since the last look, in order", () => {
    expect(newlyDoneSteps(steps(["seller-details", "product", "storefront"]), ["product"]))
      .toEqual(["seller-details", "storefront"]);
  });

  it("does not count a step that was seen done and is done again", () => {
    expect(newlyDoneSteps(steps(["product"]), ["product"])).toEqual([]);
  });

  it("replays a step that was undone and then done again", () => {
    // Seen with the product step undone (the seller set it back to draft):
    expect(newlyDoneSteps(steps(["seller-details", "product"]), ["seller-details"]))
      .toEqual(["product"]);
  });
});
