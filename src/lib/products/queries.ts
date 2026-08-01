import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/supabase/ilike";
import { getActiveAccount } from "@/lib/team/account-context";
import { presignGetUrl } from "@/lib/r2";
import { toCurrency } from "@/lib/format/money";
import type { Tables } from "@/types";
import type {
  Product,
  ProductFilters,
  ProductSales,
  ProductSalesSummary,
} from "@/types/product";
import type { Paginated } from "@/types/pagination";
import {
  isMetricSort,
  metricValue,
  type MetricSort,
  type ProductSort,
} from "@/lib/products/sort";
import { productIdSchema } from "@/lib/validation/product";

// Server-side reads for the ACTIVE account's products (your own store, or one
// you're a team member of). Server Components / Route Handlers only. RLS now
// permits reading any store you belong to, so every query MUST filter by the
// resolved active account id explicitly — otherwise a member's list would mix
// every store they can see. `getActiveAccount()` validates that selection.

type ProductRow = Tables<"products">;

/**
 * Exactly the columns rowToProduct reads. Named explicitly (rather than
 * `select("*")`) so a future wide column — a settings blob, a description
 * history — cannot silently join every product-list payload. A full ProductRow
 * satisfies this structurally, so getProduct can keep selecting everything.
 */
type ProductListRow = Pick<
  ProductRow,
  | "id"
  | "title"
  | "description"
  | "price_cents"
  | "currency"
  | "status"
  | "image_key"
  | "digital_file_key"
  | "track_stock"
  | "stock_quantity"
  | "low_stock_threshold"
>;

const PRODUCT_LIST_COLUMNS =
  "id, title, description, price_cents, currency, status, image_key, digital_file_key, track_stock, stock_quantity, low_stock_threshold";

/**
 * Safety bound, not pagination. Every row costs an R2 presign (an HMAC) on top
 * of the transfer, so an unbounded list is the one query here that can degrade
 * pathologically. Set far above any realistic catalogue; real pagination is
 * required before a seller can approach it, hence the warning below.
 */
const PRODUCT_LIST_LIMIT = 500;

/** Keys look like `files/{ownerId}/{uuid}-{name}`; recover the display name. */
const UUID_DASH_LENGTH = 37; // 36-char uuid + "-"

function fileNameFromKey(key: string | null): string | null {
  if (!key) return null;
  const lastSegment = key.split("/").pop() ?? "";
  return lastSegment.length > UUID_DASH_LENGTH
    ? lastSegment.slice(UUID_DASH_LENGTH)
    : lastSegment || null;
}

/** Map a DB row (integer cents, R2 keys) to the UI contract (decimal, names). */
async function rowToProduct(row: ProductListRow): Promise<Product> {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    price: row.price_cents / 100,
    currency: row.currency === "USD" ? "USD" : "EUR",
    status: row.status === "active" ? "active" : "draft",
    // Dashboard-only signed GET (local HMAC, no network round-trip). Null when
    // R2 credentials are not configured — cards show the placeholder tile.
    imageUrl: row.image_key ? await presignGetUrl(row.image_key) : null,
    digitalFileName: fileNameFromKey(row.digital_file_key),
    // Stock columns — owner-scoped reads; sellers may see real numbers.
    trackStock: row.track_stock,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
  };
}

export const PRODUCTS_DEFAULT_PAGE_SIZE = 24;
export const PRODUCTS_MAX_PAGE_SIZE = 96;

/**
 * The ACTIVE account's whole catalogue, newest first, bounded by
 * PRODUCT_LIST_LIMIT.
 *
 * For consumers that genuinely need every product at once and cannot paginate:
 * the storefront designer's picker (you must be able to place any product on
 * the canvas) and the storefront list's previews. The products PAGE uses
 * `listProducts` instead, which pages and only presigns what it shows.
 */
export async function listAllProducts(): Promise<Product[]> {
  const account = await getActiveAccount();
  if (!account) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_COLUMNS)
    .eq("owner_id", account.accountId)
    .order("created_at", { ascending: false })
    .limit(PRODUCT_LIST_LIMIT);
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  if (data.length >= PRODUCT_LIST_LIMIT) {
    console.warn(
      `[products] listAllProducts hit the ${PRODUCT_LIST_LIMIT}-product cap; the storefront picker is showing the newest ${PRODUCT_LIST_LIMIT} only.`,
    );
  }
  return Promise.all(data.map(rowToProduct));
}

/** Column each DB-orderable sort maps to, with its direction. */
const DB_SORT_COLUMNS: Partial<
  Record<ProductSort, { column: string; ascending: boolean }>
> = {
  default: { column: "created_at", ascending: false },
  title: { column: "title", ascending: true },
  priceHigh: { column: "price_cents", ascending: false },
  priceLow: { column: "price_cents", ascending: true },
};

/**
 * The slice of the Supabase query builder these filters need. Structural, so
 * the helper works for any `select(...)` shape without being generic over the
 * whole builder (the two products reads select different columns).
 */
type ProductFilterable<T> = {
  eq(column: string, value: string): T;
  ilike(column: string, pattern: string): T;
};

/** Apply the account scope + user filters shared by every products read. */
function applyProductFilters<T extends ProductFilterable<T>>(
  query: T,
  accountId: string,
  filters: ProductFilters | undefined,
): T {
  // Account scope is NOT optional: RLS permits reading any store you belong
  // to, so without this a team member's list would mix every store they see.
  let next = query.eq("owner_id", accountId);
  if (filters?.status) next = next.eq("status", filters.status);
  const search = filters?.search?.trim();
  if (search) {
    // Title only: descriptions are long-form and would make every search a
    // full-text-shaped scan without the index to back it.
    next = next.ilike("title", `%${escapeIlike(search)}%`);
  }
  return next;
}

/**
 * One page of the ACTIVE account's products, filtered and sorted server-side.
 *
 * Two paths, because the two sort families need different things:
 *
 * - **DB-orderable sorts** (newest, title, price) are a single query with
 *   `order` + `range` + an exact count. Only the page's rows are read, so only
 *   the page's images are presigned — the presign (an HMAC per row) is the
 *   real cost here, not the row transfer.
 *
 * - **Metric sorts** (units sold, revenue) rank by a rollup that lives in the
 *   ORDERS table, so the database cannot order products by it without a join
 *   this schema doesn't have. Sorting just the fetched page would silently
 *   rank 24 arbitrary products and call it "best selling", so instead the
 *   matching ids are read (id + created_at only, no presign), ranked in full,
 *   and only the page's slice is hydrated. Correct across the whole catalogue,
 *   still one presign per displayed card.
 */
export async function listProducts(options?: {
  filters?: ProductFilters;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<Product>> {
  const pageSize = Math.min(
    Math.max(1, Math.trunc(options?.pageSize ?? PRODUCTS_DEFAULT_PAGE_SIZE)),
    PRODUCTS_MAX_PAGE_SIZE,
  );
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const sort = options?.sort ?? "default";
  const empty: Paginated<Product> = { rows: [], total: 0, page, pageSize };

  const account = await getActiveAccount();
  if (!account) return empty;
  const supabase = await createClient();

  const dbSort = isMetricSort(sort) ? undefined : DB_SORT_COLUMNS[sort];
  if (dbSort) {
    const from = (page - 1) * pageSize;
    let query = supabase
      .from("products")
      .select(PRODUCT_LIST_COLUMNS, { count: "exact" });
    query = applyProductFilters(query, account.accountId, options?.filters);
    const { data, error, count } = await query
      .order(dbSort.column, { ascending: dbSort.ascending })
      // Stable tiebreak, so a row can't appear on two pages (or neither).
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load products: ${error.message}`);
    return {
      rows: await Promise.all((data ?? []).map(rowToProduct)),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  // Metric sort: rank the whole filtered set by ids first. `sort` is narrowed
  // by the branch above, since every non-metric sort has a DB column.
  const metricSort = sort as MetricSort;
  let idQuery = supabase.from("products").select("id, created_at");
  idQuery = applyProductFilters(idQuery, account.accountId, options?.filters);
  const { data: idRows, error: idError } = await idQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(PRODUCT_LIST_LIMIT);
  if (idError) throw new Error(`Failed to load products: ${idError.message}`);

  const ids = (idRows ?? []).map((row) => row.id);
  if (ids.length >= PRODUCT_LIST_LIMIT) {
    console.warn(
      `[products] metric sort hit the ${PRODUCT_LIST_LIMIT}-id cap; ranking is computed over the newest ${PRODUCT_LIST_LIMIT} products only.`,
    );
  }

  const sales = await getProductSales();
  const ranked = rankIdsByMetric(ids, metricSort, sales.byProduct);
  const pageIds = ranked.slice((page - 1) * pageSize, page * pageSize);
  if (pageIds.length === 0) {
    return { rows: [], total: ranked.length, page, pageSize };
  }

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_LIST_COLUMNS)
    .eq("owner_id", account.accountId)
    .in("id", pageIds);
  if (error) throw new Error(`Failed to load products: ${error.message}`);

  // `in` returns rows in arbitrary order; restore the ranked order.
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  const ordered = pageIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);

  return {
    rows: await Promise.all(ordered.map(rowToProduct)),
    total: ranked.length,
    page,
    pageSize,
  };
}

/** Order ids by a sales metric, descending, newest-first on ties. `ids` is
 *  already in created_at-desc order, so a stable sort keeps that tiebreak. */
function rankIdsByMetric(
  ids: string[],
  sort: MetricSort,
  byProduct: Record<string, ProductSales | undefined>,
): string[] {
  // Array.prototype.sort is stable in every engine we target.
  return [...ids].sort(
    (a, b) => metricValue(byProduct[b], sort) - metricValue(byProduct[a], sort),
  );
}

/** Read cap, mirroring lib/analytics/queries.ts — revisit with real volume. */
const SALES_READ_LIMIT = 5000;

/**
 * Per-product sales rollup for the ACTIVE account's card metrics.
 *
 * PAID orders only: refunded/disputed/pending revenue is not money earned, so
 * counting it would overstate every card. Aggregated by `product_id`, so
 * orders whose product was deleted (ON DELETE SET NULL) drop out — correct
 * here, since there is no card left to attribute them to.
 *
 * Like the other order readers, this goes through an untyped client (the
 * generated Database types don't include `orders`) and fails soft: an error
 * yields an empty summary and the cards simply render without metrics.
 */
export async function getProductSales(): Promise<ProductSalesSummary> {
  const empty: ProductSalesSummary = { byProduct: {}, bestsellerId: null };
  const account = await getActiveAccount();
  if (!account) return empty;

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select("product_id, amount_cents, currency")
    .eq("seller_id", account.accountId)
    .eq("status", "paid")
    .not("product_id", "is", null)
    .limit(SALES_READ_LIMIT);

  if (error || !data) return empty;

  // CORRECTNESS TRIPWIRE: at the cap this rollup is computed from a truncated
  // window, so unitsSold/revenueCents under-report and the bestseller badge can
  // point at the wrong product. This one is a plain GROUP BY (no bucketing or
  // zero-fill), so it is the cheapest of the three JS rollups to push into SQL:
  //   select product_id, count(*), sum(amount_cents) ... group by product_id
  if (data.length >= SALES_READ_LIMIT) {
    console.warn(
      `[products] hit the ${SALES_READ_LIMIT}-order read cap — per-product sales are computed from a TRUNCATED window and under-report. Move this rollup into SQL.`,
    );
  }

  const byProduct: Record<string, ProductSales> = {};
  for (const row of data as Record<string, unknown>[]) {
    const productId = String(row.product_id);
    const existing = byProduct[productId];
    if (existing) {
      existing.unitsSold += 1;
      existing.revenueCents += Number(row.amount_cents ?? 0);
    } else {
      byProduct[productId] = {
        unitsSold: 1,
        revenueCents: Number(row.amount_cents ?? 0),
        // A product sells in one currency in practice; first order wins.
        currency: toCurrency(String(row.currency ?? "")),
      };
    }
  }

  // Bestseller = most revenue, not most units: a card boasting "bestseller"
  // should point at the product actually earning the most.
  let bestsellerId: string | null = null;
  let bestRevenue = 0;
  for (const [productId, sales] of Object.entries(byProduct)) {
    if (sales.revenueCents > bestRevenue) {
      bestRevenue = sales.revenueCents;
      bestsellerId = productId;
    }
  }

  return { byProduct, bestsellerId };
}

export async function getProduct(id: string): Promise<Product | null> {
  // Guard before querying so a garbage URL param 404s instead of erroring.
  if (!productIdSchema.safeParse(id).success) return null;
  const account = await getActiveAccount();
  if (!account) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? await rowToProduct(data) : null;
}
