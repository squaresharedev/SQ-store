import { SIGNAL_KINDS, type SignalKind } from "@/lib/analytics/signals";
import type {
  AnalyticsSnapshot,
  FunnelData,
  RevenuePoint,
  SignalBreakdown,
  SignalPoint,
} from "@/lib/analytics/types";
import { ORDER_CHANNELS, type OrderStatus } from "@/types/order-view";

// Sample stores for the analytics lab: whole AnalyticsSnapshots, as the page
// gets them from the server. Deterministic (a seeded generator, fixed dates),
// so a link to a variation draws the same page for whoever opens it.

export const LAB_SCENARIOS = [
  { id: "growing", label: "Growing", note: "30 days, busier than the 30 before: the chip is green." },
  { id: "slowing", label: "Slowing", note: "30 days, quieter than the 30 before: the chip is grey, never red." },
  { id: "first", label: "First month", note: "30 days and nothing before them: no chip, no dashed line." },
  { id: "allTime", label: "All time", note: "Monthly buckets over a year, no period before." },
  { id: "oneDay", label: "One day", note: "A one-day range against the day before: a marked point, not a line." },
  { id: "quiet", label: "No sales", note: "A range with no sales but storefront traffic: the zero states." },
] as const;
export type LabScenario = (typeof LAB_SCENARIOS)[number]["id"];

/** A small seeded generator, so the noise is the same on every load. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** The day every daily range ends on. */
const LAST_DAY = Date.UTC(2026, 10, 7);

/** `count` daily dates ending `endOffset` days before LAST_DAY. */
function days(count: number, endOffset = 0): string[] {
  return Array.from({ length: count }, (_, i) => iso(LAST_DAY - (endOffset + count - 1 - i) * DAY_MS));
}

/** `count` monthly bucket starts ending in November 2026. */
function months(count: number): string[] {
  return Array.from({ length: count }, (_, i) => iso(Date.UTC(2026, 10 - (count - 1 - i), 1)));
}

/** Revenue buckets shaped by `level(share)` (0 at the start, 1 at the end). */
function revenueSeries(dates: string[], level: (share: number) => number, seed: number): RevenuePoint[] {
  const random = seeded(seed);
  return dates.map((date, i) => {
    const share = dates.length > 1 ? i / (dates.length - 1) : 1;
    const sales = Math.max(0, Math.round(level(share) * (0.55 + random() * 0.9)));
    const aovCents = sales > 0 ? 2_400 + Math.round(random() * 3_600) : 0;
    return { date, sales, revenueCents: sales * aovCents, aovCents };
  });
}

/** Signal buckets shaped by `level`. */
function signalSeries(dates: string[], level: (share: number) => number, seed: number): SignalPoint[] {
  const random = seeded(seed);
  return dates.map((date, i) => {
    const share = dates.length > 1 ? i / (dates.length - 1) : 1;
    return { date, count: Math.max(0, Math.round(level(share) * (0.6 + random() * 0.8))), valueCents: 0 };
  });
}

const sum = <T,>(list: T[], of: (item: T) => number) => list.reduce((total, item) => total + of(item), 0);

const PRODUCTS = ["Riso print 'Night swim'", "Ceramic mug", "Sticker pack", "Linen tote", "Zine, issue 4"];

/** Every signal kind, zero-filled, with the four the sample store records filled in. */
function signalsFor(dates: string[], scale: number, seed: number): Record<SignalKind, SignalBreakdown> {
  const filled: Partial<Record<SignalKind, number>> = {
    storefront_view: 60 * scale,
    product_view: 22 * scale,
    product_click: 9 * scale,
    checkout_view: 4 * scale,
  };
  return Object.fromEntries(
    SIGNAL_KINDS.map((kind, k) => {
      const base = filled[kind] ?? 0;
      const series = signalSeries(dates, (share) => base * (0.7 + share * 0.6), seed + k);
      const count = sum(series, (point) => point.count);
      const breakdown: SignalBreakdown = {
        kind,
        totals: { count, valueCents: 0, uniqueVisitors: Math.round(count * 0.62) },
        series,
        channels: ORDER_CHANNELS.map((channel, c) => ({ channel, count: Math.round(count * [0.52, 0.2, 0.18, 0.1][c]) })),
        weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday, w) => ({
          weekday,
          count: Math.round((count / 7) * [0.8, 0.9, 1, 1.05, 1.2, 1.3, 0.75][w]),
        })),
        storefronts: count
          ? [
              { storefrontId: "sf-1", name: "Main shop", count: Math.round(count * 0.6) },
              { storefrontId: "sf-2", name: "Prints corner", count: Math.round(count * 0.3) },
              { storefrontId: "sf-3", name: "Summer market", count: Math.round(count * 0.1) },
            ]
          : [],
      };
      return [kind, breakdown];
    }),
  ) as Record<SignalKind, SignalBreakdown>;
}

function funnelFor(scale: number): FunnelData {
  return {
    checkoutsAvailable: true,
    embedViews: Math.round(1_500 * scale),
    productOpens: Math.round(260 * scale),
    embedOrders: Math.round(24 * scale),
    checkoutsStarted: Math.round(70 * scale),
    checkoutsExpired: Math.round(30 * scale),
  };
}

type Shape = {
  dates: string[];
  beforeDates: string[] | null;
  level: (share: number) => number;
  beforeLevel: (share: number) => number;
  preset: AnalyticsSnapshot["range"]["preset"];
  traffic: number;
  seed: number;
};

const SHAPES: Record<LabScenario, Shape> = {
  growing: {
    dates: days(30),
    beforeDates: days(30, 30),
    level: (share) => 2 + share * 6,
    beforeLevel: (share) => 1.5 + share * 3,
    preset: "30d",
    traffic: 1.2,
    seed: 7,
  },
  slowing: {
    dates: days(30),
    beforeDates: days(30, 30),
    level: (share) => 6 - share * 4,
    beforeLevel: (share) => 6 + share * 2,
    preset: "30d",
    traffic: 0.8,
    seed: 11,
  },
  first: {
    dates: days(30),
    beforeDates: null,
    level: (share) => 0.5 + share * 5,
    beforeLevel: () => 0,
    preset: "30d",
    traffic: 1,
    seed: 3,
  },
  allTime: {
    dates: months(12),
    beforeDates: null,
    level: (share) => 40 + share * 160,
    beforeLevel: () => 0,
    preset: "all",
    traffic: 30,
    seed: 19,
  },
  oneDay: {
    dates: days(1),
    beforeDates: days(1, 1),
    level: () => 6,
    beforeLevel: () => 4,
    preset: "custom",
    traffic: 0.2,
    seed: 29,
  },
  quiet: {
    dates: days(30),
    beforeDates: days(30, 30),
    level: () => 0,
    beforeLevel: (share) => 2 + share * 2,
    preset: "30d",
    traffic: 0.5,
    seed: 23,
  },
};

/** The analytics page's whole payload for one sample store. */
export function buildSnapshot(scenario: LabScenario): AnalyticsSnapshot {
  const shape = SHAPES[scenario];
  const series = revenueSeries(shape.dates, shape.level, shape.seed);
  const revenueCents = sum(series, (point) => point.revenueCents);
  const sales = sum(series, (point) => point.sales);
  const aovCents = sales > 0 ? Math.round(revenueCents / sales) : 0;
  const feesCents = Math.round(revenueCents * 0.05);
  const refundedCount = sales > 4 ? Math.round(sales * 0.04) : 0;
  const statuses: { status: OrderStatus; count: number }[] = [
    { status: "paid", count: sales },
    { status: "refunded", count: refundedCount },
    { status: "disputed", count: sales > 20 ? 1 : 0 },
    { status: "pending", count: sales > 0 ? 2 : 0 },
  ];
  const weights = [0.8, 0.9, 1, 1.05, 1.2, 1.3, 0.75];
  const weightSum = sum(weights, (w) => w);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday, w) => {
    const daySales = Math.round((sales * weights[w]) / weightSum);
    const first = Math.round(daySales * 0.45);
    const second = Math.round(daySales * 0.3);
    return {
      weekday,
      sales: daySales,
      revenueCents: daySales * aovCents,
      products: [
        { title: PRODUCTS[0], sales: first },
        { title: PRODUCTS[1], sales: second },
        { title: null, sales: daySales - first - second },
      ],
    };
  });

  let previous: AnalyticsSnapshot["previous"] = null;
  if (shape.beforeDates) {
    const beforeSeries = revenueSeries(shape.beforeDates, shape.beforeLevel, shape.seed + 100);
    const beforeRevenue = sum(beforeSeries, (point) => point.revenueCents);
    const beforeSales = sum(beforeSeries, (point) => point.sales);
    const beforeSignals = signalsFor(shape.beforeDates, shape.traffic * 0.8, shape.seed + 200);
    previous = {
      range: { from: shape.beforeDates[0], to: shape.beforeDates[shape.beforeDates.length - 1] },
      sales: {
        revenueCents: beforeRevenue,
        sales: beforeSales,
        aovCents: beforeSales > 0 ? Math.round(beforeRevenue / beforeSales) : 0,
        series: beforeSales > 0 ? beforeSeries : [],
      },
      signals: Object.fromEntries(
        SIGNAL_KINDS.map((kind) => [
          kind,
          {
            count: beforeSignals[kind].totals.count,
            series: beforeSignals[kind].totals.count > 0 ? beforeSignals[kind].series : [],
          },
        ]),
      ) as Record<SignalKind, { count: number; series: SignalPoint[] }>,
      funnel: funnelFor(shape.traffic * 0.8),
    };
  }

  return {
    version: 1,
    range: {
      from: shape.preset === "all" ? null : shape.dates[0],
      to: shape.dates[shape.dates.length - 1],
      preset: shape.preset,
    },
    currency: "EUR",
    generatedAt: "2026-11-08T09:00:00.000Z",
    sales: {
      available: true,
      totals: {
        revenueCents,
        sales,
        aovCents,
        feesCents,
        netRevenueCents: revenueCents - feesCents,
        uniqueBuyers: Math.round(sales * 0.86),
        repeatBuyers: Math.round(sales * 0.09),
        refundedCount,
        refundedCents: refundedCount * aovCents,
        rangeDays: shape.preset === "all" ? 365 : shape.dates.length,
        currency: "EUR",
      },
      // The feed sends no buckets for a range with no paid order (the page
      // then draws its own flat line over the range's dates).
      series: sales > 0 ? series : [],
      channels: ORDER_CHANNELS.map((channel, c) => {
        const share = [0.55, 0.2, 0.15, 0.1][c];
        return { channel, revenueCents: Math.round(revenueCents * share), sales: Math.round(sales * share) };
      }),
      topProducts: sales
        ? PRODUCTS.map((title, p) => {
            const share = [0.34, 0.24, 0.18, 0.14, 0.1][p];
            return { title, revenueCents: Math.round(revenueCents * share), sales: Math.round(sales * share) };
          })
        : [],
      weekdays,
      weekdayProducts: PRODUCTS.slice(0, 2),
      statuses,
    },
    signals: {
      available: true,
      byKind: signalsFor(shape.dates, shape.traffic, shape.seed + 300),
      everRecorded: ["storefront_view", "product_view", "product_click", "checkout_view"],
      activeBlockTypes: ["product"],
    },
    funnel: funnelFor(shape.traffic),
    previous,
  };
}
