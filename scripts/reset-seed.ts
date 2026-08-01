// Dev reset: delete ALL orders and products belonging to the TEST seller, via
// the service_role key. Scoped strictly to TEST_SELLER_ID and gated behind an
// explicit --yes so it can never wipe data by accident.
//
//   pnpm reset-seed --yes
//
// Same prod guard as the seed script (see scripts/lib/env.ts): it will refuse
// to run unless SEED_ENV=dev.
//
// INTERACTION WITH THE SALES SIMULATOR. If the pg_cron simulator is enabled for
// this seller (supabase/migrations/20260801_demo_sales_sim.sql), it keeps
// inserting orders every 20 minutes. A reset does not stop it, and it does not
// need to: with the products deleted the simulator finds an empty catalogue and
// inserts nothing, then picks straight back up once `pnpm seed` recreates them.
// The only visible effect is that a tick landing mid-reset can leave a handful
// of orders behind, which is what the "some rows remain" line below is about.
// To silence it entirely for the duration of a reset:
//
//   update demo.sales_sim set enabled = false where id;   -- then true again

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
    console.log(
      "  ! Some rows remain: either non-seed data on this account, or the sales\n" +
        "    simulator ticked mid-reset. Re-run to clear.\n",
    );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
