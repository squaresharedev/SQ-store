import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ilikeAny } from "@/lib/supabase/ilike";
import { getActiveAccount } from "@/lib/team/account-context";
import { parseOrderSelection } from "@/lib/orders/selection";
import { parseShipTo } from "@/lib/orders/ship-to";
import { parseFulfilment } from "@/lib/orders/fulfilment";
import { orderPhotoKey } from "@/lib/orders/photo";
import { presignGetUrl } from "@/lib/r2";
import { isContentVisible } from "@/lib/moderation/removal";
import type { OrderExportRow } from "@/lib/orders/csv";
import { ORDER_CHANNELS, REFUND_REASONS, WITHDRAWN_STATUS_FILTER } from "@/types/order-view";
import type {
  OrderView,
  OrderListRow,
  OrderDiscount,
  OrderFilters,
  OrderSelection,
  OrderSort,
  OrderChannel,
  OrderStatus,
  OrdersView,
  Paginated,
} from "@/types/order-view";

// READ-ONLY orders reads. Server Components / Route Handlers only (cookies()
// is Node-only — never middleware). Orders are WRITTEN in exactly two places:
// the order writer (lib/orders/record.ts, service role) and the seller's
// "mark as shipped" (lib/orders/actions.ts, through public.order_mark_shipped).
//
// Reads go through an untyped client cast against the column contract below,
// which predates `orders` appearing in the generated types. Column contract
// (do not rename):
//   id, seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, buyer_email, product_title,
//   product_price_cents, selected_options, created_at, quantity, ship_to,
//   buyer_locale, fulfilment_status, shipped_at, tracking_number,
//   tracking_carrier, checkout_session_id, gift_message, withdrawal_requested_at,
//   platform_fee_bps, shipping_cents, discount_id, discount_cents,
//   discount_code_id, discount_code

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Return an empty paginated envelope with the given page/pageSize echoed back. */
function emptyPage(page: number, pageSize: number): Paginated<OrderListRow> {
  return { rows: [], total: 0, page, pageSize };
}

/** Coerce an unknown channel string to a valid OrderChannel; anything the list
 *  does not know reads as the embed, the oldest channel. Exported for tests. */
export function toChannel(value: unknown): OrderChannel {
  return (ORDER_CHANNELS as readonly unknown[]).includes(value) ? (value as OrderChannel) : "embed";
}

/** Coerce an unknown status string to a valid OrderStatus. */
function toStatus(value: unknown): OrderStatus {
  const VALID: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];
  return VALID.includes(value as OrderStatus) ? (value as OrderStatus) : "pending";
}

/** Map a raw DB row to the OrderView shape. Money stays integer cents. */
function toOrderView(row: Record<string, unknown>): OrderView {
  const quantity = Number(row.quantity);
  return {
    id: String(row.id),
    productTitle: String(row.product_title ?? ""),
    selection: parseOrderSelection(row.selected_options),
    quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
    shipTo: parseShipTo(row.ship_to),
    fulfilment: parseFulfilment(row),
    amountCents: Number(row.amount_cents ?? 0),
    platformFeeCents: Number(row.platform_fee_cents ?? 0),
    platformFeeBps: row.platform_fee_bps != null ? Number(row.platform_fee_bps) : null,
    currency: String(row.currency ?? ""),
    channel: toChannel(row.channel),
    status: toStatus(row.status),
    buyerEmail: row.buyer_email != null ? String(row.buyer_email) : null,
    createdAt: String(row.created_at ?? ""),
    giftMessage: row.gift_message != null ? String(row.gift_message) : null,
    withdrawalRequestedAt:
      row.withdrawal_requested_at != null ? String(row.withdrawal_requested_at) : null,
    discount: toOrderDiscount(row),
    refund: toOrderRefund(row),
    stockReserved: Number.isInteger(Number(row.stock_reserved)) ? Math.max(0, Number(row.stock_reserved)) : 0,
    paidThroughProvider: isProviderPayment(row.payment_ref),
  };
}

/** Whether orders.payment_ref names a payment a provider can refund (a Stripe
 *  PaymentIntent). The id itself never leaves the server. */
export function isProviderPayment(paymentRef: unknown): boolean {
  return typeof paymentRef === "string" && paymentRef.startsWith(PROVIDER_PAYMENT_PREFIX);
}

/** When and why an order was taken back, or null for one that stands. A
 *  reason outside REFUND_REASONS reads as "no reason given", never as an error. */
function toOrderRefund(row: Record<string, unknown>): OrderView["refund"] {
  if (row.refunded_at == null) return null;
  const reason = REFUND_REASONS.find((known) => known === row.refund_reason) ?? null;
  return { at: String(row.refunded_at), reason };
}

/** The orders.discount_* snapshot, or null when no discount touched the order. */
function toOrderDiscount(row: Record<string, unknown>): OrderDiscount | null {
  const cents = Number(row.discount_cents ?? 0);
  const code = typeof row.discount_code === "string" && row.discount_code ? row.discount_code : null;
  const safeCents = Number.isInteger(cents) && cents > 0 ? cents : 0;
  if (safeCents === 0 && !code) return null;
  return {
    cents: safeCents,
    code,
    byCode: code !== null && row.discount_code_id != null && row.discount_code_id === row.discount_id,
  };
}

/** The column list every order read selects — one contract, one place. */
const ORDER_COLUMNS =
  "id, product_title, selected_options, quantity, ship_to, fulfilment_status, shipped_at, tracking_number, tracking_carrier, amount_cents, platform_fee_cents, platform_fee_bps, currency, channel, status, buyer_email, created_at, gift_message, withdrawal_requested_at, discount_id, discount_cents, discount_code_id, discount_code, refunded_at, refund_reason, stock_reserved, payment_ref";

/** How a Stripe PaymentIntent id starts: the one payment_ref a refund can name. */
export const PROVIDER_PAYMENT_PREFIX = "pi_";

/**
 * The bought product's photo fields, EMBEDDED in an order read (PostgREST
 * follows orders.product_id), so a page of orders and their pictures are one
 * query: no second read for the products, and none per row. Named by its
 * foreign key because reviews link orders to products as well, which makes a
 * bare `products(...)` ambiguous.
 */
const ORDER_PHOTO_EMBED =
  "product:products!orders_product_id_fkey(owner_id, image_key, gallery, option_groups, moderation_status)";

/** The product as ORDER_PHOTO_EMBED hands it back; null when it is gone. */
type OrderPhotoProduct = {
  owner_id: string;
  image_key: string | null;
  gallery: unknown;
  option_groups: unknown;
  moderation_status: string | null;
};

/**
 * The R2 key of the photo an order read with ORDER_PHOTO_EMBED shows, or null:
 * none when its product is gone, is another store's, or has been taken down.
 */
function photoKeyOf(
  row: Record<string, unknown>,
  selection: OrderSelection[],
  accountId: string,
): string | null {
  const product = row.product as OrderPhotoProduct | null | undefined;
  if (!product || product.owner_id !== accountId || !isContentVisible(product.moderation_status)) {
    return null;
  }
  return orderPhotoKey(product, selection);
}

/**
 * presignGetUrl, signing each distinct key once. A page of orders is mostly
 * the same few products, and every row of one product gets the same URL,
 * which is also what lets the browser download each picture only once.
 */
function signOncePerKey(): (key: string) => Promise<string | null> {
  const signed = new Map<string, Promise<string | null>>();
  return (key) => {
    let url = signed.get(key);
    if (!url) {
      url = presignGetUrl(key);
      signed.set(key, url);
    }
    return url;
  };
}

/**
 * The To ship rule (lib/orders/fulfilment.ts isToShip) as a query filter, so
 * the list and the count cannot disagree about what is waiting. Served by the
 * partial index orders_seller_to_ship_idx.
 */
const TO_SHIP_MATCH = { status: "paid", fulfilment_status: "unfulfilled" } as const;

/** The column a buyer's withdrawal is recorded in. */
const WITHDRAWN_AT = "withdrawal_requested_at";

/** What the Orders search box matches, each as a case-insensitive substring. */
const ORDER_SEARCH_COLUMNS = [
  "buyer_email",
  "ship_to->>name",
  "ship_to->>city",
  "product_title",
  "tracking_number",
] as const;

/** The query methods the order filters below are written against: a PostgREST
 *  filter builder, each method returning the builder. */
type OrderFilterable = {
  match(query: Record<string, unknown>): OrderFilterable;
  is(column: string, value: null): OrderFilterable;
  not(column: string, operator: string, value: unknown): OrderFilterable;
  eq(column: string, value: unknown): OrderFilterable;
};

/**
 * The queue and its count: to ship, and not withdrawn from. A buyer who has
 * withdrawn is owed a refund, not a parcel, so their order waits under
 * "Withdrawn" instead of being counted as one more thing to send. The order
 * panel still offers "Mark as shipped" on it, with a warning, for the seller
 * who has agreed otherwise with the buyer.
 */
function onlyToShip<T>(query: T): T {
  // Cast through a minimal shape: checking a PostgREST builder against a
  // generic constraint is too deep for the compiler on some selects.
  return (query as unknown as OrderFilterable).match(TO_SHIP_MATCH).is(WITHDRAWN_AT, null) as unknown as T;
}

/**
 * Days a withdrawal keeps asking for the seller's attention. The refund is due
 * within 14 days of it; past a month the matter has been settled with the
 * buyer one way or another, and a row that can never be cleared would be one
 * the seller learns to ignore.
 */
const WITHDRAWAL_ATTENTION_DAYS = 30;

/**
 * The "Withdrawn" status filter: still paid (no refund recorded yet) and
 * withdrawn from by the buyer. A pseudo status, beside the database's own
 * statuses in the Orders toolbar, because that is where a seller looks.
 */
function onlyWithdrawn<T>(query: T): T {
  return (query as unknown as OrderFilterable).eq("status", "paid").not(WITHDRAWN_AT, "is", null) as unknown as T;
}

/** Postgres would error on a malformed uuid, so a bad id is filtered out here
 *  rather than surfaced as "orders are unavailable". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One order by id, scoped to the active account (RLS enforces the same at the
 * DB). Returns null when the id is malformed, the order does not exist, or it
 * belongs to someone else — all three are "nothing to show", never an error:
 * this backs a deep link (/orders?order=<id>) whose id can be stale.
 */
export async function getOrderById(id: string): Promise<OrderView | null> {
  if (!UUID.test(id)) return null;

  const account = await getActiveAccount();
  if (!account) return null;

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", account.accountId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toOrderView(data as Record<string, unknown>);
}

/** The dashboard only ever asks about its Recent orders card's handful. */
const MAX_BATCH_IDS = 20;

/**
 * Several orders by id in one query, scoped like getOrderById. Backs the
 * overview's Recent orders card, which opens each row's detail panel in place
 * and so needs the full order up front, not just the aggregate's summary.
 * Soft-fails to [] (malformed ids are dropped): a row without its detail still
 * links to /orders?order=<id>, so a failed read here costs speed, not access.
 */
export async function getOrdersByIds(ids: string[]): Promise<OrderView[]> {
  const valid = Array.from(new Set(ids.filter((id) => UUID.test(id)))).slice(0, MAX_BATCH_IDS);
  if (valid.length === 0) return [];

  const account = await getActiveAccount();
  if (!account) return [];

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", account.accountId)
    .in("id", valid);

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toOrderView);
}

/** What a Recent orders row shows beside its title: the photo and the units. */
export type OrderGlance = {
  /** Units sold, 1 or more. */
  quantity: number;
  /** Signed photo URL of the product bought; null when it has none, is gone,
   *  or moderation has taken it down. */
  photoUrl: string | null;
};

/**
 * Photo and quantity for several orders in one query (the photo comes embedded,
 * see ORDER_PHOTO_EMBED), keyed by order id. Scoped like getOrdersByIds.
 * Soft-fails to {}: the card reads fine without thumbnails, so a blip costs
 * polish only.
 */
export async function getOrderGlances(ids: string[]): Promise<Record<string, OrderGlance>> {
  const valid = Array.from(new Set(ids.filter((id) => UUID.test(id)))).slice(0, MAX_BATCH_IDS);
  if (valid.length === 0) return {};

  const account = await getActiveAccount();
  if (!account) return {};

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select(`id, quantity, selected_options, ${ORDER_PHOTO_EMBED}`)
    .eq("seller_id", account.accountId)
    .in("id", valid);
  if (error || !data) return {};

  const sign = signOncePerKey();
  const glances: Record<string, OrderGlance> = {};
  await Promise.all(
    (data as Record<string, unknown>[]).map(async (row) => {
      const quantity = Number(row.quantity);
      const key = photoKeyOf(row, parseOrderSelection(row.selected_options), account.accountId);
      glances[String(row.id)] = {
        quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
        photoUrl: key ? await sign(key) : null,
      };
    }),
  );
  return glances;
}

/**
 * How many orders are waiting to be shipped in the ACTIVE store. Behind the
 * Orders count in the sidebar, the overview's "to ship" row and the Orders
 * page's default view, all in one request, so it is cached per request and
 * those three reads are one query.
 *
 * Soft-fails to 0: a count that blips must never block a page, and "nothing to
 * ship" is the quiet answer (the list itself still throws on a real error).
 */
export const countOrdersToShip = cache(async (): Promise<number> => {
  const account = await getActiveAccount();
  if (!account) return 0;

  const supabase = await createClient();
  const { count, error } = await onlyToShip(
    (supabase as SupabaseClient)
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", account.accountId),
  );
  if (error) {
    console.error("[orders] to-ship count failed", error.message);
    return 0;
  }
  return count ?? 0;
});

/**
 * Buyers who withdrew from an order in the last WITHDRAWAL_ATTENTION_DAYS and
 * have not been refunded yet, in the ACTIVE store: the overview's "refund
 * owed" row. Soft-fails to 0, like the to-ship count.
 */
export const countWithdrawalsToSettle = cache(async (): Promise<number> => {
  const account = await getActiveAccount();
  if (!account) return 0;

  const since = new Date(Date.now() - WITHDRAWAL_ATTENTION_DAYS * 24 * 60 * 60 * 1000);
  const supabase = await createClient();
  const { count, error } = await onlyWithdrawn(
    (supabase as SupabaseClient)
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", account.accountId),
  ).gte(WITHDRAWN_AT, since.toISOString());
  if (error) {
    console.error("[orders] withdrawal count failed", error.message);
    return 0;
  }
  return count ?? 0;
});

/** The most to-ship rows the per-product tally reads. Far past any real queue;
 *  past it a card says "to ship" without the exact count being right. */
const TO_SHIP_TALLY_LIMIT = 1000;

/**
 * Orders still to ship, per product, in the ACTIVE store: the products list
 * says on each card how many are waiting, and its delete dialog warns before
 * a product with parcels still owed is removed. Soft-fails to {}: the delete
 * action asks again for itself (countToShipForProduct) before it deletes.
 */
export async function toShipByProduct(): Promise<Record<string, number>> {
  const account = await getActiveAccount();
  if (!account) return {};

  const supabase = await createClient();
  const { data, error } = await onlyToShip(
    (supabase as SupabaseClient)
      .from("orders")
      .select("product_id")
      .eq("seller_id", account.accountId)
      .not("product_id", "is", null)
      .limit(TO_SHIP_TALLY_LIMIT),
  );
  if (error) {
    console.error("[orders] to-ship tally failed", error.message);
    return {};
  }
  const tally: Record<string, number> = {};
  for (const row of (data ?? []) as { product_id: string }[]) {
    tally[row.product_id] = (tally[row.product_id] ?? 0) + 1;
  }
  return tally;
}

/**
 * How many orders of one product are still to ship in the given store, or
 * null when that could not be read. The delete action's own check, so a
 * warning the page showed before an order came in is not taken as consent.
 */
export async function countToShipForProduct(
  accountId: string,
  productId: string,
): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await onlyToShip(
    (supabase as SupabaseClient)
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", accountId),
  ).eq("product_id", productId);
  if (error) {
    console.error("[orders] product to-ship count failed", error.message);
    return null;
  }
  return count ?? 0;
}

/** PostgREST hands back at most this many rows a request, so the export
 *  reads in pages of it. */
const EXPORT_PAGE_SIZE = 1000;

/**
 * Every order in the ACTIVE store for the CSV export (lib/orders/csv.ts),
 * newest first, up to `maxRows`. Scoped like every read here: the store comes
 * from the session, and RLS enforces the same boundary underneath. Reads one
 * row past the cap so the caller can say the file is the newest slice.
 *
 * THROWS on a read error, like listOrders: a half-read ledger handed over as
 * if it were whole is worse than no file.
 */
export async function listOrdersForExport(
  maxRows: number,
): Promise<{ rows: OrderExportRow[]; truncated: boolean }> {
  const account = await getActiveAccount();
  if (!account) return { rows: [], truncated: false };

  const supabase = await createClient();
  const rows: OrderExportRow[] = [];
  for (let from = 0; from <= maxRows; from += EXPORT_PAGE_SIZE) {
    const to = Math.min(from + EXPORT_PAGE_SIZE, maxRows + 1) - 1;
    const { data, error } = await (supabase as SupabaseClient)
      .from("orders")
      .select(`${ORDER_COLUMNS}, shipping_cents`)
      .eq("seller_id", account.accountId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Orders export read failed: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) {
      rows.push({
        ...toOrderView(row),
        shippingCents: row.shipping_cents != null ? Number(row.shipping_cents) : null,
      });
    }
    if (page.length < to - from + 1) break;
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}

/**
 * Owner-scoped, paginated order list. The seller id comes from the session
 * (never from the caller); RLS enforces the same boundary at the DB.
 *
 * `view: "to-ship"` is the work queue: only orders waiting to be shipped,
 * OLDEST first whatever the sort says (the order they should go out in), and
 * no filters, which answer questions about history rather than about work.
 *
 * Each row carries its product's photo, read in the SAME query (see
 * ORDER_PHOTO_EMBED) and signed without a network call, so a page costs one
 * read whatever is on it.
 *
 * Returns an empty Paginated when the user is not signed in; THROWS on a read
 * error (see below).
 */
export async function listOrders(options?: {
  view?: OrdersView;
  filters?: OrderFilters;
  /** One product's orders only. Unlike `filters` it narrows the To ship queue
   *  too: "this product's parcels" is a question about work, not history. */
  productId?: string;
  sort?: OrderSort;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<OrderListRow>> {
  // Clamp pagination inputs.
  const pageSize = Math.min(
    Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(1, options?.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const account = await getActiveAccount();
  if (!account) return emptyPage(page, pageSize);

  const supabase = await createClient();
  const toShip = options?.view === "to-ship";
  const filters = toShip ? undefined : options?.filters;
  const sort: OrderSort = toShip
    ? { field: "createdAt", direction: "asc" }
    : (options?.sort ?? { field: "createdAt", direction: "desc" });

  // Build the base query — select only needed columns; count for pagination.
  // Scoped to the ACTIVE account's store (own, or one you're a member of).
  let query = (supabase as SupabaseClient)
    .from("orders")
    .select(`${ORDER_COLUMNS}, ${ORDER_PHOTO_EMBED}`, { count: "exact" })
    .eq("seller_id", account.accountId);
  if (toShip) query = onlyToShip(query);
  if (options?.productId) query = query.eq("product_id", options.productId);

  // --- Filters ---
  if (filters?.status === WITHDRAWN_STATUS_FILTER) {
    query = onlyWithdrawn(query);
  } else if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.channel) {
    query = query.eq("channel", filters.channel);
  }
  if (filters?.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00Z`);
  }
  if (filters?.dateTo) {
    query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
  }
  if (filters?.search && filters.search.trim() !== "") {
    // Whatever a seller remembers about an order: who bought it, where it
    // went, what it was, or the tracking number on the parcel.
    query = query.or(ilikeAny(ORDER_SEARCH_COLUMNS, filters.search.trim()));
  }

  // --- Sort ---
  const sortColumn = sort.field === "amount" ? "amount_cents" : "created_at";
  const ascending = sort.direction === "asc";
  query = query
    .order(sortColumn, { ascending })
    // Stable tiebreak so pagination is deterministic.
    .order("id", { ascending: true });

  // --- Offset pagination ---
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    // THROW, do not soft-fail. A swallowed error here renders the calm
    // "no orders yet" empty state, which for a store with sales is a lie the
    // user cannot distinguish from reality. error.tsx gives them the truth
    // and a retry button instead.
    throw new Error(`Orders are unavailable right now: ${error.message}`);
  }

  const sign = signOncePerKey();
  const rows = await Promise.all(
    ((data ?? []) as Record<string, unknown>[]).map(async (row): Promise<OrderListRow> => {
      const order = toOrderView(row);
      const key = photoKeyOf(row, order.selection, account.accountId);
      return { ...order, photoUrl: key ? await sign(key) : null };
    }),
  );
  const total = count ?? 0;

  return { rows, total, page, pageSize };
}
