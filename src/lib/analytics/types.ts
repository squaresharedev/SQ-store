// ANALYTICS CONTRACT — shared types between the query layer (server) and the
// presentational modules (client). Date range in, aggregated series/totals
// out. Money is ALWAYS integer cents; display formatting happens only via
// formatCents (@/lib/format/money). Reads are owner-scoped (session +
// RLS) and strictly READ-ONLY against orders — no schema changes.

import type { OrderChannel, OrderStatus } from "@/types/order-view";
import type { SignalChannel, SignalKind } from "@/lib/analytics/signals";

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

// ---------------------------------------------------------------------------
// SIGNALS, everything the page measures that is NOT a sale.
//
// Same discipline as the order types above: counts are integers, money is
// integer cents, series are zero-filled and bucketed by the SAME rules as the
// revenue trend so two charts on one screen never disagree about what a
// bucket is. Shapes are per-KIND rather than per-feature, which is what lets
// one section component render views, signups and bookings alike.
// ---------------------------------------------------------------------------

/** One time bucket of a signal kind. `valueCents` is 0 for kinds that carry
 *  no money (a view is not worth anything on its own). */
export type SignalPoint = {
  /** Bucket start as ISO "YYYY-MM-DD". */
  date: string;
  count: number;
  valueCents: number;
};

/** Headline figures for one signal kind over the range. */
export type SignalTotals = {
  count: number;
  /** Sum of value_cents, integer cents. 0 for kinds that carry no money. */
  valueCents: number;
  /** Distinct visitor digests seen. 0 when the producer sends none. */
  uniqueVisitors: number;
};

/** Signals of one kind attributed to one channel. */
export type SignalChannelSlice = { channel: SignalChannel; count: number };

/** Signals of one kind bucketed by day of week (Mon..Sun, always 7 entries). */
export type SignalWeekdaySlice = { weekday: string; count: number };

/** Signals of one kind attributed to one storefront. `name` is null when the
 *  storefront has since been deleted, the count is still true, so it is
 *  reported rather than dropped. */
export type SignalStorefrontSlice = {
  storefrontId: string | null;
  name: string | null;
  count: number;
};

/** Everything one source's section renders. Always present for every kind,
 *  zero-filled: an empty section and a missing section are different states,
 *  and only one of them is honest. */
export type SignalBreakdown = {
  kind: SignalKind;
  totals: SignalTotals;
  /** Time-ordered buckets (oldest first), empty buckets included as 0. */
  series: SignalPoint[];
  /** Always all three channels, fixed order, zeros included. */
  channels: SignalChannelSlice[];
  /** Always 7 entries, Mon..Sun, zeros included. */
  weekdays: SignalWeekdaySlice[];
  /** Descending by count, capped at TOP_STOREFRONTS_LIMIT. */
  storefronts: SignalStorefrontSlice[];
};

/** Every signal kind's breakdown, from one owner-scoped read. */
export type SignalsData = {
  /** False when the read failed or there is no active account. Sections render
   *  calm zero states, never an error page. */
  available: boolean;
  byKind: Record<SignalKind, SignalBreakdown>;
  /**
   * Kinds this account has EVER recorded, ignoring the range. Drives whether a
   * source is shown at all, which must not flicker as the reader changes the
   * date window: an empty range is a reason to show zeros, never a reason to
   * hide a source the seller genuinely runs.
   */
  everRecorded: SignalKind[];
  /**
   * Block types present on this account's storefronts (`StorefrontBlock["type"]`
   * values). The real "do I have that embed" test, and the one that lets a
   * newly placed block get its section before it has produced any data.
   */
  activeBlockTypes: string[];
};

export const TOP_STOREFRONTS_LIMIT = 5;

/**
 * THE PAGE'S WHOLE PAYLOAD, in one object.
 *
 * This is also the machine-readable contract: it is serialised verbatim into
 * the page as `<script type="application/json" id="analytics-snapshot">`, so
 * an agent reading the dashboard gets exactly what the charts were drawn from
 * rather than scraping rendered text. See docs/analytics-datapoints.md.
 */
export type AnalyticsSnapshot = {
  /** Contract version. Bump on any breaking shape change. */
  version: 1;
  /** The range the figures cover, resolved (never the raw URL params). */
  range: { from: string | null; to: string | null; preset: RangePreset };
  /** Currency every *Cents field in this payload is expressed in. */
  currency: string;
  sales: AnalyticsData;
  signals: SignalsData;
  /** When the payload was generated, ISO 8601. */
  generatedAt: string;
};
