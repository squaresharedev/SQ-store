import type { OrderLineSource } from "@/lib/checkout/lines";
import type { LineProblem } from "@/lib/checkout/line-problem";
import type { Currency, ProductPageImage } from "@/types/product";

// THE CART, as a buyer's browser sees it. Client-safe types only: the cart
// routes (app/api/cart) build these field by field (lib/cart/view.ts), so
// nothing here is a key, an owner id, a stock count or a price the server did
// not just work out.

/** One line as the cart stores it: a request, never a price. */
export type CartLine = {
  productId: string;
  /** The version: one option id per option group. */
  optionIds: string[];
  quantity: number;
  source: OrderLineSource;
  /** When it went in, ISO. Lines are shown oldest first. */
  addedAt: string;
};

/** What the browser keeps about a cart between visits: its id (the only key
 *  to it), how many items it holds (for the count on the cart button before
 *  anything is fetched) and its revision (another tab changed it when this
 *  moves). */
export type CartHandle = { id: string; rev: number; count: number };

/** Delivery, as the cart can tell it before the checkout knows where to. */
export type CartDelivery =
  /** Nothing in the cart ships. */
  | { kind: "none" }
  /** Free to the country the buyer is probably in. */
  | { kind: "free"; area: string }
  /** What it costs to that country. */
  | { kind: "cost"; cents: number; area: string }
  /** Depends on where it goes: the checkout asks. */
  | { kind: "atCheckout" };

/** One line as the cart shows it. */
export type CartLineView = {
  /** The line's identity in the cart (lib/checkout/lines.ts lineKey). */
  key: string;
  productId: string;
  optionIds: string[];
  quantity: number;
  /** Null when the product can no longer be sold here (it may be gone). */
  title: string | null;
  image: ProductPageImage | null;
  /** The version, in the seller's words. */
  selection: { label: string; value: string }[];
  /** The product's page on this storefront, when it has one. */
  href: string | null;
  /** One item's price now (its sale's while one runs), and the regular price
   *  beside it while a sale lowers it. Null for a line that cannot be sold. */
  unitCents: number | null;
  regularUnitCents: number | null;
  /** What the line costs (unitCents x quantity). */
  amountCents: number | null;
  /** Why it cannot be bought as it stands, or null. */
  problem: LineProblem | null;
  /** The most the quantity stepper may offer: the PUBLIC limit, never a
   *  hidden stock count (lib/products/quantity.ts publicQuantityLimit). */
  maxQuantity: number;
};

/** "Goes well with": a product the seller picked for "Add to your order" on
 *  something in the cart, as the cart offers it. */
export type CartSuggestion = {
  productId: string;
  title: string;
  image: ProductPageImage | null;
  /** One item's price now (its sale's while one runs), and the regular price
   *  beside it while a sale lowers it. */
  unitCents: number;
  regularUnitCents: number | null;
  /** Its page on this storefront: where a product with versions is chosen. */
  href: string;
  /** The version a press puts straight in the cart, when it needs no choice
   *  (lib/cart/quick-add.ts). Null: "Choose" opens its page. */
  quickAdd: { optionIds: string[] } | null;
};

export type CartView = {
  id: string;
  rev: number;
  /** Paid: a closed cart takes no more lines (the browser starts a new one). */
  closed: boolean;
  /** Null for an empty cart. */
  currency: Currency | null;
  lines: CartLineView[];
  /** Items in the cart, quantities summed. */
  count: number;
  /** What the lines that can be bought cost now, before delivery and before
   *  any code (codes are typed at the checkout). */
  itemsCents: number;
  delivery: CartDelivery;
  /** "€12 more for free delivery", when the seller has a threshold and the
   *  posted items are under it. */
  freeDeliveryGapCents: number | null;
  /** The threshold itself, for the progress line. */
  freeDeliveryOverCents: number | null;
  /** Every line can be bought as it stands, and there is at least one. */
  canCheckout: boolean;
  /** "Goes well with" (lib/cart/suggestions.ts): empty when the seller has it
   *  off, or nothing in the cart has a pick that is not in it already. */
  suggestions: CartSuggestion[];
};

/** Why the cart refused a change. */
export type CartRefusal =
  /** The line cannot be sold here as asked (its own reason). */
  | LineProblem
  /** CART_LINES_MAX lines already. */
  | "full"
  /** No cart here right now: switched off, no checkout, or not this store's. */
  | "unavailable"
  /** The cart named is gone (expired, paid and swept, or never existed): the
   *  browser forgets it and starts afresh. */
  | "gone"
  | "invalid"
  | "rate_limited";

export type CartResponse =
  | { ok: true; cart: CartView }
  | { ok: false; error: CartRefusal; cart?: CartView };
