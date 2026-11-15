import {
  buildAttentionItems,
  type AttentionItem,
  type ProfileAttentionData,
  type StorefrontAttentionInfo,
} from "@/lib/dashboard/attention";
import type { DashboardOrdersData, ProductsSummary } from "@/lib/dashboard/queries";
import type { RestockForecast } from "@/lib/predictions";

/**
 * The store states the lab draws "Needs attention" over. Every row comes out
 * of the REAL builder (lib/dashboard/attention.ts), so the copy, counts, order
 * and destinations are exactly what the overview would show for that store.
 */

const TERMS = "tos-2026-10-31";

const ORDERS: DashboardOrdersData = {
  available: true,
  last30d: { revenue: { EUR: 3_285_000 }, sales: 30, aov: { EUR: 109_495 } },
  allTime: { revenue: { EUR: 9_120_000 }, sales: 88, aov: { EUR: 103_636 } },
  salesTrend: { points: [], tone: "flat" },
  aovTrend: { points: [], tone: "flat" },
  recentOrders: [],
  refundedCount: 0,
  disputedCount: 0,
};

const PRODUCTS: ProductsSummary = {
  total: 14,
  missingImage: [],
  noBuyPathCount: 0,
  hasPhysicalProducts: true,
  activeProductIds: [],
  checkingProductIds: [],
  pausedProductIds: [],
};

const STOREFRONTS: StorefrontAttentionInfo = {
  total: 1,
  rows: [{ id: "sf-main", blockCount: 12 }],
  noindexProductPageCount: 0,
  deadBlockCount: 0,
  firstNoindexStorefrontId: null,
  firstDeadBlockStorefrontId: null,
};

const PROFILE: ProfileAttentionData = {
  taxBusinessName: "Alder & Oak",
  sellerEmail: "hello@alder-oak.example",
  sellerAddress: "Hlavní 1, Brno",
  shippingPolicySet: true,
  shippingRatesSet: true,
  legalAcceptedVersion: TERMS,
};

const RESTOCKS: RestockForecast[] = [
  { id: "p-chair", title: "Alder Rocking Chair", daysLeft: 1 },
  { id: "p-stool", title: "Walnut Step Stool", daysLeft: 3 },
  { id: "p-bowl", title: "Turned Ash Bowl", daysLeft: 6 },
];

type Inputs = Parameters<typeof buildAttentionItems>[0];

const BASE: Inputs = {
  orders: ORDERS,
  products: PRODUCTS,
  storefronts: STOREFRONTS,
  profile: PROFILE,
  termsInForce: TERMS,
  stripeConnected: true,
  stripeConnectAvailable: false,
  twoFactorEnabled: true,
  checkoutOpen: true,
};

export type AttentionScenario = { id: string; label: string; note: string; items: AttentionItem[] };

function scenario(id: string, label: string, note: string, inputs: Partial<Inputs>): AttentionScenario {
  return { id, label, note, items: buildAttentionItems({ ...BASE, ...inputs }) };
}

export const SCENARIOS: readonly AttentionScenario[] = [
  scenario("screenshot", "Busy store (your screenshot)", "The five rows from the phone screenshot: to ship, selling out, a missing image, flagged orders, dead slots.", {
    toShipCount: 25,
    restocks: RESTOCKS,
    products: { ...PRODUCTS, missingImage: [{ id: "p-ember", title: "Ember Oak Side Table" }] },
    orders: { ...ORDERS, disputedCount: 42, refundedCount: 82 },
    storefronts: { ...STOREFRONTS, deadBlockCount: 4, firstDeadBlockStorefrontId: "sf-main" },
  }),
  scenario("two", "Two rows", "A normal day: a few orders to ship and one product running low.", {
    toShipCount: 3,
    restocks: RESTOCKS.slice(0, 1),
  }),
  scenario("one", "One row", "Just orders to ship.", { toShipCount: 1 }),
  scenario("everything", "Everything at once", "Every row the builder can produce on one store, at its longest copy: the worst case for a phone.", {
    toShipCount: 25,
    withdrawalsToSettle: 2,
    restocks: RESTOCKS,
    twoFactorEnabled: false,
    products: {
      ...PRODUCTS,
      missingImage: [{ id: "p-ember", title: "Ember Oak Side Table" }, { id: "p-2", title: "Linen Throw" }],
      noBuyPathCount: 3,
      pausedProductIds: ["p-x"],
    },
    profile: { ...PROFILE, sellerEmail: null, shippingRatesSet: false, legalAcceptedVersion: "tos-2026-01-01" },
    orders: { ...ORDERS, disputedCount: 42, refundedCount: 82 },
    storefronts: {
      ...STOREFRONTS,
      noindexProductPageCount: 1,
      firstNoindexStorefrontId: "sf-main",
      deadBlockCount: 4,
      firstDeadBlockStorefrontId: "sf-main",
    },
  }),
  scenario("setup", "Setup left over", "No orders waiting: only things about the store's own setup.", {
    twoFactorEnabled: false,
    profile: { ...PROFILE, legalAcceptedVersion: "tos-2026-01-01" },
    products: { ...PRODUCTS, missingImage: [{ id: "p-ember", title: "Ember Oak Side Table" }, { id: "p-2", title: "Linen Throw" }] },
  }),
  scenario("clear", "All clear", "Nothing to do: the calm one-liner.", {}),
];

export const SCENARIO_IDS = SCENARIOS.map((entry) => entry.id);

export function scenarioById(id: string): AttentionScenario {
  return SCENARIOS.find((entry) => entry.id === id) ?? SCENARIOS[0]!;
}
