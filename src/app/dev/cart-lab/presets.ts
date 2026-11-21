// The cart lab's ready-made variations, grouped by idea, each with what it IS
// (never a review) and an honest fit against the brand (docs/styles.md: few
// words, one primary action, the shop's own colours, nothing decorative that
// does not carry information).

import type { LabFit } from "../lab-kit/state";
import type { CartLabState } from "./lab-model";

export type LabPreset = {
  id: string;
  group: string;
  name: string;
  note: string;
  fit: LabFit;
  state: Partial<CartLabState>;
};

export const SHORTLIST_GROUP = "shortlist";

export const LAB_GROUPS = [
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "rows", label: "Line rows" },
  { id: "feedback", label: "Add feedback and icon" },
  { id: "buttons", label: "Page buttons" },
  { id: "delivery", label: "Delivery line" },
  { id: "suggest", label: "Goes well with" },
  { id: "cards", label: "Cards" },
  { id: "reviews", label: "Reviews" },
  { id: "shops", label: "On each shop" },
  { id: "states", label: "Hard states" },
] as const;

export const LAB_PRESETS: readonly LabPreset[] = [
  // Line rows.
  { id: "rows-photo", group: "rows", name: "Photo rows", note: "A 64 px photo beside each line; minus and plus under the title.", fit: "on-brand", state: { rows: "photo" } },
  { id: "rows-compact", group: "rows", name: "Compact rows", note: "A 40 px photo, one tight row per line: more lines in view.", fit: "on-brand", state: { rows: "compact" } },
  { id: "rows-ledger", group: "rows", name: "Receipt", note: "No photos: title, version and amount, like the checkout's compact layout.", fit: "stretch", state: { rows: "ledger" } },
  { id: "rows-select", group: "rows", name: "Quantity list", note: "Quantity chosen from the shop's own list instead of minus and plus.", fit: "stretch", state: { stepper: "select" } },

  // Add feedback and icon.
  { id: "fb-morph-bag", group: "feedback", name: "Bag, says Added", note: "Shopping bag icon; the button reads Added with a check for a moment; the count pops.", fit: "on-brand", state: { icon: "bag", feedback: "morph", bump: true } },
  { id: "fb-cart", group: "feedback", name: "Cart icon", note: "A shopping cart instead of a bag.", fit: "on-brand", state: { icon: "cart" } },
  { id: "fb-basket", group: "feedback", name: "Basket icon", note: "A basket: reads as groceries in most of Europe.", fit: "stretch", state: { icon: "basket" } },
  { id: "fb-dot", group: "feedback", name: "Dot, no number", note: "The cart button shows a dot when something is in it, no number.", fit: "stretch", state: { count: "dot" } },
  { id: "fb-quiet", group: "feedback", name: "Quiet", note: "No morph and no pop: the panel opening is the only answer.", fit: "stretch", state: { feedback: "plain", bump: false } },

  // Page buttons.
  { id: "btn-buy-leads", group: "buttons", name: "Buy now leads", note: "Buy now stays filled; Add to cart outlined under it. Pages look as before.", fit: "on-brand", state: { placement: "buttons", mainButton: "buyNow" } },
  { id: "btn-cart-leads", group: "buttons", name: "Add to cart leads", note: "Add to cart filled; Buy now outlined under it.", fit: "on-brand", state: { placement: "buttons", mainButton: "addToCart" } },
  { id: "btn-note", group: "buttons", name: "Note instead of panel", note: "After adding, a one-line Added note with View cart; the panel stays shut.", fit: "on-brand", state: { placement: "buttons", afterAdd: "note" } },

  // Delivery line.
  { id: "del-bar", group: "delivery", name: "Filling bar", note: "A thin bar in the shop's ink fills toward free delivery.", fit: "on-brand", state: { freeLine: "bar" } },
  { id: "del-text", group: "delivery", name: "Words only", note: "Only the line saying how much more for free delivery.", fit: "on-brand", state: { freeLine: "text" } },
  { id: "del-off", group: "delivery", name: "Off", note: "No free-delivery line (the seller's switch).", fit: "on-brand", state: { deliveryBar: false } },

  // Goes well with.
  { id: "sugg-cards", group: "suggest", name: "Small cards", note: "Up to three of the seller's add-on picks side by side under the lines: photo, name, price, Add or Choose.", fit: "on-brand", state: { suggestions: "cards" } },
  { id: "sugg-list", group: "suggest", name: "A short list", note: "The same picks as rows: a 40 px photo, name and price, a plus or Choose.", fit: "on-brand", state: { suggestions: "list" } },
  { id: "sugg-off", group: "suggest", name: "Off", note: "No suggestions (the seller's switch).", fit: "on-brand", state: { suggest: false } },

  // Cards.
  { id: "cards-add", group: "cards", name: "Cards add to the cart", note: "A product with no version to pick says Add to cart with the cart's icon; one with versions keeps the page's words and arrow.", fit: "on-brand", state: { placement: "cards" } },
  { id: "cards-off", group: "cards", name: "Cards open the page", note: "The seller's Add from cards off: every card opens its page, as before.", fit: "on-brand", state: { placement: "cards", quickAdd: false } },
  { id: "cards-dark", group: "cards", name: "On a dark shop", note: "The same cards on a near-black shop with round corners.", fit: "on-brand", state: { placement: "cards", shop: "dark" } },
  { id: "cards-quiet", group: "cards", name: "No Added word", note: "The card's button keeps its words after a press; only the count answers.", fit: "stretch", state: { placement: "cards", feedback: "plain" } },

  // Reviews.
  { id: "rev-many", group: "reviews", name: "Three products", note: "A cart's order: a row of the products picks which one the stars are for; one reviewed already carries a tick.", fit: "on-brand", state: { placement: "reviews" } },
  { id: "rev-dark", group: "reviews", name: "On a dark shop", note: "The same picker in a dark shop's ink.", fit: "on-brand", state: { placement: "reviews", shop: "dark" } },

  // On each shop.
  { id: "shop-light", group: "shops", name: "Light shop", note: "White shop, ink button, sharp corners.", fit: "on-brand", state: { shop: "light" } },
  { id: "shop-clay", group: "shops", name: "Warm shop", note: "Cream shop, green button, soft corners.", fit: "on-brand", state: { shop: "clay" } },
  { id: "shop-dark", group: "shops", name: "Dark shop", note: "Near-black shop, coral button, round corners: the panel turns dark with it.", fit: "on-brand", state: { shop: "dark" } },
  { id: "shop-page", group: "shops", name: "Cart page", note: "The cart as its own page (where the embed sends buyers).", fit: "on-brand", state: { placement: "page" } },
  { id: "shop-header", group: "shops", name: "Cart button", note: "The cart button in a shop header, with its count.", fit: "on-brand", state: { placement: "header" } },

  // Hard states.
  { id: "st-problems", group: "states", name: "Problem lines", note: "Sold out, not enough in stock, and a product no longer sold: each says so on its line; checkout waits.", fit: "on-brand", state: { scenario: "problems" } },
  { id: "st-free", group: "states", name: "Free delivery reached", note: "Delivery reads Free; the free-delivery line goes.", fit: "on-brand", state: { scenario: "free" } },
  { id: "st-checkout", group: "states", name: "Delivery at checkout", note: "The buyer's country is not known: delivery waits for the address.", fit: "on-brand", state: { scenario: "checkout" } },
  { id: "st-one", group: "states", name: "One line", note: "A single line.", fit: "on-brand", state: { scenario: "one" } },
  { id: "st-empty", group: "states", name: "Empty", note: "Nothing in the cart: the icon, one line and Keep shopping.", fit: "on-brand", state: { scenario: "empty" } },
];

/** The ranked shortlist: best first, each with why. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  { id: "rows-photo", why: "Shows what is in the cart at a glance; the shop's photos carry it, not decoration." },
  { id: "btn-buy-leads", why: "Every existing page keeps its look at launch; the cart arrives as a second, quieter choice." },
  { id: "del-bar", why: "The commonest reason carts are abandoned is cost: the bar shows delivery before checkout." },
  { id: "fb-morph-bag", why: "Says Added where the buyer pressed, then the count confirms it in the header." },
  { id: "st-problems", why: "Proves problems read plainly on the line, never as a silent removal." },
  { id: "shop-dark", why: "Proves the panel takes a dark shop's ink rather than a white card punched into it." },
  { id: "rows-compact", why: "For shops whose buyers fill big carts: more lines in view." },
  { id: "btn-note", why: "For shops that want buyers to keep browsing: no panel over the page." },
  { id: "cards-add", why: "Two taps fewer for the commonest case: a product with nothing to choose goes in from the board." },
  { id: "sugg-cards", why: "Only the seller's own add-on picks, shown with photos where the buyer is already deciding." },
  { id: "rev-many", why: "A cart's buyer reviews every product, one question at a time, without a wall of star rows." },
];
