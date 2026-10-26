// Fake product reviews for the dev seed: `pnpm seed` writes them with every
// new catalogue, and `pnpm seed-reviews` adds a batch to a store that is
// already seeded. Deterministic under --seed, like the rest of the seed data.
//
// WHAT A SEEDED STORE CARRIES. The point is that every surface the review
// system has can be opened and judged, so the batch covers every state:
//
//   - native reviews from the store's own paid orders, verified, one per order
//     (the same rule the database enforces),
//   - imported reviews from Judge.me and Loox runs, dated before the store's
//     own sales, as a Shopify migration would be, and never verified,
//   - a skewed-positive rating mix, so the summary's breakdown has a shape,
//   - one product with more than a page of reviews, so the feed paginates,
//   - one review each held by the automatic check, blocked by it, hidden by
//     the seller for a reason, and waiting for the check,
//   - a blunt but allowed negative ("a dumb design"), which the check keeps.
//
// The text is generic on purpose: it reads right under a sofa, a drone or a
// jacket, whichever collection the catalogue was drawn from.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail } from "./env.ts";
import { pick, randInt, shuffled, weightedPick, type Rng } from "./fake-data.ts";

// MIRRORS of the reviews CHECK constraints (supabase/migrations/20261025_reviews.sql).
type ImportSource = "judgeme" | "loox";
type ModerationStatus = "pending" | "clean" | "held" | "blocked";
type HideReason = "personal_info";

/** Insert shape for public.review_imports. */
export interface ReviewImportInsert {
  id: string;
  seller_id: string;
  source: ImportSource;
  file_name: string;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  created_at: string;
}

/** Insert shape for public.reviews. seller_id is set by the table's trigger. */
export interface ReviewInsert {
  product_id: string;
  order_id: string | null;
  import_id: string | null;
  source: "native" | ImportSource;
  external_id: string | null;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  is_verified_buyer: boolean;
  is_approved: boolean;
  hidden_reason: HideReason | null;
  hidden_by: string | null;
  hidden_at: string | null;
  moderation_status: ModerationStatus;
  moderation_ground: string | null;
  moderated_at: string | null;
  reviewed_at: string;
}

/** A product a review can be about. */
export interface ReviewableProduct {
  id: string;
  title: string;
}

/** A paid, unrefunded order with no review yet: the only kind a buyer can review. */
export interface ReviewableOrder {
  id: string;
  product_id: string | null;
  buyer_email: string;
  created_at: string;
}

const DAY_MS = 86_400_000;

/** The rating mix: skewed positive, like every real shop's. */
const RATING_WEIGHTS = [
  [5, 52],
  [4, 26],
  [3, 10],
  [2, 6],
  [1, 6],
] as const;

/** Share of reviews that carry a title. */
const TITLE_RATE = 0.6;
/** Share of a product's reviews that come from its own orders, when it has them. */
const NATIVE_RATE = 0.55;
/** The product that paginates: more than REVIEW_PAGE_SIZE (10) reviews. */
const BUSY_PRODUCT_REVIEWS = [24, 32] as const;
/** Reviews per other product; zero leaves some products with none, as in a real store. */
const REVIEWS_PER_PRODUCT = [0, 10] as const;

const TITLES: Record<number, readonly string[]> = {
  5: ["Exactly as pictured", "Love it", "Worth every cent", "Better than expected", "Perfect"],
  4: ["Really nice", "Very happy", "Great, one small thing", "Solid buy"],
  3: ["It's fine", "Decent, not amazing", "Mixed feelings"],
  2: ["Disappointed", "Not what I hoped for"],
  1: ["Would not buy again", "Broke quickly"],
};

const OPENERS: Record<number, readonly string[]> = {
  5: [
    "Bought the {product} after a lot of comparing and it is the right call.",
    "The {product} looks even better in person than in the photos.",
    "Second one I have ordered from this shop, and the {product} did not disappoint.",
    "Got the {product} as a gift and it went down very well.",
  ],
  4: [
    "The {product} is lovely and does exactly what I wanted.",
    "Really pleased with the {product} overall.",
    "Good quality for the price, the {product} feels made to last.",
  ],
  3: [
    "The {product} is okay, but smaller than I imagined from the photos.",
    "Nothing wrong with the {product}, it just did not wow me.",
  ],
  2: [
    "The {product} arrived after three weeks and the box was crushed.",
    "Expected more from the {product} given the price.",
  ],
  1: [
    "The {product} broke within a week. Honestly a dumb design for something you use every day.",
    "Stopped working after a few days and the {product} was not cheap.",
  ],
};

const DETAILS: Record<number, readonly string[]> = {
  5: [
    "Arrived well packed, two days early.",
    "The finish is beautiful and it feels solid.",
    "The seller answered my question within the hour.",
    "",
  ],
  4: [
    "Delivery took a bit longer than quoted, otherwise perfect.",
    "Would have liked one more colour option.",
    "",
  ],
  3: ["Returns were easy at least.", "Might grow on me.", ""],
  2: ["The seller did offer a partial refund.", "It works, but I would not order it again."],
  1: ["Stupid of me not to read the dimensions, but the build quality is poor too.", ""],
};

/** Names on imported reviews, as review apps export them. */
const IMPORTED_AUTHORS = [
  "Hannah K.", "Tomás R.", "Ines M.", "Pieter V.", "Zuzana H.", "Oliver B.",
  "Marta P.", "Jonas L.", "Chloé D.", "Matteo G.", "Aoife N.", "Lukas S.",
] as const;

/**
 * The reviews that exist to show a state rather than an opinion. Each lands on
 * the busy product, so one page shows them all side by side.
 */
const STATE_SPECIMENS: readonly {
  rating: number;
  title: string | null;
  body: string;
  moderation: ModerationStatus;
  ground: string | null;
  hidden?: HideReason;
}[] = [
  {
    rating: 1,
    title: "Avoid this seller",
    body: "This shop is running a scam, the photos are stolen and nothing they say is true.",
    moderation: "held",
    ground: "scam",
  },
  {
    rating: 5,
    title: null,
    body: "Get the same thing for half the price at best-deals-outlet dot com, message me for a code.",
    moderation: "blocked",
    ground: "spam",
  },
  {
    rating: 4,
    title: "Good, courier less so",
    body: "Nice product. The courier lost it once, so call me on +420 601 234 567 if it happens again.",
    moderation: "clean",
    ground: null,
    hidden: "personal_info",
  },
  { rating: 5, title: "Just arrived", body: "First impressions are great, will update after a week.", moderation: "pending", ground: null },
  { rating: 4, title: null, body: "Does the job nicely and looks good doing it.", moderation: "pending", ground: null },
];

/** "alex.wong123@example.test" -> "Alex W.": a review shows a first name and an initial. */
function reviewerName(email: string): string {
  const [first = "", last = ""] = email.split("@")[0]!.split(".");
  const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const initial = last.replace(/[0-9]+$/, "").charAt(0).toUpperCase();
  return initial ? `${cap(first)} ${initial}.` : cap(first);
}

function reviewCopy(rng: Rng, rating: number, product: string): { title: string | null; body: string } {
  const opener = pick(rng, OPENERS[rating]!).replace("{product}", product);
  const detail = pick(rng, DETAILS[rating]!);
  return {
    title: rng() < TITLE_RATE ? pick(rng, TITLES[rating]!) : null,
    body: detail ? `${opener} ${detail}` : opener,
  };
}

export interface GenerateReviewsOptions {
  sellerId: string;
  products: readonly ReviewableProduct[];
  orders: readonly ReviewableOrder[];
  now: Date;
}

export function generateReviews(
  rng: Rng,
  opts: GenerateReviewsOptions,
): { imports: ReviewImportInsert[]; reviews: ReviewInsert[] } {
  const { sellerId, products, now } = opts;
  if (products.length === 0) return { imports: [], reviews: [] };

  // Each product's reviewable orders, oldest first, each used at most once.
  const ordersByProduct = new Map<string, ReviewableOrder[]>();
  for (const order of opts.orders) {
    if (!order.product_id) continue;
    const list = ordersByProduct.get(order.product_id) ?? [];
    list.push(order);
    ordersByProduct.set(order.product_id, list);
  }

  // The runs the imported reviews came from: a store that moved from Shopify
  // used one review app, sometimes two over the years.
  const runs = (["judgeme", "loox"] as const).map((source) => ({
    id: randomUUID(),
    source,
    created_at: new Date(now.getTime() - randInt(rng, 1, 14) * DAY_MS).toISOString(),
  }));
  const importedPerRun = new Map<string, number>(runs.map((run) => [run.id, 0]));

  const reviews: ReviewInsert[] = [];
  const base = {
    is_approved: true,
    hidden_reason: null,
    hidden_by: null,
    hidden_at: null,
    moderation_ground: null,
  } satisfies Partial<ReviewInsert>;

  const nativeReview = (product: ReviewableProduct, order: ReviewableOrder, rating: number): ReviewInsert => {
    // A few days to three weeks after the order, never in the future.
    const written = Math.min(
      new Date(order.created_at).getTime() + randInt(rng, 3, 21) * DAY_MS,
      now.getTime() - randInt(rng, 1, 48) * 3_600_000,
    );
    return {
      ...base,
      ...reviewCopy(rng, rating, product.title),
      product_id: product.id,
      order_id: order.id,
      import_id: null,
      source: "native",
      external_id: null,
      rating,
      author_name: reviewerName(order.buyer_email),
      is_verified_buyer: true,
      moderation_status: "clean",
      moderated_at: new Date(written + 60_000).toISOString(),
      reviewed_at: new Date(written).toISOString(),
    };
  };

  const importedReview = (product: ReviewableProduct, rating: number): ReviewInsert => {
    const run = rng() < 0.65 ? runs[0]! : runs[1]!;
    importedPerRun.set(run.id, importedPerRun.get(run.id)! + 1);
    return {
      ...base,
      ...reviewCopy(rng, rating, product.title),
      product_id: product.id,
      order_id: null,
      import_id: run.id,
      source: run.source,
      external_id: `seed:${randomUUID()}`,
      rating,
      author_name: pick(rng, IMPORTED_AUTHORS),
      is_verified_buyer: false,
      moderation_status: "clean",
      moderated_at: run.created_at,
      // Written on Shopify, months before this store's own sales.
      reviewed_at: new Date(now.getTime() - randInt(rng, 100, 540) * DAY_MS).toISOString(),
    };
  };

  const [busy, ...rest] = shuffled(rng, products);
  for (const product of [busy!, ...rest]) {
    const count =
      product === busy ? randInt(rng, ...BUSY_PRODUCT_REVIEWS) : randInt(rng, ...REVIEWS_PER_PRODUCT);
    const available = ordersByProduct.get(product.id) ?? [];
    for (let i = 0; i < count; i += 1) {
      const rating = weightedPick(rng, RATING_WEIGHTS);
      const order = rng() < NATIVE_RATE ? available.shift() : undefined;
      reviews.push(order ? nativeReview(product, order, rating) : importedReview(product, rating));
    }
  }

  // The state specimens, on the busy product. Native where an order is left
  // (a buyer wrote it here), imported otherwise; the state is what matters.
  const busyOrders = ordersByProduct.get(busy!.id) ?? [];
  for (const specimen of STATE_SPECIMENS) {
    const order = busyOrders.shift();
    const row = order ? nativeReview(busy!, order, specimen.rating) : importedReview(busy!, specimen.rating);
    const settled = specimen.moderation !== "pending";
    reviews.push({
      ...row,
      title: specimen.title,
      body: specimen.body,
      moderation_status: specimen.moderation,
      moderation_ground: specimen.ground,
      moderated_at: settled ? row.moderated_at : null,
      // Written in the last day, so the specimens lead the moderation list.
      reviewed_at: new Date(now.getTime() - randInt(rng, 1, 20) * 3_600_000).toISOString(),
      ...(specimen.hidden
        ? {
            is_approved: false,
            hidden_reason: specimen.hidden,
            hidden_by: sellerId,
            hidden_at: new Date(now.getTime() - 3_600_000).toISOString(),
          }
        : {}),
    });
  }

  // A run counts what it brought in, plus the rows it could not place, which
  // every real export has (a product that no longer exists, a blank review).
  const imports: ReviewImportInsert[] = runs
    .filter((run) => importedPerRun.get(run.id)! > 0)
    .map((run) => {
      const imported = importedPerRun.get(run.id)!;
      const skipped = randInt(rng, 0, 3);
      return {
        id: run.id,
        seller_id: sellerId,
        source: run.source,
        file_name: `${run.source}-reviews-export.csv`,
        row_count: imported + skipped,
        imported_count: imported,
        skipped_count: skipped,
        created_at: run.created_at,
      };
    });

  return { imports, reviews };
}

const INSERT_CHUNK = 500;
/** How many of the most recent paid orders a run looks at. */
const ORDERS_READ_MAX = 1000;

/**
 * Read the test seller's products and still-unreviewed paid orders, then write
 * a batch of reviews onto them. Returns what it wrote, for the run's summary.
 */
export async function seedReviews(
  supabase: SupabaseClient,
  sellerId: string,
  rng: Rng,
  now: Date = new Date(),
): Promise<{ reviews: ReviewInsert[]; imports: ReviewImportInsert[] }> {
  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id, title")
    .eq("owner_id", sellerId);
  if (productError) fail(`Failed to read products: ${productError.message}`);
  if (!products?.length) fail("The test seller has no products to review. Run `pnpm seed` first.");

  const [{ data: orders, error: orderError }, { data: reviewed, error: reviewedError }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, product_id, buyer_email, created_at")
      .eq("seller_id", sellerId)
      .eq("status", "paid")
      .is("refunded_at", null)
      .order("created_at", { ascending: false })
      .limit(ORDERS_READ_MAX),
    supabase.from("reviews").select("order_id").eq("seller_id", sellerId).not("order_id", "is", null),
  ]);
  if (orderError) fail(`Failed to read orders: ${orderError.message}`);
  if (reviewedError) fail(`Failed to read reviews: ${reviewedError.message}`);
  const taken = new Set((reviewed ?? []).map((row) => row.order_id as string));
  const open = ((orders ?? []) as ReviewableOrder[]).filter((order) => !taken.has(order.id)).reverse();

  const batch = generateReviews(rng, { sellerId, products, orders: open, now });

  if (batch.imports.length) {
    const { error } = await supabase.from("review_imports").insert(batch.imports);
    if (error) fail(`Failed to insert review imports: ${error.message}`);
  }
  for (let i = 0; i < batch.reviews.length; i += INSERT_CHUNK) {
    const { error } = await supabase.from("reviews").insert(batch.reviews.slice(i, i + INSERT_CHUNK));
    if (error) fail(`Failed to insert reviews (chunk at ${i}): ${error.message}`);
  }
  return batch;
}

/** The lines a seed run prints about the reviews it wrote. */
export function reviewSummaryLines(batch: { reviews: ReviewInsert[]; imports: ReviewImportInsert[] }): string[] {
  const count = (test: (review: ReviewInsert) => boolean) => batch.reviews.filter(test).length;
  return [
    `  Reviews               ${batch.reviews.length}` +
      ` (${count((r) => r.source === "native")} verified, ${count((r) => r.source !== "native")} imported` +
      ` from ${batch.imports.length} run${batch.imports.length === 1 ? "" : "s"})`,
    `  Review states         ${count((r) => r.moderation_status === "held")} held,` +
      ` ${count((r) => r.moderation_status === "blocked")} blocked,` +
      ` ${count((r) => !r.is_approved)} hidden,` +
      ` ${count((r) => r.moderation_status === "pending")} awaiting the check`,
  ];
}
