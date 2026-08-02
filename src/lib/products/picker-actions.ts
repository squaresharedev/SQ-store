"use server";

import { listProducts } from "@/lib/products/queries";
import type { Product } from "@/types/product";

/**
 * Server-backed search for the storefront designer's product picker.
 *
 * WHY THIS EXISTS. The picker is seeded with `listAllProducts()`, which is
 * bounded (500 newest) because every row costs an R2 presign. For catalogues
 * inside the bound that seed IS the whole store; beyond it, products older
 * than the newest 500 were simply unreachable from the editor: no error, no
 * indicator, a hard dead end. Searching by name goes back to the database, so
 * ANY product can be found and placed regardless of catalogue size.
 *
 * Read-only (classified `read` in server-action-security.test.ts): one paged,
 * account-scoped query via listProducts, which also enforces the active
 * account boundary and escapes the search term for ILIKE.
 */
export async function searchCatalogProducts(search: string): Promise<Product[]> {
  const term = search.trim();
  if (!term) return [];
  const { rows } = await listProducts({
    filters: { search: term },
    // One picker page: big enough to disambiguate, small enough to presign.
    pageSize: 50,
  });
  return rows;
}
