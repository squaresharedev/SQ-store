"use server";

import { listProducts } from "@/lib/products/queries";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { PICKER_SEARCH_MAX_LENGTH } from "@/lib/products/picker-constants";
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
 * A read, but a BOUNDED one. `listProducts` enforces the active-account
 * boundary and ILIKE-escapes the term, so this cannot reach another store or
 * corrupt a filter. What it could do unbounded is cost: this is a server
 * action, so it is a public endpoint any session can call in a loop, and each
 * call presigns up to 50 R2 objects. Hence the budget — and the length cap,
 * which stops a caller sending far more pattern than a product title could
 * ever match (titles max at 200 characters).
 */
export async function searchCatalogProducts(search: string): Promise<Product[]> {
  const term = search.trim().slice(0, PICKER_SEARCH_MAX_LENGTH);
  if (!term) return [];
  if (!(await rateLimit("picker_search", RATE_LIMITS.pickerSearch))) {
    // THROW rather than return []. The picker distinguishes "no products match"
    // from "search is unavailable" and says so; an empty array here would show
    // the first message, which is a claim about the catalogue we cannot make.
    throw new Error("Product search is rate limited. Try again shortly.");
  }
  const { rows } = await listProducts({
    filters: { search: term },
    // One picker page: big enough to disambiguate, small enough to presign.
    pageSize: 50,
  });
  return rows;
}
