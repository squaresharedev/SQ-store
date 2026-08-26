// Restore the catalogue photo on seeded products whose image is missing or
// stale.
//
//   pnpm tsx scripts/update-product-images.ts [--user-id <id>]
//
// If no --user-id is provided, updates products for the TEST seller.
//
// Matching is by EXACT TITLE against the seed catalogue
// (scripts/lib/catalog.generated.ts), so each product gets back its own
// photograph rather than a generic themed one. Products you created in the app
// are not in that catalogue, so they are skipped and never touched.

import { parseArgs } from "node:util";
import {
  createServiceClient,
  fail,
  requireDevConfig,
} from "./lib/env.ts";
import { findCatalogProduct } from "./lib/fake-data.ts";

async function main(): Promise<void> {
  const config = requireDevConfig();
  const { values } = parseArgs({ options: { "user-id": { type: "string" } } });
  const userId = values["user-id"] ?? config.testSellerId;

  const supabase = createServiceClient(config);

  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, title, image_key")
    .eq("owner_id", userId);

  if (fetchError) fail(`Failed to fetch products: ${fetchError.message}`);
  if (!products || products.length === 0) {
    console.log("No products found for this user.");
    return;
  }

  const updates: Array<{ id: string; image_key: string }> = [];

  for (const product of products) {
    const entry = findCatalogProduct(product.title);
    if (!entry) {
      console.log(`⚠ Skipping "${product.title}" — not a seed catalogue product`);
      continue;
    }
    if (product.image_key === entry.imageUrl) continue; // already correct
    updates.push({ id: product.id, image_key: entry.imageUrl });
  }

  if (updates.length === 0) {
    console.log("Every seeded product already has its catalogue photo.");
    return;
  }

  for (const update of updates) {
    const { error } = await supabase
      .from("products")
      .update({ image_key: update.image_key })
      .eq("id", update.id)
      .eq("owner_id", userId);

    if (error) {
      console.error(`Failed to update product ${update.id}: ${error.message}`);
    }
  }

  console.log(`\n✔ Updated ${updates.length} product image(s)`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
