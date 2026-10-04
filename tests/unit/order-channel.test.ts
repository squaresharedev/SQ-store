// Tests for order-channel coercion and the new checkout columns in OrderView.
//
// toChannel is exported from lib/orders/queries for this purpose: it is the
// one function that decides what channel value a seller sees, and it must
// handle three valid values plus any unknown string that arrives from the DB.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toChannel } from "@/lib/orders/queries";
import { SIGNAL_CHANNELS } from "@/lib/analytics/signals";
import { ORDER_CHANNELS, type OrderChannel, type OrderView } from "@/types/order-view";

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

  it("passes 'button' through: the seller's own buy button on their website", () => {
    expect(toChannel("button")).toBe("button");
  });

  it("does not trust a near miss", () => {
    expect(toChannel("Button")).toBe("embed");
    expect(toChannel(["button"])).toBe("embed");
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

/** The channel list of the LAST definition of a CHECK in the replayed schema,
 *  i.e. the one the database actually enforces. */
function replayedChannelCheck(constraint: string): string[] {
  const sql = readFileSync(join(process.cwd(), "tests/db/prod-migrations.sql"), "utf8");
  const pattern = new RegExp(`add constraint ${constraint}\\s+check \\(channel in \\(([^)]*)\\)\\)`, "g");
  const lists = [...sql.matchAll(pattern)].map((match) => match[1]);
  expect(lists.length, `${constraint} is never defined`).toBeGreaterThan(0);
  return [...lists.at(-1)!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("the channel vocabulary", () => {
  it("is one list", () => {
    // Compile-time as well: a value missing from the type fails the build.
    const channels: OrderChannel[] = ["embed", "marketplace", "direct", "button"];
    expect([...ORDER_CHANNELS]).toEqual(channels);
  });

  it("matches the CHECK on both tables, so no write is refused silently", () => {
    expect(replayedChannelCheck("orders_channel_check")).toEqual([...ORDER_CHANNELS]);
    expect(replayedChannelCheck("storefront_signals_channel_check")).toEqual([...ORDER_CHANNELS]);
  });

  it("is the same list for signals, so a visit and its sale are filed alike", () => {
    expect(SIGNAL_CHANNELS).toBe(ORDER_CHANNELS);
  });
});
