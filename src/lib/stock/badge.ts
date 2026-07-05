import type { StockBadge } from "@/types/stock";

// Badge derivation — the ONLY place stock numbers become a public badge.
// Pure and client-safe (no server imports), but ALWAYS fed from
// server-authoritative rows: the client never supplies the inputs.

/** The slice of a product needed to derive its badge (camelCase Product or a
 *  raw DB row mapped by the caller). */
export type StockFields = {
  trackStock: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number;
};

/**
 * Derive the public badge for a product. `null` = no badge (not tracking).
 * The low_stock arm is the only one that carries a count — and only the
 * remaining count, never the full inventory picture (threshold stays private).
 */
export function deriveStockBadge(fields: StockFields): StockBadge | null {
  if (!fields.trackStock || fields.stockQuantity === null) return null;
  if (fields.stockQuantity <= 0) return { state: "sold_out" };
  if (fields.stockQuantity <= fields.lowStockThreshold) {
    return { state: "low_stock", remaining: fields.stockQuantity };
  }
  return { state: "in_stock" };
}
