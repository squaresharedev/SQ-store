import type { Product, ProductRemoval, ProductSales } from "@/types/product";

/**
 * One shop's products, chosen so the grid holds every state a card has to say
 * at once: a bestseller with orders waiting, low stock, sold out, untracked,
 * a draft, a product with no photo and a long name on no storefront, and the
 * three takedown states. Photos are the sample storefront's own.
 */

export type CardFixture = {
  product: Product;
  sales?: ProductSales;
  storefrontCount: number;
  toShip: number;
};

const BASE: Product = {
  id: "",
  title: "",
  description: "",
  price: 0,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 5,
};

function removal(kind: ProductRemoval["kind"]): ProductRemoval {
  return {
    kind,
    automated: kind === "pending",
    reviewRequestedAt: null,
    ground: kind === "pending" ? null : "misleading",
    note: null,
    at: "2026-10-12T10:00:00.000Z",
    fields: [],
    decisionId: null,
  };
}

function product(id: string, fields: Partial<Product>): Product {
  return { ...BASE, id: `${id.padStart(8, "0")}-0000-4000-8000-000000000000`, ...fields };
}

function eur(unitsSold: number, revenueCents: number): ProductSales {
  return { unitsSold, revenueCents, currency: "EUR" };
}

export const CARD_FIXTURES: CardFixture[] = [
  {
    product: product("1", {
      title: "Field Camera 35",
      price: 249,
      imageUrl: "/sample-storefront/camera.webp",
      trackStock: true,
      stockQuantity: 14,
    }),
    sales: eur(38, 946_200),
    storefrontCount: 2,
    toShip: 3,
  },
  {
    product: product("2", {
      title: "Studio Headphones",
      price: 129,
      imageUrl: "/sample-storefront/headphones.webp",
      trackStock: true,
      stockQuantity: 2,
      lowStockThreshold: 5,
    }),
    sales: eur(21, 270_900),
    storefrontCount: 1,
    toShip: 1,
  },
  {
    product: product("3", {
      title: "Analog Watch, White",
      price: 89,
      imageUrl: "/sample-storefront/watch.webp",
      trackStock: true,
      stockQuantity: 0,
    }),
    sales: eur(40, 356_000),
    storefrontCount: 1,
    toShip: 0,
  },
  {
    product: product("4", {
      title: "Desk Succulent",
      price: 18.5,
      imageUrl: "/sample-storefront/succulent.webp",
    }),
    sales: eur(7, 12_950),
    storefrontCount: 1,
    toShip: 0,
  },
  {
    product: product("5", {
      title: "Bluetooth Speaker",
      price: 74,
      status: "draft",
      imageUrl: "/sample-storefront/speaker.webp",
      trackStock: true,
      stockQuantity: 30,
    }),
    storefrontCount: 0,
    toShip: 0,
  },
  {
    product: product("6", {
      title: "Hand-thrown stoneware planter with drainage saucer, large",
      price: 42,
    }),
    storefrontCount: 0,
    toShip: 0,
  },
  {
    product: product("7", {
      title: "Wireless Mouse",
      price: 39,
      imageUrl: "/sample-storefront/mouse.webp",
      trackStock: true,
      stockQuantity: 9,
      removal: removal("paused"),
    }),
    sales: eur(3, 11_700),
    storefrontCount: 1,
    toShip: 0,
  },
  {
    product: product("8", {
      title: "LED Strip Kit",
      price: 24,
      imageUrl: "/empty-state/tile-leds.webp",
      removal: removal("review"),
    }),
    storefrontCount: 1,
    toShip: 0,
  },
  {
    product: product("9", {
      title: "Polarised Sunglasses",
      price: 59,
      imageUrl: "/empty-state/sunglasses.webp",
      removal: removal("removed"),
    }),
    sales: eur(2, 11_800),
    storefrontCount: 1,
    toShip: 0,
  },
];

/** The top earner, the way the list's sales summary picks it. */
export const BESTSELLER_ID = CARD_FIXTURES.reduce<CardFixture | null>(
  (best, f) => (f.sales && (!best?.sales || f.sales.revenueCents > best.sales.revenueCents) ? f : best),
  null,
)?.product.id;
