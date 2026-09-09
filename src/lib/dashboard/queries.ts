import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { toCurrency } from "@/lib/format/money";
import type { Currency } from "@/types/product";

// READ-ONLY dashboard aggregates. Server Components / Route Handlers only
// (cookies() is Node-only — never middleware).
//
// The `orders` table and its columns are OWNED BY THE SEED/ORDERS WORK — this
// module never creates or alters it, and reads fail soft (calm zero states)
// while that table is still landing. Column contract (do not rename):
//   seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, product_title, product_price_cents,
//   created_at

export type OrderChannel = "embed" | "marketplace";
export type OrderStatus = "paid" | "refunded" | "disputed" | "pending";

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
    recentOrders: payload.recent_orders,
    refundedCount: payload.refunded_count,
    disputedCount: payload.disputed_count,
  };
}

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
 * Bounded on purpose: `total` is a head-only exact count (no rows leave the
 * database), and the missing-image list is capped at MISSING_IMAGE_LIMIT
 * newest. The active-products list caps at ACTIVE_PRODUCTS_LIMIT (still a
 * small payload: UUID strings only).
 */
export async function getProductsSummary(): Promise<ProductsSummary> {
  const account = await getActiveAccount();
  if (!account) return {
    total: 0,
    missingImage: [],
    noBuyPathCount: 0,
    hasPhysicalProducts: false,
    activeProductIds: [],
  };
  const supabase = await createClient();
  const [counted, missing, active] = await Promise.all([
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", account.accountId),
    supabase
      .from("products")
      .select("id, title")
      .eq("owner_id", account.accountId)
      .is("image_key", null)
      .order("created_at", { ascending: false })
      .limit(MISSING_IMAGE_LIMIT),
    // Fetch buy-path and physical-product facts for all active products.
    // `purchase_url` is null for products with no external link (only the
    // seller's contact email, if set, gives a buyer a way to reach them).
    // `digital_file_key` null = a physical item that needs shipping terms.
    supabase
      .from("products")
      .select("id, purchase_url, digital_file_key")
      .eq("owner_id", account.accountId)
      .eq("status", "active")
      .limit(ACTIVE_PRODUCTS_LIMIT),
  ]);
  if (counted.error)
    throw new Error(`Failed to count products: ${counted.error.message}`);
  if (missing.error)
    throw new Error(`Failed to load products: ${missing.error.message}`);
  if (active.error)
    throw new Error(`Failed to load active products: ${active.error.message}`);

  const activeRows = active.data ?? [];
  return {
    total: counted.count ?? 0,
    missingImage: (missing.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
    })),
    noBuyPathCount: activeRows.filter((row) => !row.purchase_url).length,
    hasPhysicalProducts: activeRows.some((row) => !row.digital_file_key),
    activeProductIds: activeRows.map((row) => row.id),
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
 * One IN query, no N+1. Empty input returns immediately without hitting the DB.
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

/** Returns null when there is no active account or the read fails softly. */
export async function getProfileSummary(): Promise<ProfileSummary | null> {
  const account = await getActiveAccount();
  if (!account) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "tax_business_name, seller_email, seller_address, shipping_policy, legal_accepted_version",
    )
    .eq("id", account.accountId)
    .maybeSingle();
  if (error) {
    // Soft-fail: attention rows are advisory. A read error should not break the
    // overview page or hide the revenue metrics the seller actually came for.
    console.warn("[dashboard] profile summary read failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    taxBusinessName: data.tax_business_name ?? null,
    sellerEmail: data.seller_email ?? null,
    sellerAddress: data.seller_address ?? null,
    shippingPolicySet: data.shipping_policy !== null,
    legalAcceptedVersion: data.legal_accepted_version ?? null,
  };
}
