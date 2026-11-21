// Why one line of an order (or a cart) cannot be sold as asked. Client-safe,
// so the cart and the checkout can put each reason into words; decided only
// by the quote (lib/checkout/quote.ts assessLines).

export const LINE_PROBLEMS = [
  /** Not for sale here: never placed, a draft, deleted, taken down, sold
   *  through the seller's own link. One reason on purpose: nothing about a
   *  product that is not for sale is enumerable. */
  "not_found",
  /** The storefront tile, or the stock, says there is none to sell. */
  "sold_out",
  /** The version is missing, ambiguous, unknown or unavailable. */
  "options",
  /** Not a whole number in range, or above this product's own limit (counted
   *  over every line of the product). */
  "quantity",
  /** Fewer in stock than asked for. */
  "insufficient_stock",
  /** Priced in another currency than the rest of the order. */
  "currency",
  /** It ships, and the seller has not priced delivery in its currency. */
  "no_shipping_rates",
] as const;

export type LineProblem = (typeof LINE_PROBLEMS)[number];
