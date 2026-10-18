import type { WeekdayProduct, WeekdaySlice } from "@/lib/analytics/types";

// WHICH PRODUCTS SOLD ON WHICH DAY OF THE WEEK.
//
// The weekday card's bars are stacks: each day's sales, split by product. The
// split comes from its own aggregate (public.analytics_weekday_products, see
// supabase/migrations/20261007_analytics_weekday_products.sql), separate from
// the one that feeds the rest of the page, so this is where the two are put
// together, and where a missing or failed split turns back into plain bars
// instead of into a wrong chart.

/** Shape of the jsonb payload analytics_weekday_products returns. */
export type WeekdayProductsPayload = {
  /** The named products, best seller first. */
  products: { title: string | null; sales: number }[];
  /** One row per weekday and product. A null title is every product outside
   *  the named few, already summed. */
  weekdays: { isodow: number; title: string | null; sales: number }[];
};

/** What a product with no title on its order is called in the payload's own
 *  terms: an empty string, so it can never be mistaken for "the rest" (null). */
const UNTITLED = "";

/**
 * Lay the split onto the seven weekday slices.
 *
 * Returns the slices untouched (every `products` empty) and no names when
 * there is nothing to lay on: no payload, or one that does not add up to the
 * totals it is meant to split. The second case is not paranoia. The two
 * aggregates are separate reads of a table that takes orders in between, and a
 * stack that is one sale taller than the bar it replaced, on a card whose
 * neighbours all say otherwise, is worse than no stack.
 */
export function withWeekdayProducts(
  weekdays: WeekdaySlice[],
  payload: WeekdayProductsPayload | null,
): { weekdays: WeekdaySlice[]; products: string[] } {
  const plain = { weekdays: weekdays.map((slice) => ({ ...slice, products: [] })), products: [] };
  if (!payload || payload.products.length === 0) return plain;

  const names = payload.products.map((product) => product.title ?? UNTITLED);
  const split = weekdays.map((): WeekdayProduct[] => []);
  for (const row of payload.weekdays) {
    // ISO dow 1..7 -> Mon-first index 0..6, as buildWeekdays does.
    const day = split[(row.isodow + 6) % 7];
    if (!day || !(row.sales > 0)) continue;
    // A null title is "the rest" only when it is not one of the named
    // products; a named product whose own title is null was renamed to "".
    const named = payload.products.some((product) => product.title === row.title);
    day.push({ title: named ? (row.title ?? UNTITLED) : null, sales: row.sales });
  }

  const adds = weekdays.every(
    (slice, index) => split[index].reduce((sum, part) => sum + part.sales, 0) === slice.sales,
  );
  if (!adds) return plain;

  return {
    weekdays: weekdays.map((slice, index) => ({
      ...slice,
      // Named products in rank order, then the rest.
      products: [...split[index]].sort((a, b) => rank(names, a.title) - rank(names, b.title)),
    })),
    products: names,
  };
}

function rank(names: string[], title: string | null): number {
  return title === null ? names.length : names.indexOf(title);
}
