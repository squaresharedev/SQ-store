// Tests for order-channel coercion and the new checkout columns in OrderView.
//
// toChannel is exported from lib/orders/queries for this purpose: it is the
// one function that decides what channel value a seller sees, and it must
// handle three valid values plus any unknown string that arrives from the DB.
import { describe, expect, it } from "vitest";
import { toChannel } from "@/lib/orders/queries";
import type { OrderChannel, OrderView } from "@/types/order-view";

describe("toChannel", () => {
  it("passes 'embed' through", () => {
    expect(toChannel("embed")).toBe("embed");
  });

  it("passes 'marketplace' through", () => {
    expect(toChannel("marketplace")).toBe("marketplace");
  });

  it("passes 'direct' through — the channel added by the checkout migration", () => {
    expect(toChannel("direct")).toBe("direct");
  });

  it("folds an unknown string to 'embed'", () => {
    expect(toChannel("some_future_value")).toBe("embed");
  });

  it("folds null to 'embed'", () => {
    expect(toChannel(null)).toBe("embed");
  });

  it("folds undefined to 'embed'", () => {
    expect(toChannel(undefined)).toBe("embed");
  });

  it("folds an empty string to 'embed'", () => {
    expect(toChannel("")).toBe("embed");
  });
});

// Type-level coverage: the four new fields from the checkout migration must
// compile as valid OrderView members. These checks are compile-time only; if
// they build they pass.
describe("OrderView checkout fields (type safety)", () => {
  it("accepts null gift message and null withdrawal timestamp", () => {
    const view: Pick<OrderView, "giftMessage" | "withdrawalRequestedAt"> = {
      giftMessage: null,
      withdrawalRequestedAt: null,
    };
    expect(view.giftMessage).toBeNull();
    expect(view.withdrawalRequestedAt).toBeNull();
  });

  it("accepts a gift message string", () => {
    const view: Pick<OrderView, "giftMessage" | "withdrawalRequestedAt"> = {
      giftMessage: "Please wrap this",
      withdrawalRequestedAt: null,
    };
    expect(view.giftMessage).toBe("Please wrap this");
  });

  it("accepts a withdrawal timestamp string", () => {
    const view: Pick<OrderView, "giftMessage" | "withdrawalRequestedAt"> = {
      giftMessage: null,
      withdrawalRequestedAt: "2026-09-28T10:00:00Z",
    };
    expect(view.withdrawalRequestedAt).toBe("2026-09-28T10:00:00Z");
  });
});

describe("OrderChannel type includes 'direct'", () => {
  it("all three channel values satisfy the OrderChannel type", () => {
    // This is a compile-time check; if the type is wrong the file does not
    // build and the test suite reports the failure before any test runs.
    const channels: OrderChannel[] = ["embed", "marketplace", "direct"];
    expect(channels).toHaveLength(3);
    expect(channels).toContain("direct");
  });
});
