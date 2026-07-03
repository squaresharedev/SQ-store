// Shared fake-data generators for the dev seed script (and reused types for the
// reset script). Deterministic when given a --seed, so runs are reproducible.
//
// HARD RULE: all money is integer cents. No floats are ever stored.

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

// Each type carries a realistic price band in cents.
const PRODUCT_TYPES = [
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

export function generateProducts(rng: Rng, ownerId: string, count: number): ProductInsert[] {
  const products: ProductInsert[] = [];
  for (let i = 0; i < count; i += 1) {
    const type = pick(rng, PRODUCT_TYPES);
    const adjective = pick(rng, PRODUCT_ADJECTIVES);
    const title = `${adjective} ${type.noun}`;
    const price_cents = toNinetyNine(randInt(rng, type.min, type.max));
    // Mostly active; a few drafts. Drafts are excluded from order generation.
    const status = weightedPick<string>(rng, [["active", 8], ["draft", 2]]);
    const currency = weightedPick<string>(rng, [["EUR", 5], ["USD", 1]]);
    products.push({
      owner_id: ownerId,
      title,
      description: `${title}. A digital product for creators — instant download after purchase.`,
      price_cents,
      currency,
      // Placeholder key only. Nothing is uploaded to R2 by the seed.
      image_key: `seed/placeholder-${i + 1}.png`,
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

/** Clearly-fake buyer email on a reserved .test domain (never deliverable). */
export function fakeBuyerEmail(rng: Rng): string {
  const first = pick(rng, BUYER_FIRST);
  const last = pick(rng, BUYER_LAST);
  return `${first}.${last}${randInt(rng, 1, 999)}@example.test`;
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
  // Random time-of-day, clamped so "today" never lands in the future.
  const at = Math.min(dayStart.getTime() + randInt(rng, 0, 86_399) * 1000, now.getTime());
  return {
    seller_id: sellerId,
    product_id: product.id,
    storefront_id,
    channel,
    status,
    amount_cents,
    platform_fee_cents,
    currency: product.currency,
    buyer_email: fakeBuyerEmail(rng),
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
      orders.push(
        makeOrder(rng, { sellerId, storefrontId, product: pick(rng, pool), dayStart, now }),
      );
    }
  }
  return orders;
}
