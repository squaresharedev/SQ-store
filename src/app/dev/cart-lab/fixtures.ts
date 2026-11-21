// The cart lab's fixed data: three shops and the carts worth looking at. No
// account and no database: every cart is a CartView as lib/cart/view.ts would
// build it, with the sample storefront's own photos.

import { resolveCta, resolveInk, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG, type StorefrontTheme } from "@/types/storefront";
import type { CartLineView, CartSuggestion, CartView } from "@/types/cart";

export const LAB_STOREFRONT_ID = "5a000000-0000-4000-8000-00000000ca27";

/** A shop the cart is drawn in: its backdrop, ink, corners and buy button. */
export type LabShop = {
  id: string;
  label: string;
  background: string;
  accent: string;
  ink: string;
  cornerRadius: number;
  cta: CtaAppearance;
};

function shop(id: string, label: string, background: string, accent: string, cornerRadius: number): LabShop {
  const theme: StorefrontTheme = {
    ...DEFAULT_STOREFRONT_CONFIG.theme,
    background: { kind: "solid", color: background },
    accent,
    cornerRadius,
  };
  return {
    id,
    label,
    background,
    accent,
    ink: resolveInk(theme),
    cornerRadius,
    cta: resolveCta(DEFAULT_PRODUCT_PAGE_CONFIG, theme),
  };
}

export const LAB_SHOPS = [
  shop("light", "Light shop, ink button, sharp", "#ffffff", "#171717", 0),
  shop("clay", "Warm shop, green button, soft corners", "#f6f1e7", "#1f4d3a", 12),
  shop("dark", "Dark shop, coral button, round", "#141414", "#ff6b4a", 20),
] as const;
export type LabShopId = (typeof LAB_SHOPS)[number]["id"];

const id = (n: number) => `5a000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function line(
  n: number,
  title: string,
  photo: string,
  unitCents: number,
  quantity: number,
  extra: Partial<CartLineView> = {},
): CartLineView {
  return {
    key: id(n),
    productId: id(n),
    optionIds: [],
    quantity,
    title,
    image: { url: `/sample-storefront/${photo}.webp`, alt: title },
    selection: [],
    href: "#",
    unitCents,
    regularUnitCents: null,
    amountCents: unitCents * quantity,
    problem: null,
    maxQuantity: 10,
    ...extra,
  };
}

const LINES = {
  speaker: line(1, "Walnut speaker", "speaker", 8900, 1, {
    selection: [{ label: "Finish", value: "Walnut" }],
  }),
  headphones: line(2, "Studio headphones", "headphones", 5600, 2, {
    regularUnitCents: 7000,
    selection: [
      { label: "Colour", value: "Sand" },
      { label: "Cable", value: "1.2 m" },
    ],
  }),
  succulent: line(3, "Potted succulent", "succulent", 1400, 1),
  watch: line(4, "Field watch", "watch", 12900, 1, { problem: "sold_out", amountCents: null }),
  camera: line(5, "Instant camera", "camera", 9900, 3, { problem: "insufficient_stock", amountCents: null }),
  gone: { ...line(6, "", "mouse", 0, 1), title: null, image: null, href: null, unitCents: null, amountCents: null, problem: "not_found" as const },
};

function suggestion(n: number, title: string, photo: string, unitCents: number, quick: boolean): CartSuggestion {
  return {
    productId: id(n),
    title,
    image: { url: `/sample-storefront/${photo}.webp`, alt: title },
    unitCents,
    regularUnitCents: null,
    href: "#",
    quickAdd: quick ? { optionIds: [] } : null,
  };
}

/** "Goes well with": one in a press, one with versions to choose, one on sale. */
const SUGGESTIONS: CartSuggestion[] = [
  suggestion(7, "Wireless mouse", "mouse", 3900, true),
  suggestion(8, "Field watch", "watch", 12900, false),
  { ...suggestion(9, "Instant camera", "camera", 7900, true), regularUnitCents: 9900 },
];

function cart(lines: CartLineView[], extra: Partial<CartView> = {}): CartView {
  const sellable = lines.filter((entry) => entry.problem === null);
  const items = sellable.reduce((total, entry) => total + (entry.amountCents ?? 0), 0);
  return {
    id: id(99),
    rev: 1,
    closed: false,
    currency: lines.length > 0 ? "EUR" : null,
    lines,
    count: lines.reduce((total, entry) => total + entry.quantity, 0),
    itemsCents: items,
    delivery: lines.length > 0 ? { kind: "cost", cents: 450, area: "Ireland" } : { kind: "none" },
    freeDeliveryGapCents: items < 25000 && lines.length > 0 ? 25000 - items : null,
    freeDeliveryOverCents: lines.length > 0 ? 25000 : null,
    canCheckout: lines.length > 0 && lines.every((entry) => entry.problem === null),
    suggestions: lines.length > 0 ? SUGGESTIONS : [],
    ...extra,
  };
}

/** The carts worth looking at, by name. */
export const LAB_SCENARIOS = {
  three: { label: "Three lines, one on sale", view: cart([LINES.speaker, LINES.headphones, LINES.succulent]) },
  one: { label: "One line", view: cart([LINES.succulent], { suggestions: SUGGESTIONS.slice(0, 1) }) },
  problems: {
    label: "Lines with problems",
    view: cart([LINES.speaker, LINES.watch, LINES.camera, LINES.gone]),
  },
  free: {
    label: "Free delivery reached",
    view: cart([{ ...LINES.speaker, quantity: 2, amountCents: 17800 }, LINES.headphones], {
      delivery: { kind: "free", area: "Ireland" },
      freeDeliveryGapCents: null,
    }),
  },
  checkout: { label: "Delivery set at checkout", view: cart([LINES.headphones], { delivery: { kind: "atCheckout" } }) },
  empty: { label: "Empty", view: cart([]) },
} as const;
export type LabScenarioId = keyof typeof LAB_SCENARIOS;
