// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildAttentionItems,
  type ProfileAttentionData,
  type StorefrontAttentionInfo,
} from "@/lib/dashboard/attention";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";
import { LEGAL_VERSION } from "@/lib/settings/constants";

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

const NO_PRODUCTS: ProductsSummary = {
  total: 0,
  missingImage: [],
  noBuyPathCount: 0,
  hasPhysicalProducts: false,
  activeProductIds: [],
};

const NO_STOREFRONTS: StorefrontAttentionInfo = {
  total: 0,
  rows: [],
  noindexProductPageCount: 0,
  deadBlockCount: 0,
  firstNoindexStorefrontId: null,
};

const HEALTHY_PROFILE: ProfileAttentionData = {
  taxBusinessName: "Acme Prints",
  sellerEmail: "acme@example.com",
  // All three trader fields set: this profile can publish, so the gate's
  // attention row stays out of every test that does not ask for it.
  sellerAddress: "12 Market Street, Dublin",
  shippingPolicySet: true,
  legalAcceptedVersion: LEGAL_VERSION,
};

function build(overrides: {
  orders?: Partial<DashboardOrdersData>;
  products?: Partial<ProductsSummary>;
  storefronts?: Partial<StorefrontAttentionInfo>;
  profile?: ProfileAttentionData | null;
  stripeConnected?: boolean;
} = {}) {
  const items = buildAttentionItems({
    orders: { ...NO_ORDERS, ...overrides.orders },
    products: { ...NO_PRODUCTS, ...overrides.products },
    storefronts: { ...NO_STOREFRONTS, ...overrides.storefronts },
    profile: overrides.profile !== undefined ? overrides.profile : HEALTHY_PROFILE,
    stripeConnected: overrides.stripeConnected ?? true,
  });
  return new Map(items.map((item) => [item.key, item]));
}

/** Every branch of the builder, so the route check below covers them all. */
const ALL_BRANCHES = [
  // Stripe not connected
  build({ stripeConnected: false }),
  // No seller identity
  build({ profile: { ...HEALTHY_PROFILE, taxBusinessName: null } }),
  // Legal not accepted
  build({ profile: { ...HEALTHY_PROFILE, legalAcceptedVersion: null } }),
  build({ profile: { ...HEALTHY_PROFILE, legalAcceptedVersion: "2025-01-old" } }),
  // No buy path
  build({
    products: { noBuyPathCount: 2 },
    profile: { ...HEALTHY_PROFILE, sellerEmail: null },
  }),
  build({
    products: { noBuyPathCount: 1 },
    profile: { ...HEALTHY_PROFILE, sellerEmail: null },
  }),
  // No shipping
  build({
    products: { hasPhysicalProducts: true },
    profile: { ...HEALTHY_PROFILE, shippingPolicySet: false },
  }),
  // Storefront: none saved
  build(),
  // Storefront: saved but empty
  build({ storefronts: { total: 1, rows: [{ id: "sf-1", blockCount: 0 }] } }),
  // Missing images: one product
  build({ products: { missingImage: [{ id: "p-1", title: "Only one" }] } }),
  // Missing images: multiple products
  build({
    products: {
      missingImage: [
        { id: "p-1", title: "One" },
        { id: "p-2", title: "Two" },
      ],
    },
  }),
  // Flagged orders: disputed only
  build({ orders: { disputedCount: 2, refundedCount: 0 } }),
  // Flagged orders: refunded only
  build({ orders: { disputedCount: 0, refundedCount: 3 } }),
  // Flagged orders: both
  build({ orders: { disputedCount: 1, refundedCount: 1 } }),
  // Noindex product pages: one storefront
  build({
    storefronts: {
      total: 1,
      rows: [{ id: "sf-1", blockCount: 4 }],
      noindexProductPageCount: 1,
      firstNoindexStorefrontId: "sf-1",
    },
  }),
  // Noindex product pages: multiple storefronts
  build({
    storefronts: {
      total: 2,
      rows: [
        { id: "sf-1", blockCount: 4 },
        { id: "sf-2", blockCount: 4 },
      ],
      noindexProductPageCount: 2,
      firstNoindexStorefrontId: "sf-1",
    },
  }),
  // Dead blocks
  build({ storefronts: { deadBlockCount: 1 } }),
  build({ storefronts: { deadBlockCount: 3 } }),
];

describe("needs-attention destinations", () => {
  it("sends the Stripe row to /payments, where the connection lives", () => {
    // Not /settings: nothing on the account settings tabs connects Stripe.
    expect(build({ stripeConnected: false }).get("stripe")?.href).toBe("/payments");
  });

  it("hides the Stripe row when already connected", () => {
    expect(build({ stripeConnected: true }).get("stripe")).toBeUndefined();
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
      products: { missingImage: [{ id: "p-1", title: "Only one" }] },
    }).get("images");
    expect(item?.href).toBe("/products/p-1/edit");
  });

  it("falls back to the product list when several lack images", () => {
    const item = build({
      products: {
        missingImage: [
          { id: "p-1", title: "One" },
          { id: "p-2", title: "Two" },
        ],
      },
    }).get("images");
    expect(item?.href).toBe("/products");
  });

  it("filters the orders list by the one flagged status", () => {
    expect(
      build({ orders: { disputedCount: 2 } }).get("flagged-orders")?.href,
    ).toBe("/orders?status=disputed");
    expect(
      build({ orders: { refundedCount: 3 } }).get("flagged-orders")?.href,
    ).toBe("/orders?status=refunded");
  });

  it("leaves the orders list unfiltered when both statuses are flagged", () => {
    // Filtering on one would hide orders the row just counted.
    const item = build({
      orders: { disputedCount: 1, refundedCount: 1 },
    }).get("flagged-orders");
    expect(item?.href).toBe("/orders");
    expect(item?.description).toBe("1 disputed, 1 refunded.");
  });

  it("never counts a status it does not describe", () => {
    const item = build({ orders: { refundedCount: 2 } }).get("flagged-orders");
    expect(item?.label).toBe("2 orders to review");
    expect(item?.description).toBe("2 refunded.");
  });

  // --- New rows -------------------------------------------------------

  it("adds the no-seller-identity row when business name is missing", () => {
    const item = build({
      profile: { ...HEALTHY_PROFILE, taxBusinessName: null },
    }).get("no-seller-identity");
    // Deep-links to the field that is actually blank, not to the page's top.
    expect(item?.href).toBe("/settings/tax#business-name");
    expect(item?.actionLabel).toBe("Add seller details");
    expect(item?.label).toBe("You can't publish or sell yet");
  });

  it("adds the no-seller-identity row for a missing address or contact email", () => {
    // Each required trader field blocks publishing on its own; the row names
    // whichever ones are missing and points at the first of them.
    const noAddress = build({
      profile: { ...HEALTHY_PROFILE, sellerAddress: null },
    }).get("no-seller-identity");
    expect(noAddress?.href).toBe("/settings/tax#address");
    expect(noAddress?.description).toContain("business address");

    const noEmail = build({
      profile: { ...HEALTHY_PROFILE, sellerEmail: null },
    }).get("no-seller-identity");
    expect(noEmail?.href).toBe("/settings/tax#contact-email");
    expect(noEmail?.description).toContain("contact email");

    const neither = build({
      profile: { ...HEALTHY_PROFILE, sellerAddress: null, sellerEmail: null },
    }).get("no-seller-identity");
    expect(neither?.description).toContain("business address and contact email");
  });

  it("hides the no-seller-identity row when every required trader field is set", () => {
    expect(
      build({ profile: { ...HEALTHY_PROFILE, taxBusinessName: "Acme" } }).get(
        "no-seller-identity",
      ),
    ).toBeUndefined();
  });

  it("hides all profile rows when profile is null (soft-fail read)", () => {
    const keys = [...build({ profile: null }).keys()];
    expect(keys).not.toContain("no-seller-identity");
    expect(keys).not.toContain("no-legal");
    expect(keys).not.toContain("no-buy-path");
    expect(keys).not.toContain("no-shipping");
  });

  it("adds the no-legal row when legal has never been accepted", () => {
    const item = build({
      profile: { ...HEALTHY_PROFILE, legalAcceptedVersion: null },
    }).get("no-legal");
    expect(item?.href).toBe("/settings/legal");
  });

  it("adds the no-legal row when an older legal version was accepted", () => {
    const item = build({
      profile: { ...HEALTHY_PROFILE, legalAcceptedVersion: "2025-01-old" },
    }).get("no-legal");
    expect(item).toBeDefined();
  });

  it("hides the no-legal row when the current version is accepted", () => {
    const item = build({
      profile: { ...HEALTHY_PROFILE, legalAcceptedVersion: LEGAL_VERSION },
    }).get("no-legal");
    expect(item).toBeUndefined();
  });

  it("adds the no-buy-path row when active products have no buy link and no email", () => {
    const item = build({
      products: { noBuyPathCount: 3 },
      profile: { ...HEALTHY_PROFILE, sellerEmail: null },
    }).get("no-buy-path");
    expect(item?.href).toBe("/products");
    expect(item?.label).toContain("3 products");
  });

  it("hides the no-buy-path row when the account has a contact email", () => {
    const item = build({
      products: { noBuyPathCount: 3 },
      profile: { ...HEALTHY_PROFILE, sellerEmail: "seller@example.com" },
    }).get("no-buy-path");
    expect(item).toBeUndefined();
  });

  it("hides the no-buy-path row when all products have a purchase_url", () => {
    const item = build({
      products: { noBuyPathCount: 0 },
      profile: { ...HEALTHY_PROFILE, sellerEmail: null },
    }).get("no-buy-path");
    expect(item).toBeUndefined();
  });

  it("adds the no-shipping row for physical products without shipping terms", () => {
    const item = build({
      products: { hasPhysicalProducts: true },
      profile: { ...HEALTHY_PROFILE, shippingPolicySet: false },
    }).get("no-shipping");
    expect(item?.href).toBe("/settings/shipping");
  });

  it("hides the no-shipping row when shipping terms are set", () => {
    const item = build({
      products: { hasPhysicalProducts: true },
      profile: { ...HEALTHY_PROFILE, shippingPolicySet: true },
    }).get("no-shipping");
    expect(item).toBeUndefined();
  });

  it("hides the no-shipping row when there are no physical products", () => {
    const item = build({
      products: { hasPhysicalProducts: false },
      profile: { ...HEALTHY_PROFILE, shippingPolicySet: false },
    }).get("no-shipping");
    expect(item).toBeUndefined();
  });

  it("adds the noindex row and links to the storefront designer", () => {
    const item = build({
      storefronts: {
        total: 1,
        rows: [{ id: "sf-1", blockCount: 4 }],
        noindexProductPageCount: 1,
        firstNoindexStorefrontId: "sf-1",
      },
    }).get("noindex-product-pages");
    expect(item?.href).toBe("/storefront/sf-1");
    expect(item?.actionLabel).toBe("Open designer");
  });

  it("falls back to the storefront list for the noindex row when no specific id", () => {
    const item = build({
      storefronts: {
        noindexProductPageCount: 2,
        firstNoindexStorefrontId: null,
      },
    }).get("noindex-product-pages");
    expect(item?.href).toBe("/storefront");
  });

  it("hides the noindex row when all product pages are indexed", () => {
    expect(
      build({ storefronts: { noindexProductPageCount: 0 } }).get(
        "noindex-product-pages",
      ),
    ).toBeUndefined();
  });

  it("adds the dead-blocks row with a count in the label", () => {
    const item = build({ storefronts: { deadBlockCount: 3 } }).get("dead-blocks");
    expect(item?.href).toBe("/storefront");
    expect(item?.label).toContain("3 storefront blocks");
  });

  it("uses the singular label for a single dead block", () => {
    const item = build({ storefronts: { deadBlockCount: 1 } }).get("dead-blocks");
    expect(item?.label).toContain("1 storefront block");
    expect(item?.label).not.toContain("blocks");
  });

  it("hides the dead-blocks row when there are no dead blocks", () => {
    expect(build({ storefronts: { deadBlockCount: 0 } }).get("dead-blocks")).toBeUndefined();
  });

  it("says nothing at all when there is nothing to say", () => {
    // With Stripe connected and a healthy profile, an otherwise clean store
    // should produce an empty list.
    const items = buildAttentionItems({
      orders: NO_ORDERS,
      products: { ...NO_PRODUCTS, total: 3 },
      storefronts: {
        ...NO_STOREFRONTS,
        total: 1,
        rows: [{ id: "sf-1", blockCount: 6 }],
      },
      profile: HEALTHY_PROFILE,
      stripeConnected: true,
    });
    expect(items).toHaveLength(0);
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
    expect(routeExists("/settings/tax")).toBe(true);
    expect(routeExists("/settings/shipping")).toBe(true);
    expect(routeExists("/settings/legal")).toBe(true);
  });

  it("rejects paths with no page", () => {
    expect(routeExists("/nope")).toBe(false);
    expect(routeExists("/products/anything")).toBe(false);
  });
});
