import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { presignGetUrl } from "@/lib/r2";
import { toCurrency } from "@/lib/format/money";
import type { Tables } from "@/types";
import type { Product, ProductSales, ProductSalesSummary } from "@/types/product";
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

export async function listProducts(): Promise<Product[]> {
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
      `[products] hit the ${PRODUCT_LIST_LIMIT}-product read cap — this list is TRUNCATED and the seller cannot see everything they own. Add pagination.`,
    );
  }
  return Promise.all(data.map(rowToProduct));
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
