import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import type { OrderChannel, OrderStatus } from "@/types/order-view";
import type {
  AnalyticsData,
  AnalyticsRange,
  ChannelSlice,
  RevenuePoint,
  StatusSlice,
  TopProduct,
  WeekdaySlice,
} from "@/lib/analytics/types";

// READ-ONLY analytics aggregates. Server Components / Route Handlers only
// (cookies() is Node-only, never middleware).
//
// Aggregation happens IN SQL (public.analytics_aggregate, see
// supabase/migrations/20260802_analytics_sql_aggregates.sql): the database
// scans an index and returns a few hundred bytes of jsonb, so there is no
// read cap and no order count at which these figures go quietly wrong. The
// removed JS path read at most 5,000 rows and silently under-reported past
// that. What remains here is presentation: zero-filling calendars, re-bucketing
// long spans by month, and pinning fixed display orders.

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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranges up to ~3 months bucket by day; anything longer buckets by month. */
const MAX_DAILY_SPAN_DAYS = 92;

/** Fixed status display order for the breakdown, zeros included. */
const STATUS_ORDER: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];

/** Mon-first weekday labels; SQL returns ISO dow (1 = Monday .. 7 = Sunday). */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** UTC ms for an ISO "YYYY-MM-DD" day start. Deterministic, no locale. */
function dayStartUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ISO "YYYY-MM-DD" for a UTC ms timestamp. */
function toIsoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** ISO "YYYY-MM-DD" of the first day of the month containing `isoDate`. */
function toMonthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/**
 * Revenue trend buckets, oldest to newest, empty buckets included as 0.
 * Day buckets for spans up to MAX_DAILY_SPAN_DAYS, month buckets beyond.
 * All-time ranges start at the first PAID order (the series charts paid
 * revenue, so leading refund-only days would render as misleading zeros).
 */
function buildSeries(
  days: AggregatePayload["series_days"],
  range: AnalyticsRange,
  firstPaidDate: string | null,
): RevenuePoint[] {
  if (days.length === 0) return [];

  const start = range.from ?? firstPaidDate ?? days[0].date;
  const end = range.to ?? toIsoDay(Date.now());
  const startMs = dayStartUtc(start);
  const endMs = dayStartUtc(end);
  if (endMs < startMs) return [];

  const spanDays = Math.floor((endMs - startMs) / DAY_MS);
  const byMonth = spanDays > MAX_DAILY_SPAN_DAYS;

  // Empty buckets first, then pour the day rows in.
  const buckets = new Map<string, RevenuePoint>();
  if (byMonth) {
    const [endY, endM] = toMonthStart(end).split("-").map(Number);
    let [y, m] = toMonthStart(start).split("-").map(Number);
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, "0")}-01`;
      buckets.set(key, { date: key, revenueCents: 0, sales: 0, aovCents: 0 });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const key = toIsoDay(ms);
      buckets.set(key, { date: key, revenueCents: 0, sales: 0, aovCents: 0 });
    }
  }

  for (const day of days) {
    const bucket = buckets.get(byMonth ? toMonthStart(day.date) : day.date);
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

/** Inclusive days the data window covers (all-time starts at the earliest
 *  order of ANY status). 0 when there is nothing to measure. */
function rangeDays(range: AnalyticsRange, firstOrderDate: string | null): number {
  const start = range.from ?? firstOrderDate;
  if (!start) return 0;
  const end = range.to ?? toIsoDay(Date.now());
  const span = Math.floor((dayStartUtc(end) - dayStartUtc(start)) / DAY_MS);
  return span < 0 ? 0 : span + 1;
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
      rangeDays: rangeDays(range, payload.first_order_date),
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
