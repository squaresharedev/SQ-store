// Public stock seam — the ONLY way stock data may exit the server for
// non-owner consumers (embed, marketplace, public storefront API).
//
// Exports:
//   PUBLIC_STOCK_SELECT — the exact column fragment a public payload builder
//     must pass to .select(). Including any other stock column (e.g. raw
//     stock_quantity) in a public select is a policy violation.
//   toPublicStockBadge — maps a raw DB row to a StockBadge (badge state +
//     remaining count when low_stock, nothing else). Raw stock_quantity and
//     low_stock_threshold never leave the server for non-owners.
//
// TODO(public-api): the embed/marketplace payload builder will call
// toPublicStockBadge here when constructing the public product shape. Attach
// the returned badge (or null) to the payload; do not forward any raw stock
// numbers.

import { deriveStockBadge } from "@/lib/stock/badge";
import type { StockBadge } from "@/types/stock";

/**
 * The ONLY stock columns a public payload builder may select. Importing this
 * constant (rather than hand-writing the column list) keeps non-owner payloads
 * aligned with the policy boundary automatically.
 */
export const PUBLIC_STOCK_SELECT =
  "track_stock, stock_quantity, low_stock_threshold" as const;

/** The slice of a product row that toPublicStockBadge accepts. */
type PublicStockRow = {
  track_stock: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number;
};

/**
 * Map a raw DB row to the public badge shape. Returns `null` when the product
 * does not track stock — callers should omit the badge field entirely rather
 * than forwarding null, so buyers never infer tracking status from absence.
 *
 * The low_stock arm is the ONLY arm that carries a count (the remaining
 * quantity). All other arms expose no number — callers must not supplement with
 * raw stock_quantity, even when they have it in scope.
 */
export function toPublicStockBadge(row: PublicStockRow): StockBadge | null {
  return deriveStockBadge({
    trackStock: row.track_stock,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
  });
}
