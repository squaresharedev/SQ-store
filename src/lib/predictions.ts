// What a seller would probably choose anyway, worked out from what their store
// already holds. Plain rules with no database access and nothing stored: a page
// loads the facts, asks here, and hands the answer to a form or the designer.
// No answer means the screen behaves as if this file did not exist. Nothing
// becomes real until the seller saves it.
//
// The Store's own rules. The domain-free parts they are built from, and the
// AI half, are the shared core in lib/suggestions (docs/suggestions.md).

import { AGREEMENT_WINDOW, agreed, mostUsed, type SameAs } from "@/lib/suggestions/rules";
import type { DiscountView } from "@/types/discount";
import type { CarrierId } from "@/types/order-view";
import {
  ADD_ONS_MAX,
  type Currency,
  type DimensionUnit,
  type Product,
  type ProductBadge,
  type ProductDetail,
  type ProductDetails,
  type ProductOptionGroup,
  type ProductSafety,
  type ProductSales,
  type WeightUnit,
} from "@/types/product";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontConfig } from "@/types/storefront";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a product counts as "what the seller is working on". */
const RECENT_TOUCH_DAYS = 7;

/** How many of a seller's own past answers are offered ahead of the fixed ones. */
const OWN_CHOICES_MAX = 3;

/**
 * The catalogue in the order a seller is likeliest to place it: what they
 * touched this week, then what sells, then the order it came in (newest first).
 * `lastTouched` reads products.updated_at, which sales and moderation also move:
 * fine here, since a product that just sold is worth suggesting too.
 */
export function rankProductsToPlace(
  products: readonly Product[],
  sales: Readonly<Record<string, ProductSales>>,
  lastTouched: { id: string; at: string } | null,
  now: Date,
): Product[] {
  const recentId =
    lastTouched && now.getTime() - Date.parse(lastTouched.at) <= RECENT_TOUCH_DAYS * DAY_MS ? lastTouched.id : null;
  const score = (product: Product) =>
    product.id === recentId ? Number.POSITIVE_INFINITY : (sales[product.id]?.unitsSold ?? 0);
  return [...products].sort((a, b) => score(b) - score(a));
}

/** The first product worth offering: buyers could actually get it. */
export function firstPlaceable(products: readonly Product[]): Product | null {
  return (
    products.find(
      (product) =>
        product.status === "active" && !product.removal && !(product.trackStock && (product.stockQuantity ?? 0) <= 0),
    ) ?? null
  );
}

/** How far back a product's pace of sales is measured for a restock forecast. */
export const RESTOCK_PACE_DAYS = 28;

/** A product that sells out sooner than this, at its pace, is worth a word. */
const RESTOCK_WARN_DAYS = 7;

/** A counted product that will run out soon at the pace it sells. */
export type RestockForecast = { id: string; title: string; daysLeft: number };

/**
 * Counted products that sell out within a week at their pace over the last
 * RESTOCK_PACE_DAYS, soonest first. One sale in the window is not a pace, and
 * a product already at zero has its own sold-out badge, so neither is
 * forecast. A low-stock alert set to 0 is the seller saying they do not want
 * to hear about this one (a last batch, or made to order), so it is not either.
 * `unitsSold` holds the units each product sold in the window.
 */
export function forecastRestocks(
  products: readonly { id: string; title: string; stockQuantity: number; lowStockThreshold: number }[],
  unitsSold: Readonly<Record<string, number>>,
): RestockForecast[] {
  return products
    .flatMap((product) => {
      const units = unitsSold[product.id] ?? 0;
      if (product.stockQuantity <= 0 || product.lowStockThreshold <= 0 || units < 2) return [];
      const daysLeft = Math.max(1, Math.round((product.stockQuantity * RESTOCK_PACE_DAYS) / units));
      return daysLeft <= RESTOCK_WARN_DAYS ? [{ id: product.id, title: product.title, daysLeft }] : [];
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Two buyers buying both, or two of the seller's other products offering it:
 *  one is a coincidence, two is worth a suggestion. */
const ADD_ON_HABIT_MIN = 2;

/** What the store's history says goes with one product, for its "Add to your
 *  order" list, counted by the other product's id. */
export type AddOnHabits = {
  /** Distinct buyers who bought this product and that one, in one order or two. */
  boughtWith: Readonly<Record<string, number>>;
  /** How many of the seller's other products already offer that one. */
  offeredWith: Readonly<Record<string, number>>;
};

export const NO_ADD_ON_HABITS: AddOnHabits = { boughtWith: {}, offeredWith: {} };

/**
 * `purchases` are paid orders: who bought (their email), and every product in
 * the order, its main product and its add-ons. A buyer counts once however
 * often they came back. `offers` are the store's products and what each
 * offers. `productId` is null for a product not saved yet, which nobody has
 * bought.
 */
export function addOnHabits(
  productId: string | null,
  purchases: readonly { buyer: string; productIds: readonly string[] }[],
  offers: readonly { id: string; addOnIds: readonly string[] }[],
): AddOnHabits {
  const boughtWith: Record<string, number> = {};
  if (productId) {
    const byBuyer = new Map<string, Set<string>>();
    for (const { buyer, productIds } of purchases) {
      const key = buyer.trim().toLowerCase();
      if (!key) continue;
      const bought = byBuyer.get(key) ?? new Set<string>();
      for (const id of productIds) bought.add(id);
      byBuyer.set(key, bought);
    }
    for (const bought of byBuyer.values()) {
      if (!bought.has(productId)) continue;
      for (const id of bought) if (id !== productId) boughtWith[id] = (boughtWith[id] ?? 0) + 1;
    }
  }
  const offeredWith: Record<string, number> = {};
  for (const offer of offers) {
    if (offer.id === productId) continue;
    for (const id of new Set(offer.addOnIds)) {
      if (id !== productId) offeredWith[id] = (offeredWith[id] ?? 0) + 1;
    }
  }
  return { boughtWith, offeredWith };
}

/** Products "Add to your order" could offer next, and why. */
export type AddOnSuggestion = { reason: keyof AddOnHabits; ids: string[] };

/**
 * What "Add to your order" could offer next, behind one tap: what buyers
 * bought with this product, or failing that what the seller offers with their
 * other products. One reason at a time, so the chip can say where it came
 * from. `offerable` are the products buyers would be shown here (same kind and
 * currency, live, in stock), in catalogue order, which also breaks ties. Never
 * more than the list has room for.
 */
export function suggestAddOns(
  habits: AddOnHabits,
  offerable: readonly string[],
  chosen: readonly string[],
): AddOnSuggestion | null {
  const room = ADD_ONS_MAX - chosen.length;
  if (room <= 0) return null;
  const open = offerable.filter((id) => !chosen.includes(id));
  for (const reason of ["boughtWith", "offeredWith"] as const) {
    const counts = habits[reason];
    const ids = open
      .filter((id) => (counts[id] ?? 0) >= ADD_ON_HABIT_MIN)
      .sort((a, b) => counts[b]! - counts[a]!)
      .slice(0, room);
    if (ids.length > 0) return { reason, ids };
  }
  return null;
}

/** The facts predictProductDefaults reads from one recent product. */
export type RecentProduct = Pick<
  ProductDetail,
  "title" | "currency" | "shippingProfileId" | "details" | "optionGroups" | "lowStockThreshold" | "maxPerOrder"
>;

/** The manufacturer and EU contact, without what belongs to one item only
 *  (its identifier and warnings). */
export type SafetyContacts = Omit<ProductSafety, "identifier" | "warnings">;

/** What a product is made of, where, and how to look after it. */
export type ProductFacts = Pick<ProductDetails, "materials" | "origin" | "care">;

/** What "Same as {product}" copies from one earlier product: the blocks that
 *  describe what kind of thing it is, never its title, photos, price or words.
 *  Only the blocks that product has are present. */
export type ProductCopy = {
  /** Copied with fresh ids on the tap (option-presets.ts copyOptionGroups). */
  optionGroups?: ProductOptionGroup[];
  facts?: ProductFacts;
  safety?: SafetyContacts;
};

/** What a new product starts from. Every member is optional: absent keeps the
 *  form's usual default. */
export type ProductSuggestions = {
  currency?: Currency;
  shippingProfileId?: string;
  dimensionUnit?: DimensionUnit;
  weightUnit?: WeightUnit;
  lowStockThreshold?: number;
  maxPerOrder?: number;
  /** One product to copy from, so a tap never mixes two products. */
  sameAs?: SameAs<ProductCopy>;
  /** The seller's own badges, most used first, offered before the fixed ones. */
  badges?: ProductBadge[];
};

function safetyContacts({ details: { safety } }: RecentProduct): SafetyContacts | null {
  if (!safety?.manufacturerName || !safety.manufacturerAddress || !safety.manufacturerEmail) return null;
  const contacts: ProductSafety = { ...safety };
  delete contacts.identifier;
  delete contacts.warnings;
  return contacts;
}

function productFacts({ details: { materials, origin, care } }: RecentProduct): ProductFacts | null {
  if (!materials && !origin && !care) return null;
  return { ...(materials ? { materials } : {}), ...(origin ? { origin } : {}), ...(care ? { care } : {}) };
}

/** The blocks of `product` worth copying, or null when it has none. */
function productCopy(product: RecentProduct): ProductCopy | null {
  const facts = productFacts(product);
  const safety = safetyContacts(product);
  const copy: ProductCopy = {
    ...(product.optionGroups.length > 0 ? { optionGroups: product.optionGroups } : {}),
    ...(facts ? { facts } : {}),
    ...(safety ? { safety } : {}),
  };
  return Object.keys(copy).length > 0 ? copy : null;
}

/** The currency most of the newest products are priced in, the newest winning
 *  a tie: a seller moving to dollars has it by their second dollar product,
 *  and one odd product does not move it. */
function usualCurrency(currencies: readonly Currency[]): Currency | null {
  return mostUsed(currencies.slice(0, AGREEMENT_WINDOW), (currency) => currency, 1)[0] ?? null;
}

/** `recent` is newest first; `profileIds` are the shipping profiles that still exist. */
export function predictProductDefaults(
  recent: readonly RecentProduct[],
  profileIds: readonly string[],
): ProductSuggestions {
  const currency = usualCurrency(recent.map((product) => product.currency));
  const profile = agreed(recent.map((product) => product.shippingProfileId), 2);
  const dimensionUnit = agreed(recent.flatMap((product) => product.details.dimensions?.unit ?? []));
  const weightUnit = agreed(recent.flatMap((product) => product.details.weight?.unit ?? []));
  // A per-order cap limits what a buyer can take, so it wants two that agree.
  const lowStockThreshold = agreed(recent.map((product) => product.lowStockThreshold), 2);
  const maxPerOrder = agreed(recent.map((product) => product.maxPerOrder), 2);
  const source = recent.find((product) => productCopy(product) !== null);
  const copy = source ? productCopy(source) : null;
  const badges = mostUsed(
    recent.flatMap((product) => product.details.badges ?? []),
    (badge) => badge.label.trim().toLowerCase(),
    OWN_CHOICES_MAX,
  ).map(({ icon, label, color }) => ({ icon, label, ...(color ? { color } : {}) }));
  return {
    ...(currency ? { currency } : {}),
    ...(profile && profileIds.includes(profile) ? { shippingProfileId: profile } : {}),
    ...(dimensionUnit ? { dimensionUnit } : {}),
    ...(weightUnit ? { weightUnit } : {}),
    ...(lowStockThreshold !== null ? { lowStockThreshold } : {}),
    ...(maxPerOrder !== null ? { maxPerOrder } : {}),
    ...(source && copy ? { sameAs: { from: source.title, value: copy } } : {}),
    ...(badges.length > 0 ? { badges } : {}),
  };
}

/** What a new discount starts from. */
export type DiscountSuggestions = {
  percent?: number;
  /** How many days it runs, counted from when it starts. */
  days?: number;
  /** Where the seller has shared codes before, most used first. */
  channels?: string[];
};

/** `discounts` is newest first. A run is counted to the nearest day, because a
 *  "1 week" press measures from the click and the start from the save. */
export function predictDiscountDefaults(discounts: readonly DiscountView[]): DiscountSuggestions {
  const percent = agreed(
    discounts.map((discount) => (discount.value.type === "percent" ? discount.value.percentOff : null)),
    2,
  );
  const days = agreed(
    discounts.map((discount) =>
      discount.endsAt ? Math.round((Date.parse(discount.endsAt) - Date.parse(discount.startsAt)) / DAY_MS) : null,
    ),
    2,
  );
  const channels = mostUsed(
    discounts.flatMap((discount) => discount.shareChannel?.trim() || []),
    (channel) => channel.toLowerCase(),
    OWN_CHOICES_MAX,
  );
  return {
    ...(percent ? { percent } : {}),
    ...(days ? { days } : {}),
    ...(channels.length > 0 ? { channels } : {}),
  };
}

/**
 * The design of a seller's last storefront, for their next one: its look, and
 * its product page and checkout as they set them up. The board starts at its
 * default height, and uploaded files stay behind: a new storefront must not
 * depend on a file another storefront owns and may delete. A page the last
 * storefront never set up is left out, so the new one keeps its own default.
 */
export function carryOverDesign(previous: StorefrontConfig): Pick<StorefrontConfig, "theme"> &
  Partial<Pick<StorefrontConfig, "productPage" | "checkoutPage">> {
  const defaults = DEFAULT_STOREFRONT_CONFIG.theme;
  const { theme, productPage, checkoutPage } = previous;
  const design: ReturnType<typeof carryOverDesign> = {
    theme: {
      ...theme,
      rows: defaults.rows,
      background: theme.background.kind === "image" ? defaults.background : theme.background,
      // "custom" means the uploaded face, which stays behind.
      font: theme.font === "custom" ? defaults.font : theme.font,
    },
  };
  delete design.theme.customFont;
  if (productPage) {
    design.productPage = { ...productPage };
    delete design.productPage.backgroundImage;
    if (productPage.font === "custom") delete design.productPage.font;
  }
  if (checkoutPage) {
    design.checkoutPage = { ...checkoutPage };
    delete design.checkoutPage.backgroundImage;
    delete design.checkoutPage.thanksBackgroundImage;
  }
  return design;
}

/** Another storefront's embed domains, for one that has none yet. `storefronts`
 *  is newest edited first; the one being set up is left out by its id. */
export function embedDomainsElsewhere(
  storefronts: readonly { id: string; name: string; domains: readonly string[] }[],
  currentId: string,
): SameAs<string[]> | null {
  const source = storefronts.find((storefront) => storefront.id !== currentId && storefront.domains.length > 0);
  return source ? { from: source.name, value: [...source.domains] } : null;
}

/** What the shipping terms start from while the seller has set none. */
export type ShippingSuggestions = {
  /** The business's country, offered behind one tap: where goods ship from is
   *  a claim made to buyers. */
  shipsFrom?: string;
  /** The currency the catalogue is priced in. */
  ratesCurrency?: Currency;
};

/** `currencies` are the newest products' own, newest first. */
export function predictShippingDefaults(
  currencies: readonly Currency[],
  businessCountry: string | undefined,
): ShippingSuggestions {
  const ratesCurrency = usualCurrency(currencies);
  return {
    ...(businessCountry ? { shipsFrom: businessCountry } : {}),
    ...(ratesCurrency ? { ratesCurrency } : {}),
  };
}

/** The carriers a store ships with: the newest overall, and the newest to each
 *  country it has sent a parcel to, so a seller who posts at home and uses a
 *  courier abroad starts on the right one for each parcel. */
export type CarrierHabits = { latest: CarrierId | null; byCountry: Readonly<Record<string, CarrierId>> };

export const NO_CARRIER_HABITS: CarrierHabits = { latest: null, byCountry: {} };

/** `shipped` is newest first; `country` is where each parcel went (ISO code). */
export function carrierHabits(shipped: readonly { carrier: CarrierId; country: string | null }[]): CarrierHabits {
  return shipped.reduceRight<CarrierHabits>(
    (habits, { carrier, country }) => withCarrier(habits, carrier, country),
    NO_CARRIER_HABITS,
  );
}

/** The habits once a parcel to `country` has gone with `carrier`. */
export function withCarrier(habits: CarrierHabits, carrier: CarrierId, country: string | null): CarrierHabits {
  return { latest: carrier, byCountry: country ? { ...habits.byCountry, [country]: carrier } : habits.byCountry };
}

/** The carrier a parcel to `country` starts on: that country's, else the
 *  newest, else none. */
export function carrierFor(habits: CarrierHabits, country: string | null | undefined): CarrierId | null {
  return (country ? habits.byCountry[country] : undefined) ?? habits.latest;
}
