// Dev seed, reviews only: add a batch of reviews to the TEST seller's
// existing products and still-unreviewed paid orders, for a store that was
// seeded before reviews existed (a fresh `pnpm seed` writes them itself).
//
//   pnpm seed-reviews                # random batch
//   pnpm seed-reviews --seed 42      # reproducible batch
//
// What a batch carries is described in lib/fake-reviews.ts. Safe to run
// repeatedly (each run adds a batch); `pnpm reset-seed --yes` clears them with
// the products. Same prod guard as the seed script (see scripts/lib/env.ts).

import { parseArgs } from "node:util";
import { assertTestSellerExists, createServiceClient, fail, requireDevConfig } from "./lib/env.ts";
import { createRng } from "./lib/fake-data.ts";
import { reviewSummaryLines, seedReviews } from "./lib/fake-reviews.ts";

function resolveSeed(): number {
  const { values } = parseArgs({ options: { seed: { type: "string" } } });
  if (values.seed === undefined) return Math.floor(Math.random() * 0xffffffff);
  const parsed = Number(values.seed);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`--seed must be a non-negative integer (got "${values.seed}").`);
  return parsed;
}

async function main(): Promise<void> {
  const config = requireDevConfig();
  const supabase = createServiceClient(config);
  await assertTestSellerExists(supabase, config.testSellerId);

  const seed = resolveSeed();
  const batch = await seedReviews(supabase, config.testSellerId, createRng(seed));

  console.log("\n✔ Reviews seeded");
  console.log(`  Seed (reproduce with) --seed ${seed}`);
  for (const line of reviewSummaryLines(batch)) console.log(line);
  console.log("  Open /products/reviews to moderate them.\n");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
