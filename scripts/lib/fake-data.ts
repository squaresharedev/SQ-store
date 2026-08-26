// Shared fake-data generators for the dev seed script (and reused types for the
// reset script). Deterministic when given a --seed, so runs are reproducible.
//
// HARD RULE: all money is integer cents. No floats are ever stored.
//
// RELATIONSHIP TO THE SALES SIMULATOR. `pnpm seed` bootstraps a store from
// nothing: it creates the products, then backfills a history of orders. The
// pg_cron simulator in supabase/migrations/20260801_demo_sales_sim.sql takes it
// from there, adding a few orders every 20 minutes so the dashboard keeps
// moving. The two MUST model sales the same way or a backfilled day and a live
// day would look different in the same chart, so the four properties below are
// deliberately mirrored on both sides:
//
//   1. ONE currency per store  - the analytics reader is EUR-only, so a mixed
//      catalogue silently drops half the dataset before it reaches a chart.
//   2. A recurring buyer pool  - a fresh random email per order pins the
//      analytics "repeat buyers" figure to 0 forever.
//   3. Time-of-day shape       - real stores do not sell evenly at 04:00.
//   4. Pareto product mix      - uniform picking makes "top products" noise.

import { CATALOG } from "./catalog.ts";

// ---------------------------------------------------------------------------
// Deterministic RNG + small sampling helpers
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32 — tiny deterministic PRNG so `--seed <n>` reproduces a dataset. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Pick a value by relative weight, e.g. [["paid", 85], ["refunded", 6]]. */
export function weightedPick<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Order enums — kept in sync with the orders table CHECK constraints.
// ---------------------------------------------------------------------------

export const ORDER_CHANNELS = ["embed", "marketplace"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_STATUSES = ["paid", "refunded", "disputed", "pending"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Insert shape for public.products (matches the existing table columns). */
export interface ProductInsert {
  owner_id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  status: string;
  image_key: string;
}

/** One product the store actually sells: a real name, description, price and
 *  photograph, snapshotted from a real catalogue. See scripts/build-catalog.ts. */
export interface CatalogProduct {
  title: string;
  description: string;
  /** Integer cents, like every other money value in this project. */
  priceCents: number;
  /** Absolute https URL to a photo OF THIS PRODUCT (not a themed stock shot).
   *  presignGetUrl() passes full URLs straight through — see src/lib/r2.ts. */
  imageUrl: string;
}

/**
 * How a category is shot AND what it sells — the two halves of looking like one
 * real shop rather than a stock-photo grab bag.
 *
 * `aesthetic` is the design language every product in the collection shares
 * (one material palette, one era). It matters as much as the backdrop: a
 * consistent white sweep behind an ornate carved bed, a red mid-century chair
 * and a kitsch photo frame still reads as three unrelated shops.
 *
 * `prompt` is the shared instruction the collection's photography was
 * generated from, kept so the set can be extended later without drifting.
 */
export interface PhotoStyle {
  /** The lighting/backdrop treatment, e.g. "Low-key charcoal". */
  name: string;
  /** The collection's design language, e.g. "Brutalist concrete". */
  aesthetic: string;
  /** Shared generation prompt, so new products match the existing shots. */
  prompt: string;
}

/** A themed slice of the catalogue, e.g. "Furniture". A store only ever draws
 *  from ONE theme (see generateProducts), so it never ends up selling, say,
 *  running shoes next to smartphones. */
export interface ProductTheme {
  key: string;
  label: string;
  photoStyle: PhotoStyle;
  products: readonly CatalogProduct[];
}

/**
 * The store categories, each ONE design collection. See lib/catalog.ts for the
 * data and for why it is authored rather than scraped.
 */
export const PRODUCT_THEMES: readonly ProductTheme[] = CATALOG;

/** Look a theme up by its key, e.g. for `pnpm seed --theme drones`. */
export function themeByKey(key: string): ProductTheme | undefined {
  return PRODUCT_THEMES.find((theme) => theme.key === key);
}

/** Every theme key, for CLI help and validation messages. */
export const THEME_KEYS: readonly string[] = PRODUCT_THEMES.map((theme) => theme.key);

/** Pick the one theme a store's whole catalogue will be drawn from. */
export function pickTheme(rng: Rng): ProductTheme {
  return pick(rng, PRODUCT_THEMES);
}

/** Every catalogue product across every theme. */
export const CATALOG_PRODUCTS: readonly CatalogProduct[] = PRODUCT_THEMES.flatMap((t) => t.products);

/** Find a catalogue entry by its exact title, for tools that need to restore a
 *  seeded product's original photo (scripts/update-product-images.ts). */
export function findCatalogProduct(title: string): CatalogProduct | undefined {
  return CATALOG_PRODUCTS.find((product) => product.title === title);
}


/**
 * The store's single currency.
 *
 * WHY NOT a per-product mix: getAnalytics() pushes `.neq("currency", "USD")`
 * down to the database, so every USD row is invisible to the revenue tiles, the
 * time series, the channel split and the top-products table. A catalogue priced
 * half in USD therefore renders as a store with half the sales, for no reason a
 * reader could ever deduce from the UI. One store, one currency.
 */
export const STORE_CURRENCY = "EUR";

/** Fisher-Yates, drawing from the seeded RNG so shuffles stay reproducible. */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Generate a store's catalogue. Every product is drawn from a SINGLE theme
 * (defaults to one picked at random) so a store never ends up selling, say,
 * running shoes and smartphones side by side — real storefronts specialise.
 *
 * Products are SAMPLED WITHOUT REPLACEMENT from the theme's real catalogue, so
 * a store never lists the same item twice. `count` is therefore capped at the
 * theme's size — ask for 15 furniture items from a 10-item theme and you get
 * 10, which is the honest answer rather than five duplicates.
 */
export function generateProducts(
  rng: Rng,
  ownerId: string,
  count: number,
  theme: ProductTheme = pickTheme(rng),
): ProductInsert[] {
  // Titles are snapshotted onto orders and the top-products table groups by
  // that snapshot, so two rows sharing a title would merge into one overstated
  // row. Sampling without replacement makes that impossible by construction.
  return shuffled(rng, theme.products)
    .slice(0, Math.min(count, theme.products.length))
    .map((product) => ({
      owner_id: ownerId,
      title: product.title,
      description: product.description,
      price_cents: product.priceCents,
      currency: STORE_CURRENCY,
      image_key: product.imageUrl,
      // Mostly active; a few drafts. Drafts are excluded from order generation.
      status: weightedPick<string>(rng, [["active", 8], ["draft", 2]]),
    }));
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** The product fields the seed needs after products are inserted (with ids). */
export interface SeededProduct {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  status: string;
}

/** Insert shape for public.orders. created_at is backdated across the window. */
export interface OrderInsert {
  seller_id: string;
  product_id: string | null;
  storefront_id: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  buyer_email: string;
  product_title: string;
  product_price_cents: number;
  created_at: string;
}

/** Small, realistic platform take rate applied to the gross amount. */
const PLATFORM_TAKE_RATE = 0.05;
const DAY_MS = 86_400_000;

const BUYER_FIRST = [
  "alex", "sam", "jordan", "riley", "casey", "noa", "mika", "lee", "robin",
  "kai", "tess", "ivan", "luca", "mara", "gus", "juno", "remy", "sasha",
] as const;
const BUYER_LAST = [
  "wong", "silva", "meyer", "novak", "haddad", "kim", "rossi", "dubois",
  "olsen", "costa", "tran", "abadi", "weber", "koch", "flores", "park",
] as const;

/**
 * Deterministic address for a buyer INDEX, on a reserved .test domain so it is
 * never deliverable to a real inbox. Index-addressed (rather than freshly
 * random) so the same index always means the same person, which is what makes
 * repeat purchases expressible at all.
 */
export function buyerEmailForIndex(index: number): string {
  const first = BUYER_FIRST[index % BUYER_FIRST.length]!;
  const last = BUYER_LAST[Math.floor(index / BUYER_FIRST.length) % BUYER_LAST.length]!;
  return `${first}.${last}${100 + index}@example.test`;
}

/** Share of orders placed by someone who has bought before. */
export const RETURNING_BUYER_RATE = 0.28;
/** How many distinct regulars the store has. */
export const BUYER_POOL_SIZE = 90;

/**
 * Pick the buyer for one order: usually a first-timer, sometimes a regular.
 *
 * Both degenerate models read as obviously fake on the analytics page, which
 * reports unique buyers and repeat buyers side by side:
 *   - a fresh random address every time (what this generator used to do) gives
 *     416 orders, 416 buyers, and a repeat-buyer count pinned to 0;
 *   - drawing only from a fixed pool makes EVERY buyer a repeat buyer, so the
 *     store never appears to acquire anyone.
 * Mixing the two in a ~28/72 split produces both numbers at once.
 */
export function pickBuyerEmail(rng: Rng, poolSize = BUYER_POOL_SIZE): string {
  if (rng() < RETURNING_BUYER_RATE) {
    // Mild skew (exponent 1.3) so a few regulars stand out. A harder skew
    // concentrates the store on one address: at 2.2 the top buyer took 15% of
    // every order placed, which is not a customer, it is a bug that looks like
    // a customer.
    return buyerEmailForIndex(Math.floor(Math.pow(rng(), 1.3) * poolSize));
  }
  // First-timer: an index far outside the pool, so it can never collide with a
  // regular and silently turn them into a repeat buyer.
  return buyerEmailForIndex(poolSize + Math.floor(rng() * 1_000_000));
}

/**
 * Relative sales intensity by UTC hour, normalised to mean 1 so it re-shapes
 * WHEN orders land without changing HOW MANY there are. A flat clock is the
 * most obvious tell in a demo dataset: nobody buys evenly at 04:00 and 20:00.
 */
const HOUR_WEIGHTS = [
  0.25, 0.15, 0.1, 0.1, 0.12, 0.2, // 00-05 night
  0.4, 0.7, 1.0, 1.2, 1.3, 1.25, // 06-11 morning ramp
  1.1, 1.2, 1.3, 1.35, 1.4, 1.5, // 12-17 afternoon
  1.7, 1.8, 1.6, 1.2, 0.8, 0.45, // 18-23 evening peak
] as const;

/** Seconds past midnight for one order, drawn from the hour-of-day shape. */
export function pickSecondOfDay(rng: Rng): number {
  const total = HOUR_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let hour = 0; hour < HOUR_WEIGHTS.length; hour += 1) {
    roll -= HOUR_WEIGHTS[hour]!;
    if (roll < 0) return hour * 3600 + Math.floor(rng() * 3600);
  }
  return 23 * 3600 + Math.floor(rng() * 3600);
}

/**
 * Relative popularity per product, by catalogue position: weight ~ 1/rank^0.7.
 *
 * Uniform picking gives every product the same sales, which makes the dashboard
 * "top products" table a list of ties in random order, i.e. pure noise. Real
 * catalogues have a head and a long tail.
 */
export function popularityWeights(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.pow(i + 1, -0.7));
}

/** Draw an index in [0, weights.length) proportional to `weights`. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

export interface GenerateOrdersOptions {
  sellerId: string;
  /** Storefront to attribute embed sales to; null if the seller has none. */
  storefrontId: string | null;
  products: SeededProduct[];
  /** "Now" — captured once by the caller so a run is internally consistent. */
  now: Date;
  /** Size of the backdated window, in days (~90). */
  days: number;
  /** Approximate total number of orders to generate (~150–300). */
  targetTotal: number;
}

function makeOrder(
  rng: Rng,
  args: {
    sellerId: string;
    storefrontId: string | null;
    product: SeededProduct;
    dayStart: Date;
    now: Date;
  },
): OrderInsert {
  const { sellerId, storefrontId, product, dayStart, now } = args;
  const channel = weightedPick<OrderChannel>(rng, [["embed", 6], ["marketplace", 4]]);
  const status = weightedPick<OrderStatus>(rng, [
    ["paid", 85],
    ["refunded", 6],
    ["disputed", 3],
    ["pending", 6],
  ]);
  const amount_cents = product.price_cents; // gross, drawn from the product price
  const platform_fee_cents = Math.round(amount_cents * PLATFORM_TAKE_RATE);
  // Embed sales flow through the seller's storefront widget; marketplace sales
  // come from the (future) discovery feed and aren't tied to a storefront.
  const storefront_id = channel === "embed" ? storefrontId : null;
  // Time-of-day follows the hour shape, clamped so "today" never lands in the
  // future (the current day is only partly elapsed).
  const at = Math.min(dayStart.getTime() + pickSecondOfDay(rng) * 1000, now.getTime());
  return {
    seller_id: sellerId,
    product_id: product.id,
    storefront_id,
    channel,
    status,
    amount_cents,
    platform_fee_cents,
    currency: product.currency,
    buyer_email: pickBuyerEmail(rng),
    product_title: product.title,
    product_price_cents: product.price_cents,
    created_at: new Date(at).toISOString(),
  };
}

/**
 * Generate orders over the last `days` with a NON-UNIFORM distribution: a gentle
 * upward trend, weekend dips, day-to-day noise, and occasional spike days — so
 * dashboard charts look real instead of flat. Only active products get sales.
 */
export function generateOrders(rng: Rng, opts: GenerateOrdersOptions): OrderInsert[] {
  const { sellerId, storefrontId, products, now, days, targetTotal } = opts;
  const active = products.filter((p) => p.status === "active");
  const pool = active.length > 0 ? active : products;
  if (pool.length === 0) return [];
  // Fixed popularity per catalogue position, drawn once so a product's
  // standing is stable for the whole window. Re-rolling per order would
  // average every product back to the same volume.
  const popularity = popularityWeights(pool.length);

  // 1) Build a per-day weight from trend × weekend × noise × occasional spike.
  const weights: number[] = [];
  for (let d = 0; d < days; d += 1) {
    const dayDate = new Date(now.getTime() - (days - 1 - d) * DAY_MS);
    const trend = 0.5 + d / days; // ramps ~0.5 -> ~1.5 across the window
    const dow = dayDate.getUTCDay(); // 0 Sun .. 6 Sat
    const weekend = dow === 0 || dow === 6 ? 0.6 : 1;
    const noise = 0.6 + rng() * 0.8; // 0.6 .. 1.4
    const spike = rng() < 0.07 ? 2.2 : 1; // ~7% of days are unusually busy
    weights.push(trend * weekend * noise * spike);
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  // 2) Convert weights into integer per-day counts summing ~= targetTotal,
  //    using stochastic rounding so the fractional part isn't lost.
  const orders: OrderInsert[] = [];
  for (let d = 0; d < days; d += 1) {
    const expected = (weights[d]! / weightSum) * targetTotal;
    let count = Math.floor(expected);
    if (rng() < expected - count) count += 1;
    const dayStart = new Date(now.getTime() - (days - 1 - d) * DAY_MS);
    dayStart.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < count; i += 1) {
      const product = pool[weightedIndex(rng, popularity)]!;
      orders.push(makeOrder(rng, { sellerId, storefrontId, product, dayStart, now }));
    }
  }
  return orders;
}
