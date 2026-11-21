// ORDER LINES, client-safe: what one line of an order (or a cart) asks for.
// A line is a product in one version, so the same product in two versions is
// two lines. Requests only: the quote (lib/checkout/quote.ts) re-reads every
// fact that sets a price.

/** Where a line came from, kept on the order for the seller's numbers. Never
 *  authority: the quote and the price ignore it. "add_on" = taken from a
 *  product page's "Add to your order"; "cart" = put in the cart. The first
 *  line of an order sits on the orders row, which has no source. */
export const ORDER_LINE_SOURCES = ["cart", "add_on"] as const;
export type OrderLineSource = (typeof ORDER_LINE_SOURCES)[number];

/** One line as a checkout or cart asks for it. */
export type OrderLineRequest = {
  productId: string;
  /** The version: one option id per option group. */
  optionIds: readonly string[];
  quantity: number;
  source: OrderLineSource;
};

/** Two lines are the same line when they name the same product in the same
 *  version, whatever order the option ids came in. The cart merges by it. */
export function lineKey(line: { productId: string; optionIds: readonly string[] }): string {
  return [line.productId, ...[...line.optionIds].sort()].join(".");
}
