import type { CartLineView, CartSuggestion, CartView } from "@/types/cart";
import type { Currency, Product, ProductPageImage, ProductPageProduct } from "@/types/product";
import { CART_SUGGESTIONS_MAX } from "./limits";

// A SAMPLE CART, client-safe: what the storefront designer (and the cart lab)
// shows in the cart before any buyer has filled one, so a seller sees their
// cart FULL, made of their own products. Never priced by the server and never
// sent anywhere: it is a picture of the cart, built in the shape the cart
// routes answer with (types/cart.ts), so the real cart components draw it.

/** What a seller asks to see: a full cart, an empty one, or one with a line
 *  that can no longer be bought (how a problem reads). */
export const SAMPLE_CART_STATES = ["full", "empty", "problem"] as const;
export type SampleCartState = (typeof SAMPLE_CART_STATES)[number];

/** At most this many lines: the product on screen and two more. */
export const SAMPLE_CART_LINES = 3;

/** One of the seller's products, as the sample needs it. */
export type SampleCartProduct = {
  id: string;
  title: string;
  /** What one costs now (a running sale's price). */
  priceCents: number;
  /** The regular price, while a sale lowers it. */
  regularPriceCents?: number | null;
  currency: Currency;
  image: ProductPageImage | null;
};

/** The sample cart's id: never a real cart's (that is a random uuid). */
export const SAMPLE_CART_ID = "00000000-0000-4000-8000-0000000ca127";

/** A price in major units (a catalogue product's) in cents. */
function toCents(price: number): number {
  return Math.round(price * 100);
}

/** One of the designer's catalogue products as a sample line: what one costs
 *  now (a running sale's price), and the regular price while a sale lowers it. */
export function sampleFromProduct(
  product: Pick<Product, "id" | "title" | "price" | "currency" | "imageUrl" | "sale">,
): SampleCartProduct {
  const regular = toCents(product.price);
  return {
    id: product.id,
    title: product.title,
    priceCents: product.sale ? toCents(product.sale.price) : regular,
    regularPriceCents: product.sale ? regular : null,
    currency: product.currency,
    image: product.imageUrl ? { url: product.imageUrl, alt: product.title } : null,
  };
}

/** A product as a page draws it (the page on screen, the add-ons it offers). */
export function sampleFromPageProduct(
  product: Pick<ProductPageProduct, "id" | "title" | "priceCents" | "currency" | "sale" | "images">,
): SampleCartProduct {
  return {
    id: product.id,
    title: product.title,
    priceCents: product.priceCents,
    regularPriceCents: product.sale?.regularPriceCents ?? null,
    currency: product.currency,
    image: product.images[0] ?? null,
  };
}

/**
 * WHAT THE DESIGNER'S SAMPLE CART HOLDS, from the seller's own storefront: the
 * product whose page it opens on, then the board's other products a card puts
 * straight in the cart (no choice to make, sold by our checkout), in board
 * order. "Goes well with" is what the seller picked to go with the product on
 * screen ("Add to your order"), which is what a buyer's cart would offer
 * beside it; with no picks it shows nothing, as a buyer's would.
 */
export function sampleCartProducts(
  onScreen: SampleCartProduct,
  board: readonly (SampleCartProduct & { addable: boolean })[],
  picks: readonly SampleCartProduct[],
): { lines: SampleCartProduct[]; suggestions: SampleCartProduct[] } {
  const others = board.filter(
    (product) => product.addable && product.id !== onScreen.id && product.currency === onScreen.currency,
  );
  const unique = others.filter((product, index) => others.findIndex((other) => other.id === product.id) === index);
  const lines = [onScreen, ...unique.slice(0, SAMPLE_CART_LINES - 1)];
  return { lines, suggestions: picks.filter((pick) => !lines.some((line) => line.id === pick.id)) };
}

/**
 * A cart of the seller's own products: the first is the product on screen,
 * then up to two more in the same currency (the second in twos, so a stepper
 * shows a quantity). "Goes well with" is `suggestions` when given, else what
 * is left over. Delivery is left to the checkout (a sample has no address),
 * and the free-delivery line shows against the seller's own threshold when
 * there is one.
 */
export function sampleCartView(
  products: readonly SampleCartProduct[],
  options: {
    state: SampleCartState;
    suggestions?: readonly SampleCartProduct[];
    freeOverCents?: number | null;
    href?: (productId: string) => string;
  },
): CartView {
  const currency = products[0]?.currency ?? null;
  const same = products.filter((product) => product.currency === currency);
  const picked = options.state === "empty" ? [] : same.slice(0, SAMPLE_CART_LINES);
  const regularOf = (product: SampleCartProduct) =>
    product.regularPriceCents && product.regularPriceCents > product.priceCents ? product.regularPriceCents : null;
  const lines = picked.map((product, index): CartLineView => {
    const quantity = index === 1 ? 2 : 1;
    const problem = options.state === "problem" && index === picked.length - 1 ? ("sold_out" as const) : null;
    return {
      key: product.id,
      productId: product.id,
      optionIds: [],
      quantity,
      title: product.title,
      image: product.image,
      selection: [],
      href: options.href?.(product.id) ?? null,
      unitCents: product.priceCents,
      regularUnitCents: regularOf(product),
      amountCents: problem ? null : product.priceCents * quantity,
      problem,
      maxQuantity: SAMPLE_CART_QUANTITY_MAX,
    };
  });
  const candidates = (options.suggestions ?? same.slice(SAMPLE_CART_LINES)).filter(
    (product) => product.currency === currency && !picked.some((line) => line.id === product.id),
  );
  const suggestions = candidates.slice(0, CART_SUGGESTIONS_MAX).map(
    (product): CartSuggestion => ({
      productId: product.id,
      title: product.title,
      image: product.image,
      unitCents: product.priceCents,
      regularUnitCents: regularOf(product),
      href: options.href?.(product.id) ?? "#",
      quickAdd: { optionIds: [] },
    }),
  );
  const over = options.freeOverCents && options.freeOverCents > 0 ? options.freeOverCents : null;
  return totalled(
    { id: SAMPLE_CART_ID, rev: 0, closed: false, currency, lines, suggestions, delivery: { kind: "atCheckout" } },
    over,
  );
}

/** The most of one line a sample's stepper goes up to. */
export const SAMPLE_CART_QUANTITY_MAX = 10;

/** What a seller did to the sample on the canvas: quantities stepped, lines
 *  removed. Nothing leaves the page. */
export type SampleCartEdits = {
  quantities: Readonly<Record<string, number>>;
  removed: readonly string[];
};

export const NO_SAMPLE_CART_EDITS: SampleCartEdits = { quantities: {}, removed: [] };

/** The sample with the seller's steps applied, its figures worked out again
 *  the way sampleCartView works them out. */
export function withSampleEdits(view: CartView, edits: SampleCartEdits): CartView {
  if (edits === NO_SAMPLE_CART_EDITS) return view;
  const lines = view.lines
    .filter((line) => !edits.removed.includes(line.key))
    .map((line) => {
      const quantity = edits.quantities[line.key] ?? line.quantity;
      return { ...line, quantity, amountCents: line.problem || line.unitCents === null ? null : line.unitCents * quantity };
    });
  return totalled({ ...view, lines }, view.freeDeliveryOverCents);
}

/** A cart's figures from its lines: items, count, the free-delivery gap, and
 *  whether it can be paid. An empty cart has no delivery and offers nothing. */
function totalled(
  view: Pick<CartView, "id" | "rev" | "closed" | "currency" | "lines" | "suggestions" | "delivery">,
  over: number | null,
): CartView {
  const { lines } = view;
  const itemsCents = lines.reduce((total, line) => total + (line.amountCents ?? 0), 0);
  const any = lines.length > 0;
  return {
    id: view.id,
    rev: view.rev,
    closed: view.closed,
    currency: any ? view.currency : null,
    lines,
    count: lines.reduce((total, line) => total + line.quantity, 0),
    itemsCents,
    delivery: any ? view.delivery : { kind: "none" },
    freeDeliveryGapCents: over !== null && any && itemsCents < over ? over - itemsCents : null,
    freeDeliveryOverCents: any ? over : null,
    canCheckout: any && lines.every((line) => line.problem === null),
    suggestions: any ? view.suggestions : [],
  };
}
