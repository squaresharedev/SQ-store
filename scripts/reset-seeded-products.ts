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

  console.log(`\n✔ Deleted ${productCount ?? 0} product(s) and ${orderCount ?? 0} order(s).\n`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
