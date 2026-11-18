import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { getProfile } from "@/lib/auth/session";
import { toCurrency } from "@/lib/format/money";
import { toChannel } from "@/lib/orders/queries";
import { buildShippingPolicy } from "@/lib/settings/shipping-policy";
import { hasPricedDestination } from "@/lib/shipping/rates";
import { forecastRestocks, RESTOCK_PACE_DAYS, type RestockForecast } from "@/lib/predictions";
import { LOW_STOCK_THRESHOLD_DEFAULT } from "@/lib/validation/product";
import type { Currency } from "@/types/product";
import type { OrderChannel, OrderStatus } from "@/types/order-view";

// READ-ONLY dashboard aggregates. Server Components / Route Handlers only
// (cookies() is Node-only — never middleware).
//
// The `orders` table and its columns are OWNED BY THE SEED/ORDERS WORK — this
// module never creates or alters it, and reads fail soft (calm zero states)
// while that table is still landing. Column contract (do not rename):
//   seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, product_title, product_price_cents,
//   created_at

// The shared orders vocabulary, re-exported for this module's readers rather
// than spelled out a second time.
export type { OrderChannel, OrderStatus };

/** The subset of order columns the dashboard reads. */
export type DashboardOrder = {
  /** Row id — the Recent orders card links each row to /orders?order=<id>. */
  id: string;
  product_title: string;
  channel: OrderChannel;
  status: OrderStatus;
  amount_cents: number;
  currency: string;
  created_at: string;
};

/** Integer cents keyed by currency — never summed across currencies. */
export type MoneyByCurrency = Partial<Record<Currency, number>>;

export type MetricWindow = {
  revenue: MoneyByCurrency;
  sales: number;
  aov: MoneyByCurrency;
};

/**
 * Direction of the last 30 days vs the 30 days before it — drives the sparkline
 * colour. `surge` (>=10x) is a deliberate purple easter egg for real breakouts.
 */
export type TrendTone = "up" | "down" | "flat" | "surge";

/** A bare trend line: daily values (oldest->newest) + its period-over-period tone. */
export type MetricTrend = {
  /** ~30 daily buckets over the last 30 days, oldest first. */
  points: number[];
  tone: TrendTone;
};

export type DashboardOrdersData = {
  /** False while the orders table hasn't landed (or a read failed). */
  available: boolean;
  last30d: MetricWindow;
  allTime: MetricWindow;
  /** Daily sales-count trend, last 30 days vs the 30 before. */
  salesTrend: MetricTrend;
  /** Daily average-order-value trend, last 30 days vs the 30 before. */
  aovTrend: MetricTrend;
  /** Latest ~5, any status. */
  recentOrders: DashboardOrder[];
  refundedCount: number;
  disputedCount: number;
};

const TREND_DAYS = 30;
/** A 10x period-over-period jump trips the purple "surge" easter egg. */
const SURGE_RATIO = 10;

export { toCurrency };

/** Shape of the jsonb payload dashboard_orders_aggregate returns. */
type DashboardPayload = {
  all_time: { revenue_cents: number; sales: number };
  last_30d: { revenue_cents: number; sales: number };
  prev_30d: { revenue_cents: number; sales: number };
  trend_days: { age_days: number; revenue_cents: number; sales: number }[];
  refunded_count: number;
  disputed_count: number;
  recent_orders: DashboardOrder[];
};

/** Colour signal for a metric: last window vs the one before it. */
function trendTone(current: number, previous: number): TrendTone {
  // No prior baseline -> no ratio to speak of; any new activity reads as "up".
  if (previous <= 0) return current > 0 ? "up" : "flat";
  if (current >= previous * SURGE_RATIO) return "surge";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

/** Pour SQL's per-age rows into TREND_DAYS slots, oldest first, zeros kept. */
function trendBuckets(rows: DashboardPayload["trend_days"]) {
  const revenue = new Array<number>(TREND_DAYS).fill(0);
  const count = new Array<number>(TREND_DAYS).fill(0);
  for (const row of rows) {
    if (row.age_days < 0 || row.age_days >= TREND_DAYS) continue;
    const idx = TREND_DAYS - 1 - row.age_days; // oldest -> newest
    revenue[idx] += row.revenue_cents;
    count[idx] += row.sales;
  }
  return { revenue, count };
}

function emptyWindow(): MetricWindow {
  return { revenue: {}, sales: 0, aov: {} };
}

/** EUR-keyed MetricWindow from the SQL window sums. The whole read is EUR-only
 *  (currency <> 'USD' inside the function), so a single key is correct; the
 *  MoneyByCurrency shape stays so multi-currency later is additive. */
function windowFromSums(sums: { revenue_cents: number; sales: number }): MetricWindow {
  const window = emptyWindow();
  if (sums.sales > 0) {
    window.revenue.EUR = sums.revenue_cents;
    window.sales = sums.sales;
    window.aov.EUR = Math.round(sums.revenue_cents / sums.sales);
  }
  return window;
}

export function emptyOrdersData(available = false): DashboardOrdersData {
  return {
    available,
    last30d: emptyWindow(),
    allTime: emptyWindow(),
    salesTrend: { points: [], tone: "flat" },
    aovTrend: { points: [], tone: "flat" },
    recentOrders: [],
    refundedCount: 0,
    disputedCount: 0,
  };
}

/**
 * All dashboard order metrics in one RPC round-trip
 * (public.dashboard_orders_aggregate, SECURITY INVOKER: RLS enforces the
 * boundary inside the SQL, and a forged seller id returns zeros). No read cap:
 * the removed JS path aggregated the newest 1,000 rows and silently
 * under-reported all-time totals past that. EUR-only semantics live in the
 * SQL (currency <> 'USD', mirroring toCurrency exactly).
 */
export async function getDashboardOrders(): Promise<DashboardOrdersData> {
  const account = await getActiveAccount();
  if (!account) return emptyOrdersData();

  const supabase = await createClient();
  // Untyped rpc: the generated Database types predate these functions.
  const { data, error } = await (supabase as SupabaseClient).rpc(
    "dashboard_orders_aggregate",
    { p_seller_id: account.accountId },
  );

  if (error) {
    // THROW, do not soft-fail. "€0.00 all-time revenue" from a failed read is
    // indistinguishable from a real zero; error.tsx with a retry is honest.
    throw new Error(`Dashboard orders are unavailable right now: ${error.message}`);
  }

  const payload = data as DashboardPayload;
  const last30d = windowFromSums(payload.last_30d);
  const prev30d = windowFromSums(payload.prev_30d);

  // Sparkline series: daily buckets over the last 30 days (colour compares the
  // whole window to the prior one, not the noisy day-to-day points).
  const buckets = trendBuckets(payload.trend_days);
  const salesTrend: MetricTrend = {
    points: buckets.count,
    tone: trendTone(last30d.sales, prev30d.sales),
  };
  const aovTrend: MetricTrend = {
    points: buckets.revenue.map((rev, i) =>
      buckets.count[i] > 0 ? Math.round(rev / buckets.count[i]) : 0,
    ),
    tone: trendTone(last30d.aov.EUR ?? 0, prev30d.aov.EUR ?? 0),
  };

  return {
    available: true,
    last30d,
    allTime: windowFromSums(payload.all_time),
    salesTrend,
    aovTrend,
    // Coerced like every orders read, so the label lookup can never meet a
    // channel the catalogue has no words for.
    recentOrders: payload.recent_orders.map((order) => ({ ...order, channel: toChannel(order.channel) })),
    refundedCount: payload.refunded_count,
    disputedCount: payload.disputed_count,
  };
}

// --- Unified products read ---------------------------------------------------
//
// All three dashboard product functions (getProductsSummary,
// getExistingProductIds, getRestockForecasts) previously fired their own
// separate reads. One React-cached read now serves all three: it selects the
// union of all needed columns and is deduped across the render tree.
//
// Plans cap products at 500 (Pro, the top plan), and ACTIVE_PRODUCTS_LIMIT
// is 1000, so the fallback (count > rows.length) is effectively unreachable
// in production. It is kept so callers remain correct if limits ever change.

/** Union of every column the three product functions need. */
const ALL_PRODUCTS_COLUMNS =
  "id, title, status, image_key, purchase_url, digital_file_key, moderation_status, track_stock, stock_quantity, low_stock_threshold" as const;

type AllProductsRow = {
  id: string;
  title: string;
  status: string;
  image_key: string | null;
  purchase_url: string | null;
  digital_file_key: string | null;
  moderation_status: string | null;
  track_stock: boolean | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
};

/**
 * All of this account's products in one read, selecting the union of columns
 * the dashboard functions need. React-cached so getProductsSummary,
 * getExistingProductIds and getRestockForecasts share one round-trip per render.
 *
 * Returns an error string rather than throwing, so each caller can decide its
 * own error behaviour (getProductsSummary throws, the others soft-fail).
 */
const loadAllProducts = cache(async (): Promise<{
  rows: AllProductsRow[];
  count: number;
  error: string | null;
}> => {
  const account = await getActiveAccount();
  if (!account) return { rows: [], count: 0, error: null };
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("products")
    .select(ALL_PRODUCTS_COLUMNS, { count: "exact" })
    .eq("owner_id", account.accountId)
    .order("created_at", { ascending: false })
    .limit(ACTIVE_PRODUCTS_LIMIT);
  if (error) return { rows: [], count: 0, error: error.message };
  return { rows: (data ?? []) as unknown as AllProductsRow[], count: count ?? 0, error: null };
});

export type ProductsSummary = {
  total: number;
  missingImage: { id: string; title: string }[];
  /**
   * Count of active products with no purchase_url. Relevant only when the
   * account has no seller_email: if a contact email is set, every product page
   * surfaces it as a fallback buy path. Capped at ACTIVE_PRODUCTS_LIMIT so a
   * very large catalogue does not inflate the transfer cost.
   */
  noBuyPathCount: number;
  /** True if any product has no digital_file_key (a physical product that
   *  needs shipping and returns terms). */
  hasPhysicalProducts: boolean;
  /**
   * All active product IDs, bounded at ACTIVE_PRODUCTS_LIMIT. Used by the
   * dashboard page to cross-reference storefront blocks: a block whose
   * productId is absent from this set references a deleted product.
   */
  activeProductIds: string[];
  /** Active products the automatic check has not approved yet (checking, or
   *  with a person): set live by the seller, not yet visible to buyers. */
  checkingProductIds: string[];
  /** Active products the check paused or removed: hidden until changed. */
  pausedProductIds: string[];
};

/** The needs-attention module lists a handful of items; reading every
 *  imageless product to render three is wasted transfer at large catalogues. */
const MISSING_IMAGE_LIMIT = 25;

/**
 * Upper bound on the active-products fetch. One UUID per row over the wire;
 * far above any realistic catalogue size at this stage of the product.
 */
const ACTIVE_PRODUCTS_LIMIT = 1000;

/**
 * Lightweight product facts for status modules. Reads image_key directly
 * (rather than listProducts) so "missing image" reflects the DB, not whether
 * R2 credentials happen to be configured; RLS scopes rows to the owner.
 *
 * Derives everything from ONE shared read (loadAllProducts, React-cached),
 * which is also reused by getExistingProductIds and getRestockForecasts within
 * the same render. Falls back to three per-purpose reads only when the
 * account holds more than ACTIVE_PRODUCTS_LIMIT products (unreachable in
 * practice: plans cap at 500).
 */
export async function getProductsSummary(): Promise<ProductsSummary> {
  const account = await getActiveAccount();
  if (!account) return {
    total: 0,
    missingImage: [],
    noBuyPathCount: 0,
    hasPhysicalProducts: false,
    activeProductIds: [],
    checkingProductIds: [],
    pausedProductIds: [],
  };

  const result = await loadAllProducts();
  if (result.error) throw new Error(`Failed to load products: ${result.error}`);

  // If the unified read did not cover all rows, fall back to per-purpose reads
  // so each function still works correctly on a very large catalogue.
  if (result.count > result.rows.length) {
    return getProductsSummaryFallback(account.accountId);
  }

  const rows = result.rows;
  const activeRows = rows.filter((r) => r.status === "active");

  // Missing-image list: imageless products, newest first, capped. The unified
  // read is already sorted by created_at desc, so slicing is equivalent to
  // the former order().limit() read.
  const missingImage = rows
    .filter((r) => r.image_key === null)
    .slice(0, MISSING_IMAGE_LIMIT)
    .map((r) => ({ id: r.id, title: r.title }));

  return {
    total: result.count,
    missingImage,
    noBuyPathCount: activeRows.filter((r) => !r.purchase_url).length,
    hasPhysicalProducts: activeRows.some((r) => !r.digital_file_key),
    activeProductIds: activeRows.map((r) => r.id),
    checkingProductIds: activeRows
      .filter((r) => r.moderation_status === "pending" || r.moderation_status === "review")
      .map((r) => r.id),
    pausedProductIds: activeRows
      .filter((r) => r.moderation_status === "paused" || r.moderation_status === "removed")
      .map((r) => r.id),
  };
}

/**
 * Per-purpose fallback for getProductsSummary when the unified read did not
 * cover all rows (count > ACTIVE_PRODUCTS_LIMIT). Preserves the original three
 * reads so a very large catalogue still returns correct data.
 */
async function getProductsSummaryFallback(ownerId: string): Promise<ProductsSummary> {
  const supabase = await createClient();
  const [counted, missing, active] = await Promise.all([
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId),
    supabase
      .from("products")
      .select("id, title")
      .eq("owner_id", ownerId)
      .is("image_key", null)
      .order("created_at", { ascending: false })
      .limit(MISSING_IMAGE_LIMIT),
    supabase
      .from("products")
      .select("id, purchase_url, digital_file_key, moderation_status")
      .eq("owner_id", ownerId)
      .eq("status", "active")
      .limit(ACTIVE_PRODUCTS_LIMIT),
  ]);
  if (counted.error) throw new Error(`Failed to count products: ${counted.error.message}`);
  if (missing.error) throw new Error(`Failed to load products: ${missing.error.message}`);
  if (active.error) throw new Error(`Failed to load active products: ${active.error.message}`);

  const activeRows = active.data ?? [];
  return {
    total: counted.count ?? 0,
    missingImage: (missing.data ?? []).map((row) => ({ id: row.id, title: row.title })),
    noBuyPathCount: activeRows.filter((row) => !row.purchase_url).length,
    hasPhysicalProducts: activeRows.some((row) => !row.digital_file_key),
    activeProductIds: activeRows.map((row) => row.id),
    checkingProductIds: activeRows
      .filter((row) => row.moderation_status === "pending" || row.moderation_status === "review")
      .map((row) => row.id),
    pausedProductIds: activeRows
      .filter((row) => row.moderation_status === "paused" || row.moderation_status === "removed")
      .map((row) => row.id),
  };
}

/**
 * Profile fields that drive the overview's Needs-attention rows, scoped to
 * the active account. The `profiles` table is the seller's own row (RLS
 * enforces identity), so team members reading the owner's store see the
 * owner's profile data here — consistent with every other settings read.
 */
export type ProfileSummary = {
  /**
   * Null = no business name set. Product pages read "Sold by Untitled
   * storefront" and the Seller block shows the internal storefront name.
   * Fixed at Settings › Tax › Business name.
   */
  taxBusinessName: string | null;
  /**
   * Null = no seller contact email. A product with a `purchase_url` always
   * has a buy path regardless; only products WITHOUT a purchase_url need the
   * account email as fallback. Combined with `noBuyPathCount` in the caller.
   * Fixed at Settings › Tax › Contact email.
   */
  sellerEmail: string | null;
  /**
   * Null = no postal address set. Required, alongside the trader name and the
   * contact email, before anything of this account's may be published or sold
   * (lib/settings/trader-identity.ts).
   * Fixed at Settings › Business & seller details.
   */
  sellerAddress: string | null;
  /**
   * True when the account has written any shipping and returns terms.
   * An account that has never opened the shipping page stores null; one that
   * opened it and saved something stores a non-null object. Physical sellers
   * without this show "The seller has not added shipping details yet."
   * Fixed at Settings › Shipping.
   */
  shippingPolicySet: boolean;
  /**
   * True when at least one destination can be QUOTED at checkout: it has both a
   * delivery rate and a country (lib/shipping/rates.ts hasPricedDestination).
   * Terms can be set without this, and then a physical product has no Pay
   * button however open checkout is.
   * Fixed in the destination rows of Settings › Shipping & returns.
   */
  shippingRatesSet: boolean;
  /**
   * Null = never accepted legal docs. Non-null: the version string; compare
   * to LEGAL_VERSION in constants.ts to decide if it is current.
   * Fixed at Settings › Legal.
   */
  legalAcceptedVersion: string | null;
};

/**
 * Given a list of product IDs referenced by storefront blocks, returns the
 * subset that still exist in the database (any status -- draft products are
 * not deleted). The complement is the dead-block set.
 *
 * Uses the unified loadAllProducts read when it has covered all rows; falls
 * back to its own IN query when the catalogue is too large (unreachable in
 * practice: plans cap at 500). Empty input returns immediately.
 * RLS scopes the read to the active account, so a forged product ID returns no
 * row and is safely counted as dead.
 *
 * Returns an empty array on error (soft-fail: the attention row is advisory).
 */
export async function getExistingProductIds(
  referencedIds: string[],
): Promise<string[]> {
  if (referencedIds.length === 0) return [];
  const account = await getActiveAccount();
  if (!account) return [];

  // Check the unified read first: if it covered all rows, there is no need
  // for a second query.
  const cached = await loadAllProducts();
  if (!cached.error && cached.count <= cached.rows.length) {
    const ownedIds = new Set(cached.rows.map((r) => r.id));
    return referencedIds.filter((id) => ownedIds.has(id));
  }

  // Fall back when the unified read truncated the catalogue.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("owner_id", account.accountId)
    .in("id", referencedIds);
  if (error) {
    console.warn("[dashboard] dead-block check failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => row.id);
}

/** Safety bounds for the restock forecast, not pagination: counted products,
 *  and paid orders in the pace window. */
const RESTOCK_PRODUCTS_LIMIT = 200;
const RESTOCK_ORDERS_LIMIT = 5000;

/**
 * The overview's restock forecast (forecastRestocks in lib/predictions.ts):
 * live, counted products with stock left, against the units each sold in paid
 * orders over the last RESTOCK_PACE_DAYS. Two reads at most, no N+1.
 *
 * Uses the unified loadAllProducts read for the product candidates; falls back
 * to its own query only when the catalogue exceeds ACTIVE_PRODUCTS_LIMIT (not
 * reachable in practice). Reads orders ONLY when at least one restock candidate
 * exists: stock tracking is opt-in, so most sellers skip the orders read
 * entirely. An order's add-ons are not counted, so a product sold mostly as an
 * add-on is forecast late rather than early. Fails soft to none: the row is
 * advisory.
 */
export async function getRestockForecasts(now = new Date()): Promise<RestockForecast[]> {
  const account = await getActiveAccount();
  if (!account) return [];

  // Restock candidates: active, stock-tracked, with units remaining.
  let candidates: { id: string; title: string; stock_quantity: number; low_stock_threshold: number | null }[] = [];

  const cached = await loadAllProducts();
  if (!cached.error && cached.count <= cached.rows.length) {
    // Unified read has all rows: filter in memory, no extra DB round-trip.
    candidates = cached.rows
      .filter(
        (r) =>
          r.status === "active" &&
          r.track_stock === true &&
          (r.stock_quantity ?? 0) > 0,
      )
      .slice(0, RESTOCK_PRODUCTS_LIMIT)
      .map((r) => ({
        id: r.id,
        title: r.title,
        stock_quantity: r.stock_quantity ?? 0,
        low_stock_threshold: r.low_stock_threshold,
      }));
  } else {
    // Fall back: the cache missed or was truncated; read candidates directly.
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, title, stock_quantity, low_stock_threshold")
      .eq("owner_id", account.accountId)
      .eq("status", "active")
      .eq("track_stock", true)
      .gt("stock_quantity", 0)
      .limit(RESTOCK_PRODUCTS_LIMIT);
    if (error || !data || data.length === 0) {
      if (error) console.warn("[dashboard] restock products failed:", error.message);
      return [];
    }
    candidates = data as typeof candidates;
  }

  if (candidates.length === 0) return [];

  // Orders read is deferred to here: skip it entirely when no product tracks
  // stock (the common case for digital sellers).
  const supabase = await createClient();
  const since = new Date(now.getTime() - RESTOCK_PACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error: ordersError } = await (supabase as SupabaseClient)
    .from("orders")
    .select("product_id, quantity")
    .eq("seller_id", account.accountId)
    .eq("status", "paid")
    .gte("created_at", since)
    .limit(RESTOCK_ORDERS_LIMIT);
  if (ordersError) {
    console.warn("[dashboard] restock orders failed:", ordersError.message);
    return [];
  }

  const unitsSold: Record<string, number> = {};
  for (const order of (orders ?? []) as { product_id: string | null; quantity: number | null }[]) {
    if (!order.product_id) continue;
    unitsSold[order.product_id] = (unitsSold[order.product_id] ?? 0) + (order.quantity ?? 1);
  }
  return forecastRestocks(
    candidates.map((p) => ({
      id: p.id,
      title: p.title,
      stockQuantity: p.stock_quantity,
      lowStockThreshold: p.low_stock_threshold ?? LOW_STOCK_THRESHOLD_DEFAULT,
    })),
    unitsSold,
  );
}

/**
 * Returns null when there is no active account or the read fails softly.
 *
 * Owner path: getProfile() (cached, select *) is already in-flight for this
 * render; derive the summary from that result rather than a second read.
 *
 * Team-member path: the active account is the owner's store, so the owner's
 * profile row must be read directly by its id. The signed-in member's own
 * getProfile() row is a different record; the original targeted read applies.
 */
export async function getProfileSummary(): Promise<ProfileSummary | null> {
  const account = await getActiveAccount();
  if (!account) return null;

  if (account.isOwner) {
    // The signed-in owner: getProfile() already read their row (select *)
    // in this render, so no extra round-trip is needed.
    const profile = await getProfile();
    if (!profile) return null;
    return {
      taxBusinessName: profile.tax_business_name ?? null,
      sellerEmail: profile.seller_email ?? null,
      sellerAddress: profile.seller_address ?? null,
      shippingPolicySet: profile.shipping_policy !== null,
      shippingRatesSet: hasPricedDestination(
        buildShippingPolicy({ shipping_policy: profile.shipping_policy }),
      ),
      legalAcceptedVersion: profile.legal_accepted_version ?? null,
    };
  }

  // Team member: the owner's profile row is read by the owner's account id.
  // The signed-in member's getProfile() is a different row; skip it.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "tax_business_name, seller_email, seller_address, shipping_policy, legal_accepted_version",
    )
    .eq("id", account.accountId)
    .maybeSingle();
  if (error) {
    // Soft-fail: attention rows are advisory. A read error should not break
    // the overview page or hide the revenue metrics the seller came for.
    console.warn("[dashboard] profile summary read failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    taxBusinessName: data.tax_business_name ?? null,
    sellerEmail: data.seller_email ?? null,
    sellerAddress: data.seller_address ?? null,
    shippingPolicySet: data.shipping_policy !== null,
    shippingRatesSet: hasPricedDestination(
      buildShippingPolicy({ shipping_policy: data.shipping_policy }),
    ),
    legalAcceptedVersion: data.legal_accepted_version ?? null,
  };
}
