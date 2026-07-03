// Dev reset: delete ALL orders and products belonging to the TEST seller, via
// the service_role key. Scoped strictly to TEST_SELLER_ID and gated behind an
// explicit --yes so it can never wipe data by accident.
//
//   pnpm reset-seed --yes
//
// Same prod guard as the seed script (see scripts/lib/env.ts): it will refuse
// to run unless SEED_ENV=dev.

import { parseArgs } from "node:util";
import { createServiceClient, fail, requireDevConfig } from "./lib/env.ts";

async function deleteAllFor(
  supabase: ReturnType<typeof createServiceClient>,
  table: "orders" | "products",
  column: "seller_id" | "owner_id",
  testSellerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(column, testSellerId)
    .select("id");
  if (error) fail(`Failed to delete from ${table}: ${error.message}`);
  return data?.length ?? 0;
}

async function countFor(
  supabase: ReturnType<typeof createServiceClient>,
  table: "orders" | "products",
  column: "seller_id" | "owner_id",
  testSellerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, testSellerId);
  if (error) fail(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  if (!values.yes) {
    fail(
      "Refusing to reset without confirmation.\n" +
        "  This deletes ALL orders and products for TEST_SELLER_ID. Re-run with --yes:\n" +
        "    pnpm reset-seed --yes",
    );
  }

  const config = requireDevConfig();
  const supabase = createServiceClient(config);

  // Orders first (they reference products), then the products themselves.
  const ordersDeleted = await deleteAllFor(supabase, "orders", "seller_id", config.testSellerId);
  const productsDeleted = await deleteAllFor(
    supabase,
    "products",
    "owner_id",
    config.testSellerId,
  );

  // Confirm the test account is clean.
  const ordersLeft = await countFor(supabase, "orders", "seller_id", config.testSellerId);
  const productsLeft = await countFor(supabase, "products", "owner_id", config.testSellerId);

  console.log("\n✔ Reset complete");
  console.log(`  Test seller           ${config.testSellerId}`);
  console.log(`  Orders deleted        ${ordersDeleted}`);
  console.log(`  Products deleted      ${productsDeleted}`);
  console.log(`  Remaining (orders)    ${ordersLeft}`);
  console.log(`  Remaining (products)  ${productsLeft}`);
  if (ordersLeft === 0 && productsLeft === 0) {
    console.log("  ✓ Test account is clean.\n");
  } else {
    console.log("  ! Some rows remain — check for non-seed data on this account.\n");
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
