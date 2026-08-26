// Verify every product photo in the seed catalogue still loads.
//
//   pnpm check-catalog-images
//
// WHY THIS EXISTS. The catalogue in scripts/lib/catalog.generated.ts hotlinks
// product photos from third-party hosts (cdn.dummyjson.com, Wikimedia Commons).
// A moved or withdrawn file turns into a broken tile on the products page and
// on every storefront that lists it, and nothing else in the test suite would
// notice: this is a live network property, not a pure function.
//
// Run it after `pnpm build-catalog`, or whenever product tiles look wrong.
// Exits non-zero if anything is broken so it can be wired into CI.
//
// No dev/prod guard needed: it reads nothing and writes nothing.

import { PRODUCT_THEMES } from "./lib/fake-data.ts";

/**
 * Wikimedia BLOCKS requests without a descriptive User-Agent and rate-limits
 * bursts with 429. Both failure modes look exactly like a dead image in the
 * report, so send a real UA and keep concurrency low — a 429 here would
 * otherwise send you hunting for a broken URL that is perfectly fine.
 */
const USER_AGENT = "SquareshareDevSeed/1.0 (catalogue image check; dev tooling)";
const CONCURRENCY = 4;
const RETRIES = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one photo, retrying through 429s with exponential backoff.
 *
 * Wikimedia throttles automated bursts hard enough that a straight pass over
 * this catalogue reports most drone photos as broken while a browser loads all
 * of them without complaint. Reporting a throttled request as a dead image
 * sends you looking for a bug that is not there, so treat 429 as "wait", not
 * as a verdict, and only give up after several attempts.
 */
async function status(url: string): Promise<number> {
  let delay = 500;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // GET, not HEAD: some CDNs answer HEAD with 405 while serving GET fine.
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.status !== 429 || attempt >= RETRIES) return response.status;
    } catch {
      if (attempt >= RETRIES) return 0; // network failure
    }
    await sleep(delay);
    delay *= 2;
  }
}

/** Map over items with a bounded number of in-flight requests. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const checks = PRODUCT_THEMES.flatMap((theme) =>
    theme.products.map((product) => ({ theme: theme.label, product })),
  );

  const results = await mapLimit(checks, CONCURRENCY, async (check) => ({
    ...check,
    code: await status(check.product.imageUrl),
  }));

  const broken = results.filter((r) => r.code !== 200);

  for (const theme of PRODUCT_THEMES) {
    const rows = results.filter((r) => r.theme === theme.label);
    const bad = rows.filter((r) => r.code !== 200).length;
    const mark = bad === 0 ? "ok  " : "FAIL";
    console.log(`  ${mark} ${theme.label.padEnd(16)} ${String(rows.length).padStart(3)} photos, ${bad} broken`);
  }

  if (broken.length > 0) {
    console.error(`\n✖ ${broken.length} of ${results.length} product photo(s) do not load:\n`);
    for (const b of broken) {
      console.error(`   ${String(b.code).padEnd(4)} ${b.product.title}`);
      console.error(`        ${b.product.imageUrl}`);
    }
    console.error(`\n  Fix by re-running \`pnpm build-catalog\`, or by replacing the URL in\n  scripts/lib/catalog.generated.ts (drones are hand-curated in build-catalog.ts).\n`);
    process.exit(1);
  }

  console.log(`\n✔ All ${results.length} product photos load.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
