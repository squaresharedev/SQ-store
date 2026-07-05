// Dev-only smoke test for the stock decrement path.
//
// Tests atomic concurrent decrements via the decrement_stock DB function and
// verifies that the function correctly rejects decrements on untracked products.
//
// Usage (matches seed.ts invocation style):
//   pnpm stock-smoke
//   node --env-file-if-exists=.env.local scripts/stock-smoke.ts
//
// Requirements: SEED_ENV=dev, NEXT_PUBLIC_SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY, TEST_SELLER_ID (see scripts/lib/env.ts).

import {
  assertTestSellerExists,
  createServiceClient,
  fail,
  requireDevConfig,
} from "./lib/env.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// Scripts are standalone (no "@/" tsconfig aliases, per this folder's
// convention), so the app wrapper src/lib/stock/decrement.ts cannot be
// imported here. This local twin exercises the SAME decrement_stock RPC with
// the same result mapping; the wrapper adds only Zod arg validation on top.
type DecrementResult =
  | { ok: true }
  | { ok: false; reason: "insufficient_stock" | "error" };

async function decrementStock(
  client: SupabaseClient,
  productId: string,
  quantity: number,
): Promise<DecrementResult> {
  const { data, error } = await client.rpc("decrement_stock", {
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error) {
    console.error("  decrement_stock RPC failed:", error.message);
    return { ok: false, reason: "error" };
  }
  return data === true ? { ok: true } : { ok: false, reason: "insufficient_stock" };
}

const INITIAL_QTY = 5;
const CONCURRENCY = 10;
const LOW_STOCK_THRESHOLD = 5;

async function main(): Promise<void> {
  const config = requireDevConfig();
  const supabase = createServiceClient(config);
  await assertTestSellerExists(supabase, config.testSellerId);

  // ── 1. Create a test product with stock tracking enabled ─────────────────
  const { data: product, error: insertError } = await supabase
    .from("products")
    .insert({
      owner_id: config.testSellerId,
      title: "[stock-smoke] test product",
      price_cents: 100,
      currency: "EUR",
      status: "draft",
      track_stock: true,
      stock_quantity: INITIAL_QTY,
      low_stock_threshold: LOW_STOCK_THRESHOLD,
    })
    .select("id")
    .single();

  if (insertError || !product) {
    fail(`Failed to create test product: ${insertError?.message ?? "no row returned"}`);
  }
  const productId = product.id;
  console.log(`\n  Created test product ${productId} (qty=${INITIAL_QTY})`);

  // ── 2. Create an untracked product for the guard test ────────────────────
  const { data: untrackedProduct, error: untrackedInsertError } = await supabase
    .from("products")
    .insert({
      owner_id: config.testSellerId,
      title: "[stock-smoke] untracked product",
      price_cents: 100,
      currency: "EUR",
      status: "draft",
      track_stock: false,
      stock_quantity: null,
    })
    .select("id")
    .single();

  if (untrackedInsertError || !untrackedProduct) {
    // Clean up tracked product before failing.
    await supabase.from("products").delete().eq("id", productId);
    fail(
      `Failed to create untracked product: ${untrackedInsertError?.message ?? "no row returned"}`,
    );
  }
  const untrackedId = untrackedProduct.id;
  console.log(`  Created untracked product ${untrackedId}`);

  let passed = true;
  const failures: string[] = [];

  try {
    // ── 3. Fire CONCURRENCY concurrent decrements (qty=1 each) ──────────────
    console.log(`\n  Firing ${CONCURRENCY} concurrent decrement(qty=1) calls...`);
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        decrementStock(supabase, productId, 1),
      ),
    );

    const successes = results.filter((r) => r.ok).length;
    const insufficient = results.filter(
      (r) => !r.ok && r.reason === "insufficient_stock",
    ).length;
    const errors = results.filter(
      (r) => !r.ok && r.reason === "error",
    ).length;

    console.log(
      `    ok=${successes}  insufficient_stock=${insufficient}  error=${errors}`,
    );

    if (successes !== INITIAL_QTY) {
      failures.push(
        `Expected ${INITIAL_QTY} successes, got ${successes}`,
      );
      passed = false;
    }
    if (insufficient !== CONCURRENCY - INITIAL_QTY) {
      failures.push(
        `Expected ${CONCURRENCY - INITIAL_QTY} insufficient_stock, got ${insufficient}`,
      );
      passed = false;
    }
    if (errors !== 0) {
      failures.push(`Expected 0 errors, got ${errors}`);
      passed = false;
    }

    // ── 4. Assert final stock_quantity is 0 and not negative ────────────────
    const { data: finalRow, error: readError } = await supabase
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .single();

    if (readError || !finalRow) {
      failures.push(`Failed to read final stock row: ${readError?.message ?? "no row"}`);
      passed = false;
    } else {
      console.log(`\n  Final stock_quantity=${finalRow.stock_quantity}`);
      if (finalRow.stock_quantity !== 0) {
        failures.push(
          `Expected final stock_quantity=0, got ${finalRow.stock_quantity}`,
        );
        passed = false;
      }
      if (typeof finalRow.stock_quantity === "number" && finalRow.stock_quantity < 0) {
        failures.push("stock_quantity went NEGATIVE — atomicity violation!");
        passed = false;
      }
    }

    // ── 5. Assert decrement on an untracked product returns insufficient_stock
    console.log("\n  Testing decrement on untracked product...");
    const untrackedResult = await decrementStock(supabase, untrackedId, 1);
    if (untrackedResult.ok || untrackedResult.reason !== "insufficient_stock") {
      failures.push(
        `Expected insufficient_stock for untracked product, got: ${JSON.stringify(untrackedResult)}`,
      );
      passed = false;
    } else {
      console.log("    Correctly returned insufficient_stock");
    }
  } finally {
    // ── 6. Clean up both products ────────────────────────────────────────────
    console.log("\n  Cleaning up test products...");
    const { error: del1 } = await supabase
      .from("products")
      .delete()
      .eq("id", productId);
    const { error: del2 } = await supabase
      .from("products")
      .delete()
      .eq("id", untrackedId);
    if (del1) console.warn(`  Warning: failed to delete tracked product: ${del1.message}`);
    if (del2) console.warn(`  Warning: failed to delete untracked product: ${del2.message}`);
  }

  // ── 7. Print summary and exit ────────────────────────────────────────────
  if (passed) {
    console.log("\n  PASS — all assertions satisfied\n");
    process.exit(0);
  } else {
    console.error("\n  FAIL — the following assertions failed:");
    for (const f of failures) {
      console.error(`    • ${f}`);
    }
    console.error("");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
