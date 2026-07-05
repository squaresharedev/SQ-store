// The stock feature contract. Derivation lives in lib/stock (server-side);
// this file only defines the shapes both sides build against.

/**
 * Public badge states, derived SERVER-SIDE from stock_quantity vs
 * low_stock_threshold. Extensible: add future states (e.g. "selling_fast")
 * here and every consumer type-checks its handling.
 */
export const STOCK_BADGE_STATES = ["in_stock", "low_stock", "sold_out"] as const;
export type StockBadgeState = (typeof STOCK_BADGE_STATES)[number];

/**
 * What buyers may see about a product's stock — and NOTHING more. A product
 * that does not track stock has no badge (null upstream, component renders
 * nothing). `remaining` exists ONLY in the low_stock arm (for "Only N left");
 * the discriminated union makes leaking a raw count in any other state a type
 * error.
 */
export type StockBadge =
  | { state: "in_stock" }
  | { state: "low_stock"; remaining: number }
  | { state: "sold_out" };
