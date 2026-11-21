// SERVER ONLY. WHETHER A CARD CAN PUT ITS PRODUCT STRAIGHT IN THE CART: the
// product needs no choice (every option group has exactly one option, or it
// has none), and the checkout's own rules would sell one of it from here
// right now. Asked by the buyer's boards (hosted and embedded) and the
// designer, so a card never offers "Add to cart" for something the cart would
// refuse, and the designer shows exactly what a buyer will see.
//
// THE QUOTE DECIDES. This builds a one-line gate and asks assessLines
// (lib/checkout/quote.ts): the seller's own purchase link, the tile's sold-out
// mark, an exact version, delivery that can be priced in the product's
// currency, the shelf and the per-order limit. No second copy of those rules.

import { assessLines } from "@/lib/checkout/quote";
import { parseOptionGroups } from "@/lib/products/detail";
import type { PublicProductRow, PurchasableStore } from "@/lib/products/purchasable";
import type { ProductBlock } from "@/types/storefront";

/** The columns a board reads, beyond a tile's own, to answer this. */
export const QUICK_ADD_SELECT = "purchase_url, option_groups, digital_file_key, max_per_order" as const;

/** Every column assessLines reads of a product row for one line of one. */
export type QuickAddRow = Pick<
  PublicProductRow,
  | "id"
  | "price_cents"
  | "currency"
  | "purchase_url"
  | "option_groups"
  | "digital_file_key"
  | "max_per_order"
  | "track_stock"
  | "stock_quantity"
>;

/** What a card hands the cart: the version of a product with no choice. */
export type QuickAdd = { optionIds: string[] };

/**
 * The version a card adds (each group's one option, or none), or null when
 * the card must open the product's page instead: a choice to make, or a line
 * the checkout would refuse. `block` is the tile (its sold-out mark); null
 * where there is none (the designer's list).
 */
export function quickAddFor(
  row: QuickAddRow,
  block: Pick<ProductBlock, "soldOut"> | null,
  store: Pick<PurchasableStore, "shippingPolicy">,
): QuickAdd | null {
  const groups = parseOptionGroups(row.option_groups);
  if (!groups.every((group) => group.options.length === 1)) return null;
  const optionIds = groups.map((group) => group.options[0]!.id);
  const [verdict] = assessLines(
    {
      // The one storefront fact a single line asks: whether delivery can be
      // priced. assessLines reads nothing else of the store for one line.
      store: store as PurchasableStore,
      // QuickAddRow is every column assessLines reads of a row; the sales and
      // the rest of the row belong to pricing, which this does not do.
      items: new Map([[row.id, { block: block as ProductBlock | null, row: row as PublicProductRow, sales: [] }]]),
    },
    [{ productId: row.id, optionIds, quantity: 1, source: "cart" }],
  );
  return verdict?.ok ? { optionIds } : null;
}
