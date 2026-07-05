// Update existing products with stock photos from the STOCK_IMAGES pool.
//
//   pnpm tsx scripts/update-product-images.ts [--user-id <id>]
//
// If no --user-id is provided, updates products for the TEST seller.
// Replaces image_key for all products that have a placeholder key or are missing an image.

import { parseArgs } from "node:util";
import {
  createServiceClient,
  fail,
  requireDevConfig,
} from "./lib/env.ts";
import { createRng, pick, PRODUCT_TYPES } from "./lib/fake-data.ts";

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

async function main(): Promise<void> {
  const config = requireDevConfig();
  const { values } = parseArgs({ options: { "user-id": { type: "string" } } });
  const userId = values["user-id"] ?? config.testSellerId;

  const supabase = createServiceClient(config);

  // Fetch all products for the user
  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, title, image_key")
    .eq("owner_id", userId);

  if (fetchError) fail(`Failed to fetch products: ${fetchError.message}`);
  if (!products || products.length === 0) {
    console.log("No products found for this user.");
    return;
  }

  const rng = createRng(42); // Fixed seed for deterministic selection
  const updates: Array<{ id: string; image_key: string }> = [];

  for (const product of products) {
    // Extract product type from title (e.g., "Midnight Lightroom Preset Pack" -> "Lightroom Preset Pack")
    let productType = null;
    for (const type of PRODUCT_TYPES) {
      if (product.title.includes(type.noun)) {
        productType = type.noun;
        break;
      }
    }

    if (!productType) {
      console.log(`⚠ Skipping "${product.title}" — unknown product type`);
      continue;
    }

    const images = STOCK_IMAGES[productType as keyof typeof STOCK_IMAGES];
    const newImageKey = pick(rng, images);

    updates.push({
      id: product.id,
      image_key: newImageKey,
    });
  }

  if (updates.length === 0) {
    console.log("No products to update.");
    return;
  }

  // Batch update all products
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
