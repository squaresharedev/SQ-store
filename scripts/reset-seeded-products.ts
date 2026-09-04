// Dev cleanup: delete the SEED-GENERATED products for the test seller (and the
// orders attached to them), leaving anything you created in the app untouched.
//
//   pnpm reset-seeded-products            # dry run: prints the plan, deletes nothing
//   pnpm reset-seeded-products --yes      # actually delete
//
// Typical use is to re-theme a demo store without losing your own work:
//
//   pnpm reset-seeded-products --yes && pnpm seed --theme furniture
//
// HOW "SEED-GENERATED" IS DECIDED, and why it is safe. A seeded product stores
// a full external stock-photo URL in image_key (see lib/fake-data.ts); a
// product created through the app stores an R2 object key of the form
// `images/<uuid>/<uuid>-<name>`, because every app write validates image_key
// against OBJECT_KEY_PATTERN (src/lib/validation/product.ts) and a URL can
// never survive it. Only the service_role seed scripts can put a URL there, so
// keying on that prefix cannot delete something you uploaded.
//
// This deliberately does NOT match on the title pattern. Seed titles look like
// "<Prefix> <Noun>" ("Oakford Sofa"), which is also a perfectly ordinary thing
// for a real product to be called — matching on it would delete your rows.
//
// Same prod guard as the seed script (scripts/lib/env.ts): SEED_ENV must be dev.

import { parseArgs } from "node:util";
import { createServiceClient, fail, requireDevConfig } from "./lib/env.ts";

/** Marks a row the seed script wrote. See the header for why this is safe. */
const SEEDED_IMAGE_PREFIX = "https://";

async function main(): Promise<void> {
  const config = requireDevConfig();
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  const confirmed = values.yes === true;

  const supabase = createServiceClient(config);

  const { data: products, error } = await supabase
    .from("products")
    .select("id, title, image_key")
    .eq("owner_id", config.testSellerId);
  if (error) fail(`Failed to fetch products: ${error.message}`);

  const rows = products ?? [];
  const seeded = rows.filter((p) => (p.image_key ?? "").startsWith(SEEDED_IMAGE_PREFIX));
  const kept = rows.filter((p) => !(p.image_key ?? "").startsWith(SEEDED_IMAGE_PREFIX));

  console.log(`\nKeeping ${kept.length} product(s) you created:`);
  for (const p of kept) console.log(`  keep    ${p.title}`);
  console.log(`\nDeleting ${seeded.length} seed-generated product(s):`);
  for (const p of seeded) console.log(`  delete  ${p.title}`);

  if (seeded.length === 0) {
    console.log("\nNothing to do.\n");
    return;
  }

  if (!confirmed) {
    console.log(`\nDry run — nothing was deleted. Re-run with --yes to apply.\n`);
    return;
  }

  const ids = seeded.map((p) => p.id);

  // Orders first: orders.product_id is ON DELETE SET NULL, so deleting the
  // products alone would strand their order rows as un-attributable revenue
  // that still counts toward every analytics total.
  const { error: orderErr, count: orderCount } = await supabase
    .from("orders")
    .delete({ count: "exact" })
    .in("product_id", ids);
  if (orderErr) fail(`Failed to delete orders: ${orderErr.message}`);

  const { error: productErr, count: productCount } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .in("id", ids);
  if (productErr) fail(`Failed to delete products: ${productErr.message}`);

  const prunedTiles = await pruneStorefrontTiles(supabase, config.testSellerId, new Set(ids));

  console.log(
    `\n✔ Deleted ${productCount ?? 0} product(s) and ${orderCount ?? 0} order(s)` +
      (prunedTiles > 0 ? `, and removed ${prunedTiles} storefront tile(s).` : ".") +
      "\n",
  );
}

/**
 * Take the deleted products' tiles off every storefront.
 *
 * Without this a reset leaves the seller's board pointing at rows that no
 * longer exist. Nothing crashes (the editor drops a tile whose product it
 * cannot find, and the public storefront skips it), but the board silently
 * carries dead cells, the next seed sees a NON-empty board and so declines to
 * lay out the new catalogue, and the store ends up looking broken for a reason
 * that is invisible in the UI.
 *
 * Only PRODUCT blocks naming a deleted id are removed. Text, shapes and images
 * are the seller's own work and are left exactly where they are, as is any
 * product tile pointing at a product this reset kept.
 */
async function pruneStorefrontTiles(
  supabase: ReturnType<typeof createServiceClient>,
  ownerId: string,
  deleted: ReadonlySet<string>,
): Promise<number> {
  const { data: storefronts, error } = await supabase
    .from("storefronts")
    .select("id, config")
    .eq("owner_id", ownerId);
  if (error) {
    console.warn(`  ! Could not read storefronts to prune tiles: ${error.message}`);
    return 0;
  }

  let removed = 0;
  for (const storefront of storefronts ?? []) {
    const config = storefront.config;
    if (typeof config !== "object" || config === null) continue;
    const blocks = (config as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) continue;

    const kept = blocks.filter((block) => {
      if (typeof block !== "object" || block === null) return true;
      const candidate = block as { type?: unknown; productId?: unknown };
      if (candidate.type !== "product") return true;
      return !deleted.has(String(candidate.productId));
    });
    if (kept.length === blocks.length) continue;

    const { error: updateError } = await supabase
      .from("storefronts")
      .update({ config: { ...(config as object), blocks: kept } })
      .eq("id", storefront.id);
    if (updateError) {
      console.warn(`  ! Could not prune tiles on ${storefront.id}: ${updateError.message}`);
      continue;
    }
    removed += blocks.length - kept.length;
  }
  return removed;
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
