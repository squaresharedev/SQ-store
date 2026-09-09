import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/supabase/ilike";
import { getActiveAccount } from "@/lib/team/account-context";
import { presignGetUrl } from "@/lib/r2";
import { toCurrency } from "@/lib/format/money";
import type { Tables } from "@/types";
import type {
  Product,
  ProductDetail,
  ProductFilters,
  ProductSales,
  ProductSalesSummary,
} from "@/types/product";
import {
  parseDetails,
  parseDocuments,
  parseGallery,
  parseOptionGroups,
} from "@/lib/products/detail";
import type { Paginated } from "@/types/pagination";
import {
  isMetricSort,
  type MetricSort,
  type ProductSort,
} from "@/lib/products/sort";
import { productQuantityCap } from "@/lib/products/quantity";
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
  | "max_per_order"
>;

const PRODUCT_LIST_COLUMNS =
  "id, title, description, price_cents, currency, status, image_key, digital_file_key, track_stock, stock_quantity, low_stock_threshold, max_per_order";

/**
 * The list columns plus the product-page jsonb. Only the single-product read
 * (the edit form) selects these: a gallery costs a presign per photo, and the
 * list has no use for a specification table.
 */
type ProductDetailRow = ProductListRow &
  Pick<
    ProductRow,
    | "gallery"
    | "option_groups"
    | "details"
    | "documents"
    | "purchase_url"
    | "shipping_profile_id"
  >;

const PRODUCT_DETAIL_COLUMNS = `${PRODUCT_LIST_COLUMNS}, gallery, option_groups, details, documents, purchase_url, shipping_profile_id`;

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
    // Corrected into the legal range on the way out, so the form's field and
    // the buyer's picker are bounded by the same function (see quantity.ts).
    maxPerOrder: productQuantityCap(row.max_per_order),
  };
}

/** The owner-side full product: the tile fields plus the page facts, with
 *  every gallery key signed for display in the form. */
async function rowToProductDetail(row: ProductDetailRow): Promise<ProductDetail> {
  const base = await rowToProduct(row);
  const gallery = await Promise.all(
    parseGallery(row.gallery).map(async (image) => ({
      ...image,
      url: await presignGetUrl(image.key),
    })),
  );
  const documents = await Promise.all(
    parseDocuments(row.documents).map(async (document) => ({
      ...document,
      url: await presignGetUrl(document.key),
    })),
  );
  return {
    ...base,
    gallery,
    optionGroups: parseOptionGroups(row.option_groups),
    details: parseDetails(row.details),
    documents,
    purchaseUrl: row.purchase_url,
    shippingProfileId: row.shipping_profile_id,
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

  // Metric sort: ranking lives in SQL (public.products_ranked_by_metric),
  // which orders the WHOLE filtered catalogue by the orders-table rollup and
  // returns one page of ids plus the exact total. The removed JS path read the
  // newest 500 ids and ranked only those, so older products silently fell out
  // of "best sellers" and the total lied at 500.
  const metricSort = sort as MetricSort;
  const search = options?.filters?.search?.trim();
  const { data: rankPayload, error: rankError } = await (
    supabase as SupabaseClient
  ).rpc("products_ranked_by_metric", {
    p_seller_id: account.accountId,
    p_metric: metricSort,
    p_status: options?.filters?.status ?? null,
    // Same escaping as applyProductFilters; the SQL wraps it in %...%.
    p_search: search ? escapeIlike(search) : null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (rankError) {
    throw new Error(`Failed to load products: ${rankError.message}`);
  }
  const ranked = rankPayload as { total: number; ids: string[] };
  const pageIds = ranked.ids;
  if (pageIds.length === 0) {
    return { rows: [], total: ranked.total, page, pageSize };
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
    total: ranked.total,
    page,
    pageSize,
  };
}

/**
 * Per-product sales rollup for the ACTIVE account's card metrics, computed in
 * SQL (public.product_sales_aggregate). PAID orders only: refunded, disputed
 * or pending revenue is not money earned, so counting it would overstate every
 * card. Aggregated by product_id, so orders whose product was deleted
 * (ON DELETE SET NULL) drop out; correct here, since there is no card left to
 * attribute them to. No read cap: the removed JS path aggregated at most
 * 5,000 rows, past which the bestseller badge could point at the wrong
 * product.
 *
 * Fails SOFT (empty summary) by design: cards render fine without metrics,
 * unlike the page-level reads which throw.
 */
export async function getProductSales(): Promise<ProductSalesSummary> {
  const empty: ProductSalesSummary = { byProduct: {}, bestsellerId: null };
  const account = await getActiveAccount();
  if (!account) return empty;

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient).rpc(
    "product_sales_aggregate",
    { p_seller_id: account.accountId },
  );
  if (error || !data) return empty;

  const payload = data as {
    by_product: Record<
      string,
      { units_sold: number; revenue_cents: number; currency: string }
    >;
    bestseller_id: string | null;
  };

  const byProduct: Record<string, ProductSales> = {};
  for (const [productId, sales] of Object.entries(payload.by_product)) {
    byProduct[productId] = {
      unitsSold: sales.units_sold,
      revenueCents: sales.revenue_cents,
      currency: toCurrency(sales.currency),
    };
  }
  return { byProduct, bestsellerId: payload.bestseller_id };
}

/** A single storefront a product is placed on. */
export type StorefrontPlacement = { id: string; name: string };

/**
 * Every storefront (by id and name) that each product appears in, for the
 * ACTIVE account, from a single query over storefront configs.
 *
 * Read alongside the products list (one round trip total) so the delete dialog
 * can name the storefront a product will be orphaned from, and the card can
 * offer copy-link / open affordances tied to the right URL.
 *
 * Deduplicates: a product in two blocks on the same storefront still appears
 * once, so the seller is never told the same storefront name twice.
 *
 * Fails soft: returns {} on any error so product cards render fine without it.
 */
export async function getProductPlacements(): Promise<Record<string, StorefrontPlacement[]>> {
  const account = await getActiveAccount();
  if (!account) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name, config")
    .eq("owner_id", account.accountId);
  if (error) return {};

  const result: Record<string, StorefrontPlacement[]> = {};
  for (const sf of data ?? []) {
    const config = sf.config as Record<string, unknown>;
    const blocks = Array.isArray(config?.blocks) ? config.blocks : [];
    for (const block of blocks) {
      if (
        typeof block !== "object" ||
        block === null ||
        (block as Record<string, unknown>).type !== "product" ||
        typeof (block as Record<string, unknown>).productId !== "string"
      ) {
        continue;
      }
      const productId = (block as Record<string, unknown>).productId as string;
      const list = result[productId] ?? [];
      if (!list.some((s) => s.id === sf.id)) {
        list.push({ id: sf.id, name: sf.name });
      }
      result[productId] = list;
    }
  }
  return result;
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  // Guard before querying so a garbage URL param 404s instead of erroring.
  if (!productIdSchema.safeParse(id).success) return null;
  const account = await getActiveAccount();
  if (!account) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_DETAIL_COLUMNS)
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? await rowToProductDetail(data as ProductDetailRow) : null;
}
