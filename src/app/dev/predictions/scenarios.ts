import type { CarrierId } from "@/types/order-view";
import type { Currency } from "@/types/product";

// Made-up store histories for the predictions lab. Each is what one kind of
// seller's store holds, newest first, so a scenario button shows what the app
// would offer that seller. Edit freely: nothing here reaches a database.

/** One recent product, as the lab's table edits it. */
export type LabProduct = {
  title: string;
  currency: Currency;
  /** "" is the store's own shipping terms. */
  profile: "" | "bulky";
  unit: "cm" | "in";
  lowStock: number;
  maxPerOrder: number;
  /** "Size: S, M, L | Colour: Sand, Navy". */
  options: string;
  materials: string;
  origin: string;
  maker: boolean;
  /** "Handmade, Made in Porto". */
  badges: string;
};

export type LabDiscount = { percent: number; days: number; channel: string };
export type LabShipment = { carrier: CarrierId; country: string };
export type LabStock = { title: string; stock: number; lowStock: number; sold: number };
/** One paid order: who bought, and its products (main first, then add-ons). */
export type LabOrder = { buyer: string; products: string };
/** One product and what its "Add to your order" offers, as "Gift box, Card". */
export type LabOffer = { title: string; addOns: string };
export type LabPlaceable = { title: string; sold: number; touchedDaysAgo: number; status: "active" | "draft"; soldOut: boolean };

export type Scenario = {
  name: string;
  about: string;
  businessCountry: string;
  products: LabProduct[];
  discounts: LabDiscount[];
  shipments: LabShipment[];
  stock: LabStock[];
  catalogue: LabPlaceable[];
  orders: LabOrder[];
  offers: LabOffer[];
  /** Other storefronts' embed domains, newest edited first. */
  domains: string;
};

const product = (title: string, overrides: Partial<LabProduct> = {}): LabProduct => ({
  title,
  currency: "EUR",
  profile: "",
  unit: "cm",
  lowStock: 5,
  maxPerOrder: 10,
  options: "",
  materials: "",
  origin: "",
  maker: false,
  badges: "",
  ...overrides,
});

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "New seller",
    about: "Nothing in the store yet: every screen behaves as if predictions did not exist.",
    businessCountry: "",
    products: [],
    discounts: [],
    shipments: [],
    stock: [],
    catalogue: [],
    orders: [],
    offers: [],
    domains: "",
  },
  {
    name: "Clothing shop",
    about: "Linen and cotton, sized XS to XL, An Post at home and GLS abroad.",
    businessCountry: "IE",
    products: [
      product("Linen shirt", {
        options: "Size: XS, S, M, L, XL | Colour: Sand, Navy",
        materials: "100% linen",
        origin: "Portugal",
        maker: true,
        badges: "Handmade, Made in Porto",
      }),
      product("Cotton tee", { options: "Size: S, M, L", materials: "Organic cotton", badges: "Handmade" }),
      product("Wool scarf", { materials: "Merino wool" }),
    ],
    discounts: [
      { percent: 20, days: 7, channel: "Instagram" },
      { percent: 20, days: 7, channel: "Newsletter" },
      { percent: 15, days: 0, channel: "Instagram" },
    ],
    shipments: [
      { carrier: "an-post", country: "IE" },
      { carrier: "gls", country: "FR" },
      { carrier: "an-post", country: "IE" },
      { carrier: "gls", country: "DE" },
    ],
    stock: [
      { title: "Linen shirt", stock: 3, lowStock: 5, sold: 20 },
      { title: "Wool scarf (last batch)", stock: 4, lowStock: 0, sold: 40 },
      { title: "Cotton tee", stock: 50, lowStock: 5, sold: 10 },
    ],
    catalogue: [
      { title: "Old hoodie", sold: 0, touchedDaysAgo: 30, status: "draft", soldOut: false },
      { title: "Linen shirt", sold: 12, touchedDaysAgo: 2, status: "active", soldOut: false },
      { title: "Cotton tee", sold: 30, touchedDaysAgo: 20, status: "active", soldOut: false },
    ],
    orders: [
      { buyer: "ana@example.com", products: "Linen shirt, Wool scarf" },
      { buyer: "ben@example.com", products: "Wool scarf" },
      { buyer: "ben@example.com", products: "Linen shirt" },
      { buyer: "cat@example.com", products: "Cotton tee, Wool scarf" },
      { buyer: "dan@example.com", products: "Linen shirt" },
    ],
    offers: [
      { title: "Linen shirt", addOns: "" },
      { title: "Cotton tee", addOns: "Gift box" },
      { title: "Wool scarf", addOns: "Gift box" },
      { title: "Gift box", addOns: "" },
    ],
    domains: "Main shop: linenhouse.example, www.linenhouse.example",
  },
  {
    name: "Ceramics studio",
    about: "Bulky parcels, a maker on every piece, sold by capacity.",
    businessCountry: "PT",
    products: [
      product("Glaze kit", { profile: "bulky", materials: "Stoneware glaze", origin: "Portugal", maker: true, badges: "Handmade" }),
      product("Bowl", { profile: "bulky", materials: "Stoneware", origin: "Portugal", maker: true, badges: "Handmade" }),
      product("Mug", { profile: "bulky", options: "Capacity: 250 ml, 350 ml", maker: true }),
    ],
    discounts: [{ percent: 10, days: 3, channel: "Pinterest" }],
    shipments: [{ carrier: "ctt", country: "PT" }],
    stock: [{ title: "Mug", stock: 6, lowStock: 5, sold: 30 }],
    catalogue: [
      { title: "Glaze kit", sold: 4, touchedDaysAgo: 9, status: "active", soldOut: true },
      { title: "Bowl", sold: 18, touchedDaysAgo: 12, status: "active", soldOut: false },
      { title: "Mug", sold: 40, touchedDaysAgo: 15, status: "active", soldOut: false },
    ],
    orders: [
      { buyer: "eva@example.com", products: "Mug, Coasters" },
      { buyer: "finn@example.com", products: "Mug, Coasters, Bowl" },
      { buyer: "gus@example.com", products: "Bowl" },
    ],
    offers: [
      { title: "Mug", addOns: "" },
      { title: "Bowl", addOns: "Mug" },
      { title: "Coasters", addOns: "" },
    ],
    domains: "",
  },
  {
    name: "Moving to dollars",
    about: "Two dollar products after a euro one: currency follows the majority of the newest three.",
    businessCountry: "US",
    products: [
      product("Art print A3", { currency: "USD", options: "Size: A4, A3" }),
      product("Art print A4", { currency: "USD" }),
      product("Postcard set", { currency: "EUR", unit: "in" }),
    ],
    discounts: [],
    shipments: [{ carrier: "ups", country: "US" }],
    stock: [],
    catalogue: [],
    orders: [],
    offers: [],
    domains: "",
  },
];
