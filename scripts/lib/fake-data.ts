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

const PRODUCT_ADJECTIVES = [
  "Midnight", "Golden Hour", "Analog", "Neon", "Pastel", "Brutalist", "Retro",
  "Cyber", "Minimal", "Vaporwave", "Cinematic", "Lo-Fi", "Aurora", "Grain",
] as const;

// Stock photo categories for different product types (picsum.photos URLs).
const STOCK_IMAGES = {
  "Lightroom Preset Pack": [
    "https://picsum.photos/400/300?random=1",
    "https://picsum.photos/400/300?random=2",
    "https://picsum.photos/400/300?random=3",
  ],
  "Procreate Brush Set": [
    "https://picsum.photos/400/300?random=10",
    "https://picsum.photos/400/300?random=11",
    "https://picsum.photos/400/300?random=12",
  ],
  "Notion Template": [
    "https://picsum.photos/400/300?random=20",
    "https://picsum.photos/400/300?random=21",
    "https://picsum.photos/400/300?random=22",
  ],
  "Icon Pack": [
    "https://picsum.photos/400/300?random=30",
    "https://picsum.photos/400/300?random=31",
    "https://picsum.photos/400/300?random=32",
  ],
  "Font Family": [
    "https://picsum.photos/400/300?random=40",
    "https://picsum.photos/400/300?random=41",
    "https://picsum.photos/400/300?random=42",
  ],
  "Sample Pack": [
    "https://picsum.photos/400/300?random=50",
    "https://picsum.photos/400/300?random=51",
    "https://picsum.photos/400/300?random=52",
  ],
  "LUT Collection": [
    "https://picsum.photos/400/300?random=60",
    "https://picsum.photos/400/300?random=61",
    "https://picsum.photos/400/300?random=62",
  ],
  "UI Kit": [
    "https://picsum.photos/400/300?random=70",
    "https://picsum.photos/400/300?random=71",
    "https://picsum.photos/400/300?random=72",
  ],
  "E-book": [
    "https://picsum.photos/400/300?random=80",
    "https://picsum.photos/400/300?random=81",
    "https://picsum.photos/400/300?random=82",
  ],
  "Wallpaper Bundle": [
    "https://picsum.photos/400/300?random=90",
    "https://picsum.photos/400/300?random=91",
    "https://picsum.photos/400/300?random=92",
  ],
} as const;

// Each type carries a realistic price band in cents.
export const PRODUCT_TYPES = [
  { noun: "Lightroom Preset Pack", min: 1200, max: 3900 },
  { noun: "Procreate Brush Set", min: 700, max: 2400 },
  { noun: "Notion Template", min: 900, max: 4900 },
  { noun: "Icon Pack", min: 500, max: 1900 },
  { noun: "Font Family", min: 1900, max: 6900 },
  { noun: "Sample Pack", min: 1500, max: 4500 },
  { noun: "LUT Collection", min: 1900, max: 5900 },
  { noun: "UI Kit", min: 2900, max: 9900 },
  { noun: "E-book", min: 900, max: 3900 },
  { noun: "Wallpaper Bundle", min: 300, max: 1500 },
] as const;

/** Snap a raw cents amount to friendly ".99" pricing, e.g. 2437 -> 2499. */
function toNinetyNine(rawCents: number): number {
  return Math.max(99, Math.round(rawCents / 100) * 100 - 1);
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

export function generateProducts(rng: Rng, ownerId: string, count: number): ProductInsert[] {
  const products: ProductInsert[] = [];
  const usedTitles = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const type = pick(rng, PRODUCT_TYPES);
    const adjective = pick(rng, PRODUCT_ADJECTIVES);
    const title = `${adjective} ${type.noun}`;
    // Titles are snapshotted onto orders, and the top-products table groups by
    // that snapshot. Two products sharing a title would merge into one row and
    // overstate it, so skip the collision rather than create it.
    if (usedTitles.has(title)) continue;
    usedTitles.add(title);
    const price_cents = toNinetyNine(randInt(rng, type.min, type.max));
    // Mostly active; a few drafts. Drafts are excluded from order generation.
    const status = weightedPick<string>(rng, [["active", 8], ["draft", 2]]);
    // Pick a random stock image for the product type.
    const images = STOCK_IMAGES[type.noun as keyof typeof STOCK_IMAGES];
    const image_key = pick(rng, images);
    products.push({
      owner_id: ownerId,
      title,
      description: `${title}. A digital product for creators, instant download after purchase.`,
      price_cents,
      currency: STORE_CURRENCY,
      image_key,
      status,
    });
  }
  return products;
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
