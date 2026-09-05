// Dev seed: generate realistic fake products, orders AND storefront signals
// (views, clicks) for the TEST seller so the dashboard / orders / analytics
// surfaces have believable data to render.
//
//   pnpm seed                        # random dataset, random category
//   pnpm seed --seed 42              # reproducible dataset
//   pnpm seed --theme drones         # pin the catalogue's category
//   pnpm seed --storefront <uuid>    # attribute to, and fill in, one store
//
// WHAT A SEEDED PRODUCT PAGE CARRIES. The point is that a demo page looks like
// a page a real seller filled in, because an empty section is the one thing
// nobody reviews. So besides the catalogue itself the seed writes:
//
//   - option groups, dimensions, weight, materials, care, what is in the box,
//     specifications, country of origin and a compliance block (per product),
//   - real one-page PDFs in the public bucket, linked as the product's
//     documents, so the Documents section opens rather than 404s,
//   - inventory, spread across healthy / low / sold out / untracked so every
//     availability state the page can render actually occurs somewhere,
//   - the shipping and returns policies and the trader identity, which live on
//     the STOREFRONT rather than the product and were the reason a seeded page
//     still said "the seller has not added shipping details yet",
//   - product tiles, but only onto a board with none, because a product page
//     exists only for a product placed on the storefront.
//
// Everything at storefront level is filled ONLY when absent: a board or a
// policy the seller wrote is theirs, and the seed never overwrites it.
//
// Collections: furniture-brutalist, furniture-cozy, tech, fashion, drones
// (see lib/catalog.ts). Each is one design language shot one way, so a seeded
// store reads as a single shop rather than a stock-photo grab bag.
//
// Storefront views and product clicks are seeded ONLY when the test seller
// already has a storefront (a fresh account gets none, same as production —
// there is no embed widget to serve views through without one), and only for
// the two signal kinds with a real ingest path today. See generateSignals in
// lib/fake-data.ts.
//
// Safe to run repeatedly (each run adds a batch). Use `pnpm reset-seed --yes`
// to clear. Guarded so it can only run against an opted-in dev target — see
// scripts/lib/env.ts.

import { parseArgs } from "node:util";
import {
  assertTestSellerExists,
  createServiceClient,
  fail,
  requireDevConfig,
} from "./lib/env.ts";
import { buildDemoPdf } from "./lib/pdf.ts";
import {
  createRng,
  documentAssets,
  generateOrders,
  generateProducts,
  generateSignals,
  pickTheme,
  randInt,
  storeFactsFor,
  THEME_KEYS,
  themeByKey,
  type OrderInsert,
  type ProductTheme,
  type SeededProduct,
  type SignalInsert,
} from "./lib/fake-data.ts";

const DAYS = 90;
const INSERT_CHUNK = 500;

const OPTIONS = {
  seed: { type: "string" },
  theme: { type: "string" },
  storefront: { type: "string" },
} as const;

/**
 * Which storefront this run attributes to and fills in.
 *
 * `--storefront <id>` names one. Without it the OLDEST is used, which matters
 * only because the previous behaviour was `.limit(1)` with no order: the
 * database was free to return a different row each run, so a seller with
 * several storefronts got their orders attributed to an arbitrary one and
 * could not tell which. Oldest-first is not a better guess, it is simply a
 * STABLE one, and repeat runs now land in the same place.
 */
function resolveStorefrontFilter(): string | null {
  const { values } = parseArgs({ options: OPTIONS });
  return values.storefront ?? null;
}

function resolveSeed(): number {
  const { values } = parseArgs({ options: OPTIONS });
  if (values.seed === undefined) {
    // No --seed: pick a random one and print it so the run can be reproduced.
    return Math.floor(Math.random() * 0xffffffff);
  }
  const parsed = Number(values.seed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`--seed must be a non-negative integer (got "${values.seed}").`);
  }
  return parsed;
}

/**
 * The one category the whole catalogue is drawn from. `--theme <key>` pins it;
 * without the flag one is picked at random from the seeded RNG, so a plain
 * `pnpm seed` still reproduces exactly under `--seed`.
 */
function resolveTheme(rng: Parameters<typeof pickTheme>[0]): ProductTheme {
  const { values } = parseArgs({ options: OPTIONS });
  if (values.theme === undefined) return pickTheme(rng);
  const theme = themeByKey(values.theme);
  if (!theme) {
    fail(`--theme must be one of: ${THEME_KEYS.join(", ")} (got "${values.theme}").`);
  }
  return theme;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The public bucket the seed's own assets live in, shared with the catalogue
 *  photography that scripts/mirror-catalog-images.ts uploads. */
const ASSET_BUCKET = "seed-assets";

/**
 * Put every demo document in the public bucket, once.
 *
 * IDEMPOTENT BY DESIGN: the seed is meant to be run repeatedly, and these
 * files never change between runs, so an object that already exists is left
 * alone rather than re-uploaded. Returns how many were newly written, purely
 * so the summary can say something true.
 *
 * A failure here is not fatal. The documents are the least important thing the
 * seed produces, and losing a demo PDF is not worth aborting a run that would
 * otherwise give the dashboard its products, orders and signals.
 */
async function uploadSeedDocuments(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<number> {
  const { error: bucketError } = await supabase.storage.createBucket(ASSET_BUCKET, {
    public: true,
  });
  if (bucketError && !/exist/i.test(bucketError.message)) {
    console.warn(`  ! Could not ensure bucket "${ASSET_BUCKET}": ${bucketError.message}`);
    return 0;
  }

  let written = 0;
  for (const asset of documentAssets()) {
    const body = buildDemoPdf(asset.label, asset.body);
    const { error } = await supabase.storage
      .from(ASSET_BUCKET)
      .upload(asset.path, body, { contentType: "application/pdf", upsert: false });
    if (!error) {
      written += 1;
      continue;
    }
    // "already exists" is the expected path on every run after the first.
    if (!/exist|duplicate/i.test(error.message)) {
      console.warn(`  ! Could not upload ${asset.path}: ${error.message}`);
    }
  }
  return written;
}

/**
 * Lay the ACTIVE products out on a board, two cells each, six columns wide.
 *
 * Drafts are skipped: a draft has no public page, so a tile for one would be a
 * dead link on the seller's own storefront. The arrangement is deliberately
 * plain, a straight grid in catalogue order, because the seed's job is to give
 * the seller something to edit rather than a design to argue with.
 */
function productTiles(products: readonly SeededProduct[]): unknown[] {
  const COLUMNS = 6;
  const SIZE = 2;
  const perRow = Math.floor(COLUMNS / SIZE);
  return products
    .filter((product) => product.status === "active")
    .map((product, index) => ({
      type: "product",
      productId: product.id,
      x: (index % perRow) * SIZE,
      y: Math.floor(index / perRow) * SIZE,
      w: SIZE,
      h: SIZE,
    }));
}

/**
 * Fill in the STORE-LEVEL facts a product page reads: the shipping and returns
 * policies, and the trader identity.
 *
 * These live on the storefront config rather than on a product, which is why a
 * seeded store used to have complete-looking products whose pages still showed
 * "the seller has not added shipping details yet" and an empty Seller section.
 *
 * NON-DESTRUCTIVE, and that is the whole design of this function. The seller's
 * storefront is something they designed by hand; the seed has no business
 * touching their theme, their blocks or a policy they already wrote. It fills
 * ONLY the members that are absent, and reports which ones it added.
 */
async function fillStoreFacts(
  supabase: ReturnType<typeof createServiceClient>,
  storefrontId: string,
  rawConfig: unknown,
  theme: ProductTheme,
  products: readonly SeededProduct[],
): Promise<string[]> {
  if (typeof rawConfig !== "object" || rawConfig === null) return [];
  const config = rawConfig as Record<string, unknown>;
  const facts = storeFactsFor(theme.key);
  const added: string[] = [];

  const next = { ...config };
  if (!config.policies) {
    next.policies = facts.policies;
    added.push("policies");
  }
  if (!config.seller) {
    next.seller = facts.seller;
    added.push("seller");
  }

  // TILES, but only onto a board that has none. A product page exists only for
  // a product PLACED on the storefront (see getPublicProductPage), so an empty
  // board means every seeded page 404s and the whole product-page surface is
  // invisible on a demo store. Placing them is therefore part of seeding a
  // storefront at all, not a design opinion.
  //
  // A board the seller has already arranged is left completely alone: their
  // layout is hand-made work, and this has nothing better to put there.
  const existingBlocks = Array.isArray(config.blocks) ? config.blocks : [];
  if (existingBlocks.length === 0 && products.length > 0) {
    next.blocks = productTiles(products);
    added.push("tiles");
  }

  if (added.length === 0) return [];

  const { error } = await supabase
    .from("storefronts")
    .update({ config: next })
    .eq("id", storefrontId);
  if (error) {
    console.warn(`  ! Could not fill store facts: ${error.message}`);
    return [];
  }
  return added;
}

async function main(): Promise<void> {
  const config = requireDevConfig();
  const supabase = createServiceClient(config);
  await assertTestSellerExists(supabase, config.testSellerId);

  const seed = resolveSeed();
  const rng = createRng(seed);

  // 0) The demo documents every product page links to. Uploaded before the
  // products that reference them, so a page never renders a link to a file
  // that is not there yet. Idempotent: an existing object is left alone.
  const uploadedDocuments = await uploadSeedDocuments(supabase);

  // 1) Products for the test seller — one theme for the whole catalogue, so
  // the store reads as a real, specialised shop rather than a mixed bag.
  const theme = resolveTheme(rng);
  const productCount = randInt(rng, 8, 15);
  const productDrafts = generateProducts(
    rng,
    config.testSellerId,
    productCount,
    theme,
    config.url,
  );
  const { data: insertedProducts, error: productError } = await supabase
    .from("products")
    .insert(productDrafts)
    // option_groups comes back too: an order records which version was bought,
    // and this is where the seed learns what there was to pick from.
    .select("id, title, price_cents, currency, status, option_groups");
  if (productError) fail(`Failed to insert products: ${productError.message}`);
  const products = (insertedProducts ?? []) as SeededProduct[];

  // 2) A storefront to attribute embed sales to (if the seller has one), and
  // the store-level facts every product page reads off it.
  const wanted = resolveStorefrontFilter();
  let storefrontQuery = supabase
    .from("storefronts")
    .select("id, name, config")
    .eq("owner_id", config.testSellerId);
  if (wanted) storefrontQuery = storefrontQuery.eq("id", wanted);
  const { data: storefronts, error: storefrontError } = await storefrontQuery
    .order("created_at", { ascending: true })
    .limit(1);
  if (storefrontError) fail(`Failed to read storefronts: ${storefrontError.message}`);
  if (wanted && (storefronts?.length ?? 0) === 0) {
    fail(`No storefront ${wanted} belongs to the test seller.`);
  }
  const storefront = storefronts?.[0] as
    | { id: string; name: string; config: unknown }
    | undefined;
  const storefrontId = storefront?.id ?? null;
  const storeFactsFilled = storefront
    ? await fillStoreFacts(supabase, storefront.id, storefront.config, theme, products)
    : [];

  // 3) Orders across the last ~90 days with a realistic distribution.
  const now = new Date();
  const targetTotal = randInt(rng, 150, 300);
  const orders = generateOrders(rng, {
    sellerId: config.testSellerId,
    storefrontId,
    products,
    now,
    days: DAYS,
    targetTotal,
  });

  for (let i = 0; i < orders.length; i += INSERT_CHUNK) {
    const chunk = orders.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from("orders").insert(chunk);
    if (error) fail(`Failed to insert orders (chunk at ${i}): ${error.message}`);
  }

  // 4) Storefront views + product clicks over the SAME window, sized off the
  // embed orders just generated so the funnel (views > clicks > embed sales)
  // holds by construction. No storefront, no signals — see generateSignals.
  const embedOrderCount = orders.filter((o) => o.channel === "embed").length;
  const signals = generateSignals(rng, {
    accountId: config.testSellerId,
    storefrontId,
    products,
    now,
    days: DAYS,
    embedOrderCount,
  });

  for (let i = 0; i < signals.length; i += INSERT_CHUNK) {
    const chunk = signals.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from("storefront_signals").insert(chunk);
    if (error) fail(`Failed to insert signals (chunk at ${i}): ${error.message}`);
  }

  printSummary({
    seed,
    theme: theme.label,
    storefrontId,
    products: products.length,
    orders,
    signals,
    uploadedDocuments,
    storeFactsFilled,
  });
}

function printSummary(args: {
  seed: number;
  theme: string;
  storefrontId: string | null;
  products: number;
  orders: OrderInsert[];
  signals: SignalInsert[];
  uploadedDocuments: number;
  storeFactsFilled: string[];
}): void {
  const { seed, theme, storefrontId, products, orders, signals } = args;
  const { uploadedDocuments, storeFactsFilled } = args;

  const byStatus = new Map<string, number>();
  const byChannel = new Map<string, number>();
  const paidGrossByCurrency = new Map<string, number>();
  const feesByCurrency = new Map<string, number>();
  let minDate = Infinity;
  let maxDate = -Infinity;

  for (const order of orders) {
    byStatus.set(order.status, (byStatus.get(order.status) ?? 0) + 1);
    byChannel.set(order.channel, (byChannel.get(order.channel) ?? 0) + 1);
    if (order.status === "paid") {
      paidGrossByCurrency.set(
        order.currency,
        (paidGrossByCurrency.get(order.currency) ?? 0) + order.amount_cents,
      );
      feesByCurrency.set(
        order.currency,
        (feesByCurrency.get(order.currency) ?? 0) + order.platform_fee_cents,
      );
    }
    const t = Date.parse(order.created_at);
    if (t < minDate) minDate = t;
    if (t > maxDate) maxDate = t;
  }

  const line = (label: string, value: string): string => `  ${label.padEnd(22)}${value}`;
  const money = (m: Map<string, number>): string =>
    m.size === 0
      ? "—"
      : [...m.entries()].map(([cur, cents]) => `${formatCents(cents)} ${cur}`).join(", ");

  console.log("\n✔ Seed complete");
  console.log(line("Seed (reproduce with)", `--seed ${seed}`));
  console.log(line("Store theme", theme));
  console.log(line("Products created", String(products)));
  console.log(line("Orders created", String(orders.length)));
  console.log(
    line(
      "Date range",
      orders.length
        ? `${new Date(minDate).toISOString().slice(0, 10)} → ${new Date(maxDate)
            .toISOString()
            .slice(0, 10)}`
        : "—",
    ),
  );
  console.log(
    line(
      "Status split",
      [...byStatus.entries()].map(([s, n]) => `${s}:${n}`).join("  ") || "—",
    ),
  );
  console.log(
    line(
      "Channel split",
      [...byChannel.entries()].map(([c, n]) => `${c}:${n}`).join("  ") || "—",
    ),
  );
  console.log(line("Paid gross revenue", money(paidGrossByCurrency)));
  console.log(line("Platform fees (paid)", money(feesByCurrency)));
  console.log(line("Storefront attributed", storefrontId ?? "none (all embed orders null)"));
  console.log(
    line(
      "Demo documents",
      uploadedDocuments === 0 ? "already uploaded" : `${uploadedDocuments} uploaded`,
    ),
  );
  console.log(
    line(
      "Store facts",
      storefrontId === null
        ? "skipped (no storefront)"
        : storeFactsFilled.length === 0
          ? "already set (left alone)"
          : `added ${storeFactsFilled.join(" + ")}`,
    ),
  );

  if (storefrontId === null) {
    console.log(line("Storefront signals", "none (no storefront to attribute views to)"));
  } else {
    const byKind = new Map<string, number>();
    const visitors = new Set<string>();
    for (const signal of signals) {
      byKind.set(signal.kind, (byKind.get(signal.kind) ?? 0) + 1);
      visitors.add(signal.visitor_hash);
    }
    const views = byKind.get("storefront_view") ?? 0;
    const clicks = byKind.get("product_click") ?? 0;
    console.log(
      line(
        "Storefront signals",
        `${views} view${views === 1 ? "" : "s"}, ${clicks} click${clicks === 1 ? "" : "s"}`,
      ),
    );
    console.log(line("Distinct visitors", String(visitors.size)));
  }
  console.log("");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
