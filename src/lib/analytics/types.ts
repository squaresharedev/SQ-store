// ANALYTICS CONTRACT — shared types between the query layer (server) and the
// presentational modules (client). Date range in, aggregated series/totals
// out. Money is ALWAYS integer cents; display formatting happens only via
// formatCents (@/lib/format/money). Reads are owner-scoped (session +
// RLS) and strictly READ-ONLY against orders — no schema changes.

import type { OrderChannel, OrderStatus } from "@/types/order-view";

/** Inclusive ISO "YYYY-MM-DD" bounds; null = unbounded (all-time). Mirrors
 *  the DatePicker `DateRangeValue` shape. */
export type AnalyticsRange = { from: string | null; to: string | null };

/** Named presets for the range selector. `custom` uses the DatePicker range. */
export type RangePreset = "30d" | "all" | "custom";

/** One time bucket of the revenue trend (paid orders only). */
export type RevenuePoint = {
  /** Bucket start as ISO "YYYY-MM-DD". */
  date: string;
  revenueCents: number;
  sales: number;
  /** Average order value inside the bucket — rounded integer cents, 0 when
   *  the bucket has no sales (charts skip zero-sale buckets). */
  aovCents: number;
};

/** Paid revenue/sales attributed to one channel. */
export type ChannelSlice = {
  channel: OrderChannel;
  revenueCents: number;
  sales: number;
};

/** One row of the top-products ranking (by paid revenue, product_title
 *  snapshot from the order — resilient to product renames/deletes). */
export type TopProduct = {
  title: string;
  revenueCents: number;
  sales: number;
};

/** Paid sales bucketed by day of week (Mon..Sun, always 7 entries). */
export type WeekdaySlice = {
  /** Short label, "Mon".."Sun". */
  weekday: string;
  sales: number;
  revenueCents: number;
};

/** Order count for one status — the range's full order mix. */
export type StatusSlice = {
  status: OrderStatus;
  count: number;
};

/** Headline totals for the selected range. Money figures are paid-order
 *  sums unless noted; refund figures come from refunded orders. */
export type AnalyticsTotals = {
  revenueCents: number;
  sales: number;
  /** Rounded integer cents; 0 when there are no sales. */
  aovCents: number;
  /** Platform fees on paid orders (integer cents). */
  feesCents: number;
  /** revenueCents - feesCents. */
  netRevenueCents: number;
  /** Distinct paid buyer emails in range. */
  uniqueBuyers: number;
  /** Buyers with 2+ paid orders in range. */
  repeatBuyers: number;
  /** Refunded orders in range (count + gross cents). */
  refundedCount: number;
  refundedCents: number;
  /** Inclusive days the data window covers (drives avg sales/day); 0 when
   *  the range is unbounded and holds no orders. */
  rangeDays: number;
  /** Display currency for every cents figure ("EUR" for now). */
  currency: string;
};

/** Everything the analytics page renders, from one owner-scoped read. */
export type AnalyticsData = {
  /** False while the orders table hasn't landed or the read failed —
   *  modules render calm zero states, never an error page. */
  available: boolean;
  totals: AnalyticsTotals;
  /** Time-ordered buckets (oldest first); empty buckets included as 0. */
  series: RevenuePoint[];
  /** Always both channels, embed first, zeros included. */
  channels: ChannelSlice[];
  /** Descending by revenueCents, capped at TOP_PRODUCTS_LIMIT. */
  topProducts: TopProduct[];
  /** Always 7 entries, Mon..Sun, zeros included (paid orders). */
  weekdays: WeekdaySlice[];
  /** Always all four statuses, fixed order, zeros included (all orders). */
  statuses: StatusSlice[];
};

export const TOP_PRODUCTS_LIMIT = 5;
