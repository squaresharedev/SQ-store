import { describe, expect, it } from "vitest";
import {
  FUNNEL_EVENTS,
  FUNNEL_MIN_VIEWS,
  funnelPointSchema,
  funnelRate,
} from "@/lib/analytics/funnel/events";
import { FUNNEL_BLOBS, FUNNEL_DATASET, recordFunnelPoint } from "@/lib/analytics/funnel/record";
import {
  ROLLUP_ROW_CAP,
  daySql,
  finishedDays,
  readDayAnswer,
  rollupConfig,
} from "@/lib/analytics/funnel/rollup";
import {
  buildFunnel,
  checkoutAbandonment,
  funnelHasActivity,
  ordersPer100Views,
} from "@/lib/analytics/funnel/summary";
import { emptyAnalyticsData, emptySignalsData } from "@/lib/analytics/queries";
import type { FunnelData } from "@/lib/analytics/types";
import { readFileSync } from "node:fs";

// The storefront funnel: what a data point may hold, how a day is rolled up,
// and when the page shows a rate.

const SELLER = "11111111-1111-4111-8111-111111111111";
const STORE = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const point = { sellerId: SELLER, storeId: STORE, productId: PRODUCT, event: "checkout_started" as const };

describe("a funnel data point", () => {
  it("is the six fields and nothing else", () => {
    expect(funnelPointSchema.parse(point)).toEqual({ ...point, referrerHost: "", placementId: "" });
    // A field nobody decided on is refused, not quietly kept or dropped.
    for (const extra of ["visitorId", "ip", "userAgent", "url", "amountCents"]) {
      expect(funnelPointSchema.safeParse({ ...point, [extra]: "x" }).success, extra).toBe(false);
    }
  });

  it("takes a hostname for the site, and nothing longer than one", () => {
    for (const host of ["", "shop.example.com", "example.com", "xn--bcher-kva.example"]) {
      expect(funnelPointSchema.safeParse({ ...point, referrerHost: host }).success, host).toBe(true);
    }
    for (const notHost of [
      "https://shop.example.com",
      "shop.example.com/page",
      "shop.example.com?utm=1",
      "shop.example.com:8080",
      "Shop.Example.com",
      "user@example.com",
      "192.168.0.1/x",
      "a b",
    ]) {
      expect(funnelPointSchema.safeParse({ ...point, referrerHost: notHost }).success, notHost).toBe(false);
    }
  });

  it("only knows the listed events and real ids", () => {
    expect(funnelPointSchema.safeParse({ ...point, event: "page_scroll" }).success).toBe(false);
    expect(funnelPointSchema.safeParse({ ...point, sellerId: "me" }).success).toBe(false);
    expect(funnelPointSchema.safeParse({ ...point, productId: "" }).success).toBe(false);
  });

  it("has the same event list as the table's CHECK", () => {
    const sql = readFileSync("supabase/migrations/20261012_storefront_funnel_daily.sql", "utf8");
    const check = /check \(event in \(([^)]*)\)\)/.exec(sql.replace(/\s+/g, " "));
    expect(check, "no event CHECK in the migration").toBeTruthy();
    const listed = [...check![1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(listed).toEqual([...FUNNEL_EVENTS]);
  });
});

describe("recording a point", () => {
  it("refuses a malformed one without throwing", async () => {
    await expect(recordFunnelPoint({ ...point, storeId: "" })).resolves.toBe("invalid");
  });

  it("writes nothing, quietly, where there is no Analytics Engine binding", async () => {
    await expect(recordFunnelPoint(point)).resolves.toBe("skipped");
  });
});

describe("the daily rollup", () => {
  it("rolls finished UTC days only, oldest first", () => {
    expect(finishedDays(new Date("2026-10-10T00:00:01Z"))).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(finishedDays(new Date("2026-03-01T23:59:59Z"), 2)).toEqual(["2026-02-27", "2026-02-28"]);
  });

  it("asks for one whole day, weighted by the sample interval", () => {
    const sql = daySql("2026-10-09");
    expect(sql).toContain(`FROM ${FUNNEL_DATASET} `);
    expect(sql).toContain("timestamp >= toDateTime('2026-10-09 00:00:00')");
    expect(sql).toContain("timestamp < toDateTime('2026-10-10 00:00:00')");
    expect(sql).toContain("SUM(_sample_interval) AS events");
    expect(sql).not.toMatch(/COUNT\(/i);
    // The columns are read in the order the writer lays them out.
    FUNNEL_BLOBS.forEach((_, index) => expect(sql).toContain(`blob${index + 1} AS `));
    expect(() => daySql("2026-10-09'; DROP")).toThrow();
  });

  it("keeps the groups that are valid points and counts the rest", () => {
    const group = {
      seller_id: SELLER,
      store_id: STORE,
      product_id: PRODUCT,
      event: "checkout_expired",
      referrer_host: "",
      placement_id: "",
      // A 64-bit sum arrives as a string.
      events: "7",
    };
    const answer = readDayAnswer({
      meta: [],
      data: [
        group,
        { ...group, event: "made_up" },
        { ...group, seller_id: "not-a-uuid" },
        { ...group, referrer_host: "https://evil.example/path" },
        { ...group, events: "0" },
      ],
      rows: 5,
    });
    expect(answer).toEqual({
      rows: [{ ...group, events: 7 }],
      dropped: 4,
      capped: false,
    });
    expect(readDayAnswer({ errors: ["nope"] })).toBeNull();
    expect(readDayAnswer("<html>")).toBeNull();
    expect(readDayAnswer({ data: Array.from({ length: ROLLUP_ROW_CAP }, () => group) })?.capped).toBe(true);
  });

  it("is off until it has both an account id and a token", () => {
    const before = { ...process.env };
    try {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.FUNNEL_ANALYTICS_TOKEN;
      expect(rollupConfig()).toBeNull();
      process.env.FUNNEL_ANALYTICS_TOKEN = "token";
      process.env.CLOUDFLARE_ACCOUNT_ID = "../../zones";
      expect(rollupConfig()).toBeNull();
      process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
      expect(rollupConfig()).toEqual({ accountId: "0123456789abcdef0123456789abcdef", token: "token" });
    } finally {
      process.env = before;
    }
  });
});

describe("the funnel the page shows", () => {
  const funnel = (over: Partial<FunnelData> = {}): FunnelData => ({
    checkoutsAvailable: true,
    embedViews: 200,
    productOpens: 40,
    embedOrders: 6,
    checkoutsStarted: 10,
    checkoutsExpired: 4,
    ...over,
  });

  it("works the two rates out of the counts", () => {
    expect(ordersPer100Views(funnel())).toBe(3);
    expect(checkoutAbandonment(funnel())).toBe(40);
    expect(funnelRate(1, 0)).toBeNull();
  });

  it("shows no rate below the view threshold, whatever the counts say", () => {
    const thin = funnel({ embedViews: FUNNEL_MIN_VIEWS - 1 });
    expect(ordersPer100Views(thin)).toBeNull();
    expect(checkoutAbandonment(thin)).toBeNull();
    expect(ordersPer100Views(funnel({ embedViews: FUNNEL_MIN_VIEWS, embedOrders: 1 }))).toBe(2);
  });

  it("has no abandonment without a checkout, or without the counts", () => {
    expect(checkoutAbandonment(funnel({ checkoutsStarted: 0, checkoutsExpired: 0 }))).toBeNull();
    expect(checkoutAbandonment(funnel({ checkoutsAvailable: false }))).toBeNull();
  });

  it("reads views, opens and orders from the embed's share only", () => {
    const sales = emptyAnalyticsData(true);
    sales.channels = [
      { channel: "embed", revenueCents: 9000, sales: 3 },
      { channel: "direct", revenueCents: 50000, sales: 20 },
    ] as typeof sales.channels;
    const signals = emptySignalsData(true);
    signals.byKind.storefront_view.channels = [
      { channel: "embed", count: 120 },
      { channel: "direct", count: 900 },
    ] as typeof signals.byKind.storefront_view.channels;
    signals.byKind.product_click.channels = [{ channel: "embed", count: 30 }] as typeof signals.byKind.product_click.channels;

    expect(buildFunnel(sales, signals, { started: 8, expired: 2 })).toEqual({
      checkoutsAvailable: true,
      embedViews: 120,
      productOpens: 30,
      embedOrders: 3,
      checkoutsStarted: 8,
      checkoutsExpired: 2,
    });
    // Unreadable checkout counts are "unknown", never zero.
    const unknown = buildFunnel(sales, signals, null);
    expect(unknown.checkoutsAvailable).toBe(false);
    expect(funnelHasActivity(unknown)).toBe(true);
    expect(funnelHasActivity(buildFunnel(emptyAnalyticsData(true), emptySignalsData(true), null))).toBe(false);
  });
});
