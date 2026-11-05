// SERVER ONLY. Which reviews in an import file a store already has.
//
// Imported reviews are known by their fingerprint (lib/reviews/import.ts
// reviewFingerprint), stored as external_id. Asked by the import page before
// anything is sent, so the seller sees "already here" up front, and by the
// import route before it writes, so a review imported under one app and again
// under another still lands once.
//
// This app's own export is known by review id instead (reviewsInStore).

import { createAdminClient } from "@/lib/supabase/admin";

/** Ids per read: 64 characters each keeps the request URL short. */
const IDS_PER_READ = 150;
/** Reads in flight at once. */
const READS_AT_ONCE = 4;

/** Every row one store has under `ids`, read in chunks. Null when a read failed. */
async function readByIds(
  sellerId: string,
  ids: readonly string[],
  column: "id" | "external_id",
): Promise<{ id: string; product_id: string; external_id: string | null }[] | null> {
  const admin = createAdminClient();
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += IDS_PER_READ) chunks.push(unique.slice(start, start + IDS_PER_READ));

  const found: { id: string; product_id: string; external_id: string | null }[] = [];
  for (let start = 0; start < chunks.length; start += READS_AT_ONCE) {
    const results = await Promise.all(
      chunks.slice(start, start + READS_AT_ONCE).map((chunk) =>
        admin.from("reviews").select("id, product_id, external_id").eq("seller_id", sellerId).in(column, chunk),
      ),
    );
    for (const { data, error } of results) {
      if (error) {
        console.error("[review-import] existing read failed", error.message);
        return null;
      }
      found.push(...data);
    }
  }
  return found;
}

/**
 * For each of `ids` the store has a review under, the products it is on.
 * Null when a read failed: the caller cannot say what is already here.
 */
export async function importedReviewProducts(
  sellerId: string,
  ids: readonly string[],
): Promise<Map<string, Set<string>> | null> {
  const rows = await readByIds(sellerId, ids, "external_id");
  if (!rows) return null;
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.external_id) continue;
    const products = found.get(row.external_id) ?? new Set<string>();
    products.add(row.product_id);
    found.set(row.external_id, products);
  }
  return found;
}

/**
 * Which of `reviewIds` are this store's own. Another store's id reads the same
 * as one that does not exist, so a file reveals nothing about anyone else's
 * reviews. Null when a read failed.
 */
export async function reviewsInStore(sellerId: string, reviewIds: readonly string[]): Promise<Set<string> | null> {
  const rows = await readByIds(sellerId, reviewIds, "id");
  return rows && new Set(rows.map((row) => row.id));
}
