// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAge } from "@/lib/format/date";
import { buyerMailto } from "@/lib/orders/buyer-mailto";
import { OVERDUE_AFTER_DAYS, isOverdue } from "@/lib/orders/fulfilment";
import {
  orderNumber,
  orderNumberLabel,
  orderNumberRange,
  parseOrderNumberQuery,
} from "@/lib/orders/order-number";
import { entitiesLead } from "@/lib/search/lead";
import { buildSnapshotGroups } from "@/lib/search/snapshot-groups";
import { EMPTY_SNAPSHOT } from "@/lib/search/types";
import { english } from "../setup/translate";

// The small pure pieces behind "a seller can find an order, tell how long it has
// waited and write to the buyer": the number the buyer quotes, the search that
// recognises it, the age cue on the queue and the mail link.

const ID = "44561113-aaaa-4bbb-8ccc-dddddddddddd";

describe("the order number", () => {
  it("is the first eight characters of the id, upper-cased", () => {
    expect(orderNumber("4456111a-aaaa-4bbb-8ccc-dddddddddddd")).toBe("4456111A");
    expect(orderNumberLabel(ID)).toBe("#44561113");
  });

  it("is recognised as typed, with or without the hash, in any case", () => {
    expect(parseOrderNumberQuery("44561113")).toBe("44561113");
    expect(parseOrderNumberQuery("#4456111A")).toBe("4456111a");
    expect(parseOrderNumberQuery("  # 4456  ")).toBe("4456");
  });

  it("is not claimed for words, short fragments or anything that is not hex", () => {
    expect(parseOrderNumberQuery("445")).toBeNull();
    expect(parseOrderNumberQuery("mug")).toBeNull();
    expect(parseOrderNumberQuery("4456111G")).toBeNull();
    expect(parseOrderNumberQuery("445611130")).toBeNull();
    expect(parseOrderNumberQuery("blue mug")).toBeNull();
  });

  it("turns a prefix into the range of ids that begin with it", () => {
    expect(orderNumberRange("44561113")).toEqual({
      from: "44561113-0000-0000-0000-000000000000",
      to: "44561113-ffff-ffff-ffff-ffffffffffff",
    });
    // A partial number is a wider range, and the real id sits inside it.
    const { from, to } = orderNumberRange("4456");
    expect(from).toBe("44560000-0000-0000-0000-000000000000");
    expect(to).toBe("4456ffff-ffff-ffff-ffff-ffffffffffff");
    expect(ID >= from && ID <= to).toBe(true);
  });
});

describe("what leads the search palette", () => {
  it("puts the account's things first for an email or an order number", () => {
    expect(entitiesLead("anna@example.com")).toBe(true);
    expect(entitiesLead("#44561113")).toBe(true);
    expect(entitiesLead("4456")).toBe(true);
  });

  it("leaves places to go ahead of things for everything else", () => {
    expect(entitiesLead("")).toBe(false);
    expect(entitiesLead("   ")).toBe(false);
    expect(entitiesLead("settings")).toBe(false);
    expect(entitiesLead("refund")).toBe(false);
    expect(entitiesLead("@")).toBe(false);
  });
});

describe("order rows in the instant (snapshot) search", () => {
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    orders: [
      { id: ID, product_title: "Blue mug", buyer_email: "anna@example.com", status: "paid" },
      {
        id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
        product_title: "Red plate",
        buyer_email: null,
        status: "paid",
      },
    ],
  };

  it("finds an order by the number the buyer quoted", () => {
    const groups = buildSnapshotGroups(snapshot, "44561113", english);
    const orders = groups.find((group) => group.type === "order");
    expect(orders?.results.map((result) => result.title)).toEqual(["Blue mug"]);
  });

  it("finds it by the start of the number too", () => {
    const groups = buildSnapshotGroups(snapshot, "4456", english);
    expect(groups.find((group) => group.type === "order")?.results[0]?.title).toBe("Blue mug");
  });

  it("shows the number on the row, before the buyer", () => {
    const groups = buildSnapshotGroups(snapshot, "mug", english);
    expect(groups[0]?.results[0]?.subtitle).toBe("#44561113 · anna@example.com");
    const plate = buildSnapshotGroups(snapshot, "plate", english)[0]?.results[0];
    expect(plate?.subtitle).toBe("#99999999");
  });
});

describe("the mail link to a buyer", () => {
  it("carries the subject, encoded", () => {
    expect(buyerMailto("anna@example.com", "Your order 44561113")).toBe(
      "mailto:anna@example.com?subject=Your%20order%2044561113",
    );
  });

  it("does not let an address smuggle in extra headers", () => {
    // `?` and `&` would start a second header (bcc=…); they are encoded, so the
    // whole thing stays one address.
    const link = buyerMailto("a@b.com?bcc=evil@x.com&cc=x@y.com", "Hi");
    expect(link.startsWith("mailto:a@b.com%3Fbcc%3Devil@x.com%26cc%3Dx@y.com?subject=")).toBe(true);
    expect(link.match(/\?/g)).toHaveLength(1);
  });
});

describe("how long an order has waited", () => {
  const NOW = new Date("2026-09-30T12:00:00Z");

  it("reads in the unit that fits, in the reader's language", () => {
    expect(formatAge("2026-09-30T11:40:00Z", "en", NOW)).toBe("20 minutes ago");
    expect(formatAge("2026-09-30T09:00:00Z", "en", NOW)).toBe("3 hours ago");
    expect(formatAge("2026-09-27T12:00:00Z", "en", NOW)).toBe("3 days ago");
    expect(formatAge("2026-09-29T11:00:00Z", "en", NOW)).toBe("yesterday");
    expect(formatAge("2026-09-20T12:00:00Z", "de", NOW)).toBe("vor 10 Tagen");
  });

  it("says nothing for a date it cannot read", () => {
    expect(formatAge("not a date", "en", NOW)).toBeNull();
  });

  it("calls an order overdue only after the house limit", () => {
    const limitAgo = new Date(NOW.getTime() - OVERDUE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    expect(isOverdue(limitAgo.toISOString(), NOW)).toBe(false);
    expect(isOverdue(new Date(limitAgo.getTime() - 1000).toISOString(), NOW)).toBe(true);
    expect(isOverdue("2026-09-30T08:00:00Z", NOW)).toBe(false);
    expect(isOverdue("nonsense", NOW)).toBe(false);
  });
});
