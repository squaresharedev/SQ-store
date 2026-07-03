import { createClient } from "@/lib/supabase/server";
import { presignGetUrl } from "@/lib/r2";
import type { Tables } from "@/types";
import type { Product } from "@/types/product";
import { productIdSchema } from "@/lib/validation/product";

// Server-side reads for the signed-in seller's products. Server Components /
// Route Handlers only (createClient uses next/headers cookies — never call
// from middleware). RLS already scopes rows to the owner; the explicit
// owner_id filter is defense in depth.

type ProductRow = Tables<"products">;

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
async function rowToProduct(row: ProductRow): Promise<Product> {
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
  };
}

export async function listProducts(ownerId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return Promise.all(data.map(rowToProduct));
}

export async function getProduct(
  id: string,
  ownerId: string,
): Promise<Product | null> {
  // Guard before querying so a garbage URL param 404s instead of erroring.
  if (!productIdSchema.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  return data ? await rowToProduct(data) : null;
}
