// Dev seed: generate realistic fake products + orders for the TEST seller so the
// dashboard / orders / analytics surfaces have believable data to render.
//
//   pnpm seed            # random dataset
//   pnpm seed --seed 42  # reproducible dataset
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
import {
  createRng,
  generateOrders,
  generateProducts,
  randInt,
  type OrderInsert,
  type SeededProduct,
} from "./lib/fake-data.ts";

const DAYS = 90;
const INSERT_CHUNK = 500;

function resolveSeed(): number {
  const { values } = parseArgs({ options: { seed: { type: "string" } } });
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

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function main(): Promise<void> {
  const config = requireDevConfig();
  const supabase = createServiceClient(config);
  await assertTestSellerExists(supabase, config.testSellerId);

  const seed = resolveSeed();
  const rng = createRng(seed);

  // 1) Products for the test seller.
  const productCount = randInt(rng, 8, 15);
  const productDrafts = generateProducts(rng, config.testSellerId, productCount);
  const { data: insertedProducts, error: productError } = await supabase
    .from("products")
    .insert(productDrafts)
    .select("id, title, price_cents, currency, status");
  if (productError) fail(`Failed to insert products: ${productError.message}`);
  const products = (insertedProducts ?? []) as SeededProduct[];

  // 2) A storefront to attribute embed sales to (if the seller has one).
  const { data: storefronts, error: storefrontError } = await supabase
    .from("storefronts")
    .select("id")
    .eq("owner_id", config.testSellerId)
    .limit(1);
  if (storefrontError) fail(`Failed to read storefronts: ${storefrontError.message}`);
  const storefrontId = (storefronts?.[0]?.id as string | undefined) ?? null;

  // 3) Orders across the last ~90 days with a realistic distribution.
  const targetTotal = randInt(rng, 150, 300);
  const orders = generateOrders(rng, {
    sellerId: config.testSellerId,
    storefrontId,
    products,
    now: new Date(),
    days: DAYS,
    targetTotal,
  });

  for (let i = 0; i < orders.length; i += INSERT_CHUNK) {
    const chunk = orders.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from("orders").insert(chunk);
    if (error) fail(`Failed to insert orders (chunk at ${i}): ${error.message}`);
  }

  printSummary({ seed, storefrontId, products: products.length, orders });
}

function printSummary(args: {
  seed: number;
  storefrontId: string | null;
  products: number;
  orders: OrderInsert[];
}): void {
  const { seed, storefrontId, products, orders } = args;

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
  console.log("");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
