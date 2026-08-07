// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildAttentionItems,
  type StorefrontAttentionInfo,
} from "@/lib/dashboard/attention";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";

/**
 * The "Needs attention" module is a list of DESTINATIONS. A row that describes
 * a problem but drops the seller somewhere that cannot fix it (Stripe -> the
 * account settings tab, flagged orders -> an anchor on the page you are already
 * on) is worse than no row at all. These tests pin both halves: the href each
 * row produces, and that the href resolves to a real App Router page.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/**
 * Resolve a URL path against the App Router tree the way Next does: route
 * groups "(x)" are transparent, "[param]" matches any single segment, and a
 * route exists only if the final directory holds a page.tsx.
 */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean);

  const walk = (dir: string, rest: string[]): boolean => {
    // A page can sit one or more route groups deep (/storefront lives in
    // storefront/(list)/page.tsx), so the leaf check descends through them too.
    if (rest.length === 0 && existsSync(join(dir, "page.tsx"))) return true;
    const [head, ...tail] = rest;
    const entries = readdirSync(dir).filter((entry) =>
      statSync(join(dir, entry)).isDirectory(),
    );
    for (const entry of entries) {
      // Route groups consume no URL segment.
      if (entry.startsWith("(") && entry.endsWith(")")) {
        if (walk(join(dir, entry), rest)) return true;
        continue;
      }
      if (rest.length === 0) continue;
      const matches = entry === head || /^\[.+\]$/.test(entry);
      if (matches && walk(join(dir, entry), tail)) return true;
    }
    return false;
  };

  return walk(APP_DIR, segments);
}

const NO_ORDERS: DashboardOrdersData = {
  available: true,
  last30d: { revenue: {}, sales: 0, aov: {} },
  allTime: { revenue: {}, sales: 0, aov: {} },
  salesTrend: { points: [], tone: "flat" },
  aovTrend: { points: [], tone: "flat" },
  recentOrders: [],
  refundedCount: 0,
  disputedCount: 0,
};

const NO_PRODUCTS: ProductsSummary = { total: 0, missingImage: [] };
const NO_STOREFRONTS: StorefrontAttentionInfo = { total: 0, rows: [] };

function build(overrides: {
  orders?: Partial<DashboardOrdersData>;
  products?: ProductsSummary;
  storefronts?: StorefrontAttentionInfo;
} = {}) {
  const items = buildAttentionItems({
    orders: { ...NO_ORDERS, ...overrides.orders },
    products: overrides.products ?? NO_PRODUCTS,
    storefronts: overrides.storefronts ?? NO_STOREFRONTS,
  });
  return new Map(items.map((item) => [item.key, item]));
}

/** Every branch of the builder, so the route check below covers them all. */
const ALL_BRANCHES = [
  build(),
  build({ storefronts: { total: 1, rows: [{ id: "sf-1", blockCount: 0 }] } }),
  build({
    products: { total: 1, missingImage: [{ id: "p-1", title: "Only one" }] },
  }),
  build({
    products: {
      total: 2,
      missingImage: [
        { id: "p-1", title: "One" },
        { id: "p-2", title: "Two" },
      ],
    },
  }),
  build({ orders: { disputedCount: 2, refundedCount: 0 } }),
  build({ orders: { disputedCount: 0, refundedCount: 3 } }),
  build({ orders: { disputedCount: 1, refundedCount: 1 } }),
];

describe("needs-attention destinations", () => {
  it("sends the Stripe row to /payments, where the connection lives", () => {
    // Not /settings: nothing on the account settings tabs connects Stripe.
    expect(build().get("stripe")?.href).toBe("/payments");
  });

  it("opens the storefront list when none is saved yet", () => {
    const item = build().get("storefront");
    expect(item?.href).toBe("/storefront");
    expect(item?.actionLabel).toBe("Create storefront");
  });

  it("opens the designer for the empty storefront itself", () => {
    const item = build({
      storefronts: {
        total: 2,
        rows: [
          { id: "full", blockCount: 4 },
          { id: "empty", blockCount: 0 },
        ],
      },
    }).get("storefront");
    // Only fires when the whole account is empty, but when it does the link
    // must point at the storefront that is actually missing blocks.
    expect(item).toBeUndefined();

    const single = build({
      storefronts: { total: 1, rows: [{ id: "sf-1", blockCount: 0 }] },
    }).get("storefront");
    expect(single?.href).toBe("/storefront/sf-1");
    expect(single?.actionLabel).toBe("Open designer");
  });

  it("opens the product editor when a single product lacks an image", () => {
    const item = build({
      products: { total: 1, missingImage: [{ id: "p-1", title: "Only one" }] },
    }).get("images");
    expect(item?.href).toBe("/products/p-1/edit");
  });

  it("falls back to the product list when several lack images", () => {
    const item = build({
      products: {
        total: 2,
        missingImage: [
          { id: "p-1", title: "One" },
          { id: "p-2", title: "Two" },
        ],
      },
    }).get("images");
    expect(item?.href).toBe("/products");
  });

  it("filters the orders list by the one flagged status", () => {
    expect(build({ orders: { disputedCount: 2 } }).get("flagged-orders")?.href).toBe(
      "/orders?status=disputed",
    );
    expect(build({ orders: { refundedCount: 3 } }).get("flagged-orders")?.href).toBe(
      "/orders?status=refunded",
    );
  });

  it("leaves the orders list unfiltered when both statuses are flagged", () => {
    // Filtering on one would hide orders the row just counted.
    const item = build({ orders: { disputedCount: 1, refundedCount: 1 } }).get(
      "flagged-orders",
    );
    expect(item?.href).toBe("/orders");
    expect(item?.description).toBe("1 disputed, 1 refunded.");
  });

  it("never counts a status it does not describe", () => {
    const item = build({ orders: { refundedCount: 2 } }).get("flagged-orders");
    expect(item?.label).toBe("2 orders to review");
    expect(item?.description).toBe("2 refunded.");
  });

  it("says nothing at all when there is nothing to say", () => {
    // Only the permanent Stripe row survives an otherwise healthy store.
    const items = buildAttentionItems({
      orders: NO_ORDERS,
      products: { total: 3, missingImage: [] },
      storefronts: { total: 1, rows: [{ id: "sf-1", blockCount: 6 }] },
    });
    expect(items.map((item) => item.key)).toEqual(["stripe"]);
  });

  it("only ever links to routes that exist", () => {
    const broken = ALL_BRANCHES.flatMap((items) => [...items.values()])
      .filter((item) => !item.href.startsWith("#"))
      .filter((item) => !routeExists(item.href))
      .map((item) => `${item.key} -> ${item.href}`);

    expect(broken).toEqual([]);
  });

  it("links in-app, never to a bare anchor or an external URL", () => {
    // "#recent-orders" used to send "N orders to review" to a card on the same
    // page that lists RECENT orders, flagged or not.
    const offenders = ALL_BRANCHES.flatMap((items) => [...items.values()])
      .filter((item) => !/^\/[^/]/.test(item.href))
      .map((item) => `${item.key} -> ${item.href}`);

    expect(offenders).toEqual([]);
  });

  it("gives every row an action label", () => {
    for (const items of ALL_BRANCHES) {
      for (const item of items.values()) {
        expect(item.actionLabel.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("route resolver", () => {
  // The guard above is only as good as this helper, so pin it both ways.
  it("resolves group, dynamic and query-bearing paths", () => {
    expect(routeExists("/payments")).toBe(true); // inside (dashboard)
    expect(routeExists("/orders?status=disputed")).toBe(true);
    expect(routeExists("/products/anything/edit")).toBe(true); // [id]
    expect(routeExists("/storefront/anything")).toBe(true);
  });

  it("rejects paths with no page", () => {
    expect(routeExists("/nope")).toBe(false);
    expect(routeExists("/products/anything")).toBe(false);
  });
});
