import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import type { OrderChannel, OrderStatus } from "@/types/order-view";
import {
  SIGNAL_CHANNELS,
  SIGNAL_KINDS,
  isSignalChannel,
  isSignalKind,
  type SignalChannel,
  type SignalKind,
} from "@/lib/analytics/signals";
import {
  WEEKDAYS,
  bucketKeyFor,
  planBuckets,
  rangeDayCount,
  toIsoDay,
} from "@/lib/analytics/buckets";
import {
  TOP_STOREFRONTS_LIMIT,
  type AnalyticsData,
  type AnalyticsRange,
  type AnalyticsSnapshot,
  type ChannelSlice,
  type RangePreset,
  type RevenuePoint,
  type SignalBreakdown,
  type SignalChannelSlice,
  type SignalPoint,
  type SignalStorefrontSlice,
  type SignalWeekdaySlice,
  type SignalsData,
  type StatusSlice,
  type TopProduct,
  type WeekdaySlice,
} from "@/lib/analytics/types";

// READ-ONLY analytics aggregates. Server Components / Route Handlers only
// (cookies() is Node-only, never middleware).
//
// Aggregation happens IN SQL, public.analytics_aggregate for orders (see
// supabase/migrations/20260802_analytics_sql_aggregates.sql) and
// public.storefront_signals_aggregate for everything that is not a sale (see
// 20260830_storefront_signals.sql). The database scans an index and returns a
// few hundred bytes of jsonb, so there is no read cap and no row count at
// which these figures go quietly wrong. What remains here is presentation:
// zero-filling calendars, re-bucketing long spans by month, and pinning fixed
// display orders, all of it shared with the signals path via buckets.ts, so
// two series on one screen can never disagree about what a bucket is.

/** Shape of the jsonb payload analytics_aggregate returns. */
type AggregatePayload = {
  totals: {
    revenue_cents: number;
    sales: number;
    fees_cents: number;
    refunded_count: number;
    refunded_cents: number;
    unique_buyers: number;
    repeat_buyers: number;
  };
  first_paid_date: string | null;
  first_order_date: string | null;
  series_days: { date: string; revenue_cents: number; sales: number }[];
  channels: { channel: string; revenue_cents: number; sales: number }[];
  top_products: { title: string; revenue_cents: number; sales: number }[];
  weekdays: { isodow: number; revenue_cents: number; sales: number }[];
  statuses: { status: string; count: number }[];
};

/** Shape of the jsonb payload storefront_signals_aggregate returns. */
type SignalsPayload = {
  first_signal_date: string | null;
  /** Kinds ever recorded for this account, ignoring the range. */
  all_time_kinds: string[];
  /** Block types on this account's storefronts. */
  active_block_types: string[];
  totals: {
    kind: string;
    count: number;
    value_cents: number;
    unique_visitors: number;
  }[];
  series_days: {
    date: string;
    kind: string;
    count: number;
    value_cents: number;
  }[];
  channels: { kind: string; channel: string; count: number }[];
  weekdays: { kind: string; isodow: number; count: number }[];
  storefronts: {
    kind: string;
    storefront_id: string | null;
    name: string | null;
    count: number;
  }[];
};

/** Fixed status display order for the breakdown, zeros included. */
const STATUS_ORDER: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];

/**
 * Revenue trend buckets, oldest to newest, empty buckets included as 0.
 * All-time ranges start at the first PAID order (the series charts paid
 * revenue, so leading refund-only days would render as misleading zeros).
 */
function buildSeries(
  days: AggregatePayload["series_days"],
  range: AnalyticsRange,
  firstPaidDate: string | null,
): RevenuePoint[] {
  if (days.length === 0) return [];

  const plan = planBuckets(range, firstPaidDate ?? days[0].date);
  if (plan.keys.length === 0) return [];

  const buckets = new Map<string, RevenuePoint>(
    plan.keys.map((key) => [
      key,
      { date: key, revenueCents: 0, sales: 0, aovCents: 0 },
    ]),
  );

  for (const day of days) {
    const bucket = buckets.get(bucketKeyFor(plan, day.date));
    if (!bucket) continue;
    bucket.revenueCents += day.revenue_cents;
    bucket.sales += day.sales;
  }
  // Per-bucket AOV once the sums are in: integer cents, 0 for empty buckets.
  for (const bucket of buckets.values()) {
    bucket.aovCents =
      bucket.sales > 0 ? Math.round(bucket.revenueCents / bucket.sales) : 0;
  }
  return [...buckets.values()];
}

/** Always both channels, embed first, zeros included. */
function buildChannels(rows: AggregatePayload["channels"]): ChannelSlice[] {
  const slices: Record<OrderChannel, ChannelSlice> = {
    embed: { channel: "embed", revenueCents: 0, sales: 0 },
    marketplace: { channel: "marketplace", revenueCents: 0, sales: 0 },
  };
  for (const row of rows) {
    const slice = slices[row.channel === "marketplace" ? "marketplace" : "embed"];
    slice.revenueCents += row.revenue_cents;
    slice.sales += row.sales;
  }
  return [slices.embed, slices.marketplace];
}

/** All seven weekdays Mon..Sun, zeros included. */
function buildWeekdays(rows: AggregatePayload["weekdays"]): WeekdaySlice[] {
  const slices = WEEKDAYS.map((weekday) => ({
    weekday,
    sales: 0,
    revenueCents: 0,
  }));
  for (const row of rows) {
    // ISO dow 1..7 -> Mon-first index 0..6.
    const slice = slices[(row.isodow + 6) % 7];
    if (!slice) continue;
    slice.sales += row.sales;
    slice.revenueCents += row.revenue_cents;
  }
  return slices;
}

/** Fixed status order, zeros kept; unknown statuses were folded into pending
 *  by the SQL already. */
function buildStatuses(rows: AggregatePayload["statuses"]): StatusSlice[] {
  const counts = new Map<OrderStatus, number>(
    STATUS_ORDER.map((status) => [status, 0]),
  );
  for (const row of rows) {
    const status = STATUS_ORDER.includes(row.status as OrderStatus)
      ? (row.status as OrderStatus)
      : "pending";
    counts.set(status, (counts.get(status) ?? 0) + row.count);
  }
  return STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export function emptyAnalyticsData(available = false): AnalyticsData {
  return {
    available,
    totals: {
      revenueCents: 0,
      sales: 0,
      aovCents: 0,
      feesCents: 0,
      netRevenueCents: 0,
      uniqueBuyers: 0,
      repeatBuyers: 0,
      refundedCount: 0,
      refundedCents: 0,
      rangeDays: 0,
      currency: "EUR",
    },
    series: [],
    channels: [
      { channel: "embed", revenueCents: 0, sales: 0 },
      { channel: "marketplace", revenueCents: 0, sales: 0 },
    ],
    topProducts: [],
    weekdays: WEEKDAYS.map((weekday) => ({ weekday, sales: 0, revenueCents: 0 })),
    statuses: STATUS_ORDER.map((status) => ({ status, count: 0 })),
  };
}

/** One kind's zero state. Every field the section renders is present and
 *  empty, so "no data" and "not loaded" never look the same. */
function emptySignalBreakdown(kind: SignalKind): SignalBreakdown {
  return {
    kind,
    totals: { count: 0, valueCents: 0, uniqueVisitors: 0 },
    series: [],
    channels: SIGNAL_CHANNELS.map((channel) => ({ channel, count: 0 })),
    weekdays: WEEKDAYS.map((weekday) => ({ weekday, count: 0 })),
    storefronts: [],
  };
}

export function emptySignalsData(available = false): SignalsData {
  return {
    available,
    byKind: Object.fromEntries(
      SIGNAL_KINDS.map((kind) => [kind, emptySignalBreakdown(kind)]),
    ) as Record<SignalKind, SignalBreakdown>,
    everRecorded: [],
    activeBlockTypes: [],
  };
}

/**
 * All analytics aggregates in one RPC round-trip. The seller id comes from the
 * session (never from a caller); the function is SECURITY INVOKER, so RLS
 * enforces the same boundary inside the SQL: a forged id returns zero rows,
 * not another seller's numbers. EUR-only semantics live in the SQL
 * (currency <> 'USD', mirroring toCurrency exactly).
 */
export async function getAnalytics(range: AnalyticsRange): Promise<AnalyticsData> {
  const account = await getActiveAccount();
  if (!account) return emptyAnalyticsData();

  const supabase = await createClient();
  // Untyped rpc: the generated Database types predate these functions.
  const { data, error } = await (supabase as SupabaseClient).rpc(
    "analytics_aggregate",
    {
      p_seller_id: account.accountId,
      p_from: range.from ?? null,
      p_to: range.to ?? null,
    },
  );

  if (error) {
    // THROW, do not soft-fail. All-zero charts from a failed read look exactly
    // like a store with no sales; error.tsx with a retry is honest.
    throw new Error(`Analytics are unavailable right now: ${error.message}`);
  }

  const payload = data as AggregatePayload;
  const totals = payload.totals;

  return {
    available: true,
    totals: {
      revenueCents: totals.revenue_cents,
      sales: totals.sales,
      aovCents:
        totals.sales > 0 ? Math.round(totals.revenue_cents / totals.sales) : 0,
      feesCents: totals.fees_cents,
      netRevenueCents: totals.revenue_cents - totals.fees_cents,
      uniqueBuyers: totals.unique_buyers,
      repeatBuyers: totals.repeat_buyers,
      refundedCount: totals.refunded_count,
      refundedCents: totals.refunded_cents,
      rangeDays: rangeDayCount(range, payload.first_order_date),
      currency: "EUR",
    },
    series: buildSeries(payload.series_days, range, payload.first_paid_date),
    channels: buildChannels(payload.channels),
    topProducts: payload.top_products.map(
      (row): TopProduct => ({
        title: row.title,
        revenueCents: row.revenue_cents,
        sales: row.sales,
      }),
    ),
    weekdays: buildWeekdays(payload.weekdays),
    statuses: buildStatuses(payload.statuses),
  };
}

/**
 * Every non-order figure, for every signal kind, in one RPC round-trip.
 *
 * Same security model as getAnalytics: the account id comes from the session,
 * the function is SECURITY INVOKER, RLS decides what the caller may see.
 *
 * Unlike getAnalytics this SOFT-FAILS to an unavailable zero state instead of
 * throwing. The distinction is deliberate: revenue is the page's reason to
 * exist and a wrong zero there is a lie worth an error screen, whereas the
 * signal sections already have a first-class "nothing here yet" rendering and
 * a seller looking at their revenue should not lose the whole page because the
 * view counter is having a bad day. `available: false` is carried through to
 * the UI, which says so rather than pretending the count is zero.
 */
export async function getSignals(range: AnalyticsRange): Promise<SignalsData> {
  const account = await getActiveAccount();
  if (!account) return emptySignalsData();

  const supabase = await createClient();
  // Typed rpc, unlike analytics_aggregate above: this function and its table
  // were added to src/types/supabase.ts in the same change as the migration,
  // which is the discipline docs/agent-surface.md B7 asks for.
  const { data, error } = await supabase.rpc("storefront_signals_aggregate", {
    p_account_id: account.accountId,
    p_from: range.from ?? undefined,
    p_to: range.to ?? undefined,
  });

  if (error) {
    console.warn("[analytics] signals read failed:", error.message);
    return emptySignalsData();
  }

  const payload = data as SignalsPayload;
  const byKind = Object.fromEntries(
    SIGNAL_KINDS.map((kind) => [kind, emptySignalBreakdown(kind)]),
  ) as Record<SignalKind, SignalBreakdown>;

  for (const row of payload.totals ?? []) {
    if (!isSignalKind(row.kind)) continue;
    byKind[row.kind].totals = {
      count: row.count,
      valueCents: row.value_cents,
      uniqueVisitors: row.unique_visitors,
    };
  }

  // One bucket plan for every kind, anchored at the first signal of ANY kind,
  // so the sections share an x axis and can be compared down the page.
  const anchor =
    payload.first_signal_date ?? payload.series_days?.[0]?.date ?? null;
  const plan = planBuckets(range, anchor);
  if (plan.keys.length > 0) {
    const seen = new Set<SignalKind>();
    for (const row of payload.series_days ?? []) {
      if (isSignalKind(row.kind)) seen.add(row.kind);
    }
    for (const kind of seen) {
      byKind[kind].series = plan.keys.map(
        (date): SignalPoint => ({ date, count: 0, valueCents: 0 }),
      );
    }
    const index = new Map<SignalKind, Map<string, SignalPoint>>();
    for (const kind of seen) {
      index.set(
        kind,
        new Map(byKind[kind].series.map((point) => [point.date, point])),
      );
    }
    for (const row of payload.series_days ?? []) {
      if (!isSignalKind(row.kind)) continue;
      const point = index.get(row.kind)?.get(bucketKeyFor(plan, row.date));
      if (!point) continue;
      point.count += row.count;
      point.valueCents += row.value_cents;
    }
  }

  for (const row of payload.channels ?? []) {
    if (!isSignalKind(row.kind) || !isSignalChannel(row.channel)) continue;
    const slice = byKind[row.kind].channels.find(
      (candidate: SignalChannelSlice) =>
        candidate.channel === (row.channel as SignalChannel),
    );
    if (slice) slice.count += row.count;
  }

  for (const row of payload.weekdays ?? []) {
    if (!isSignalKind(row.kind)) continue;
    // ISO dow 1..7 -> Mon-first index 0..6.
    const slice: SignalWeekdaySlice | undefined =
      byKind[row.kind].weekdays[(row.isodow + 6) % 7];
    if (slice) slice.count += row.count;
  }

  // SQL returns these count-descending across all kinds; take the top few per
  // kind here rather than in SQL, so one busy kind cannot crowd out another.
  for (const row of payload.storefronts ?? []) {
    if (!isSignalKind(row.kind)) continue;
    const list = byKind[row.kind].storefronts;
    if (list.length >= TOP_STOREFRONTS_LIMIT) continue;
    list.push({
      storefrontId: row.storefront_id,
      name: row.name,
      count: row.count,
    } satisfies SignalStorefrontSlice);
  }

  return {
    available: true,
    byKind,
    everRecorded: (payload.all_time_kinds ?? []).filter(isSignalKind),
    // Not narrowed to known block types: an unknown one here is a block this
    // build has not heard of, and dropping it would be the wrong default when
    // the point of the field is to notice a block that just shipped.
    activeBlockTypes: payload.active_block_types ?? [],
  };
}

/**
 * The whole analytics payload, orders and signals, for one range.
 *
 * Both reads run in parallel and both are account-scoped by the same session.
 * The returned object is exactly what the page renders AND exactly what it
 * publishes as its machine-readable snapshot, so the two can never drift:
 * there is one payload, serialised once.
 */
export async function getAnalyticsSnapshot(
  range: AnalyticsRange,
  preset: RangePreset,
): Promise<AnalyticsSnapshot> {
  const [sales, signals] = await Promise.all([
    getAnalytics(range),
    getSignals(range),
  ]);

  return {
    version: 1,
    // The RESOLVED range, not the raw params: "last 30 days" is only meaningful
    // to a reader who also knows what day it was read on.
    range: {
      from: range.from ?? null,
      to: range.to ?? toIsoDay(Date.now()),
      preset,
    },
    currency: sales.totals.currency,
    sales,
    signals,
    generatedAt: new Date().toISOString(),
  };
}
