// THE CART'S LOOK: every visual choice the cart makes that is the PLATFORM's
// (the seller's own choices are CartPageConfig, types/storefront.ts). One
// place, read by every cart component and tuned in /dev/cart-lab, so a look
// change is one edit here. Colours, corners and the buttons' paint are never
// in here: the cart wears the page it opens over (ink, corners, the buy
// button), through the product page's own resolvers.

/** The cart button's drawing (lucide's ShoppingBag / ShoppingCart / ShoppingBasket). */
export const CART_ICONS = ["bag", "cart", "basket"] as const;
export type CartIconName = (typeof CART_ICONS)[number];

/** How the cart button says what is in it: the number, or a dot. */
export const CART_COUNT_STYLES = ["number", "dot"] as const;
export type CartCountStyle = (typeof CART_COUNT_STYLES)[number];

/** One line in the cart: a photo-led row, a compact one-liner, or a receipt
 *  line without a photo. */
export const CART_ROW_STYLES = ["photo", "compact", "ledger"] as const;
export type CartRowStyle = (typeof CART_ROW_STYLES)[number];

/** How a line's quantity is changed: minus and plus, or a list. */
export const CART_STEPPERS = ["buttons", "select"] as const;
export type CartStepper = (typeof CART_STEPPERS)[number];

/** How "X more for free delivery" is drawn: a filling bar, or the line alone. */
export const CART_FREE_LINES = ["bar", "text"] as const;
export type CartFreeLine = (typeof CART_FREE_LINES)[number];

/** What the "Add to cart" button does when pressed: say "Added" with a check
 *  in place for a moment, or stay as it is. */
export const CART_ADD_FEEDBACK = ["morph", "plain"] as const;
export type CartAddFeedback = (typeof CART_ADD_FEEDBACK)[number];

/** How "Goes well with" is drawn: small cards side by side, or a list. */
export const CART_SUGGESTION_STYLES = ["cards", "list"] as const;
export type CartSuggestionStyle = (typeof CART_SUGGESTION_STYLES)[number];

export type CartLook = {
  icon: CartIconName;
  count: CartCountStyle;
  rows: CartRowStyle;
  stepper: CartStepper;
  freeLine: CartFreeLine;
  feedback: CartAddFeedback;
  /** The cart button's count jumps once when something goes in. */
  bump: boolean;
  suggestions: CartSuggestionStyle;
};

/** The look that ships. PROVISIONAL until picked in /dev/cart-lab. */
export const CART_LOOK: CartLook = {
  icon: "bag",
  count: "number",
  rows: "photo",
  stepper: "buttons",
  freeLine: "bar",
  feedback: "morph",
  bump: true,
  suggestions: "cards",
};

/** How long "Added" stays on the button before it reads "Add to cart" again. */
export const CART_ADDED_MS = 1800;

/** How long a removed line's Undo stays offered. */
export const CART_UNDO_MS = 5000;
