// Mirror every catalogue product photo into this project's own Supabase
// Storage bucket, and rewrite scripts/lib/catalog.ts to point at the
// hosted copies.
//
//   pnpm mirror-catalog-images
//
// WHY MIRROR RATHER THAN HOTLINK. The catalogue is built from third-party
// hosts, and hotlinking them into the app has three problems:
//
//   1. Wikimedia rate-limits automated access hard (429), so drone tiles can
//      fail to load in bursts and the image checker cannot verify them.
//   2. Neither cdn.dummyjson.com nor upload.wikimedia.org is in the app's CSP
//      `img-src` allowlist (next.config.ts). That policy is Report-Only today,
//      so the images still render, but the moment it is switched to enforcing
//      every seeded product tile would go blank.
//   3. A demo store should not break because someone else's CDN moved a file.
//
// The Supabase project origin IS already in `img-src`, so a mirrored image is
// both allowlisted and ours. Re-run after `pnpm build-catalog`.
//
// Same prod guard as the seed script (scripts/lib/env.ts): SEED_ENV must be dev.

import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { createServiceClient, fail, requireDevConfig } from "./lib/env.ts";
import { PRODUCT_THEMES, type CatalogProduct } from "./lib/fake-data.ts";

const BUCKET = "seed-assets";
const USER_AGENT = "SquareshareDevSeed/1.0 (catalogue mirror; dev tooling)";

/** Square output edge, in px. 2x the ~300px tile the products grid renders. */
const FRAME = 600;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Download one image, backing off through the 429s Wikimedia hands out. */
async function download(url: string): Promise<{ body: Uint8Array; contentType: string }> {
  let delay = 500;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (response.ok) {
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "image/jpeg",
      };
    }
    if (response.status !== 429 || attempt >= 5) {
      throw new Error(`${response.status} for ${url}`);
    }
    await sleep(delay);
    delay *= 2;
  }
}

/** Stable, filesystem-safe object name for a product. */
function objectName(themeKey: string, product: CatalogProduct): string {
  const slug = product.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Always .jpg: normalise() re-encodes every shot as JPEG,
  // and the STYLE_VERSION segment busts Supabase's CDN cache when the look
  // changes, which upserting the same path would not.
  return `${STYLE_VERSION}/${themeKey}/${slug}.jpg`;
}

/** Bump when the photography styles change, so restyled files get fresh URLs. */
const STYLE_VERSION = "c1";

/**
 * Normalise one product shot to a square JPEG, in a headless browser.
 *
 * NO COMPOSITING HAPPENS HERE ANY MORE. An earlier version pasted transparent
 * product cut-outs onto a per-theme background to fake a consistent shoot. The
 * catalogue's photography is now generated already lit and already on its
 * collection's backdrop (see each theme's photoStyle.prompt), which is both
 * more convincing and far simpler — the ground, the shadow and the subject all
 * agree because they were rendered together.
 *
 * What remains is housekeeping: square every tile to the same edge, and encode
 * as JPEG. These are photographs with no transparency, so PNG would multiply
 * the page weight for nothing.
 */
async function normalise(browser: Browser, imageDataUrl: string): Promise<Buffer> {
  const page = await browser.newPage({
    viewport: { width: FRAME, height: FRAME },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(
      `<body style="margin:0;width:${FRAME}px;height:${FRAME}px;overflow:hidden">
         <img src="${imageDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block">
       </body>`,
    );
    await page.waitForLoadState("networkidle");
    return await page.screenshot({ type: "jpeg", quality: 86 });
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const config = requireDevConfig();
  const supabase = createServiceClient(config);

  // Public bucket: product photos are shown on public storefronts, and these
  // are stock images with no private content. createBucket is idempotent here
  // because an "already exists" error is expected on re-runs.
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (bucketError && !/exist/i.test(bucketError.message)) {
    fail(`Failed to create bucket "${BUCKET}": ${bucketError.message}`);
  }

  const rewrites = new Map<string, string>();
  let done = 0;
  let skipped = 0;

  const browser = await chromium.launch();
  try {
    for (const theme of PRODUCT_THEMES) {
      console.log(`\n${theme.label} — ${theme.photoStyle.name}`);
      for (const product of theme.products) {
        const source = product.imageUrl;
        // Already mirrored at the current style version (re-run after a partial
        // pass). A style bump changes STYLE_VERSION, so those are redone.
        if (source.includes(`/${BUCKET}/${STYLE_VERSION}/`)) {
          skipped += 1;
          continue;
        }
        const name = objectName(theme.key, product);
        try {
          const { body, contentType } = await download(source);
          const dataUrl = `data:${contentType};base64,${Buffer.from(body).toString("base64")}`;
          const styled = await normalise(browser, dataUrl);
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(name, styled, { contentType: "image/jpeg", upsert: true });
          if (error) throw new Error(error.message);
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
          rewrites.set(source, data.publicUrl);
          done += 1;
          console.log(`  ok   ${product.title}`);
        } catch (error) {
          console.error(`  FAIL ${product.title}: ${String(error)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (rewrites.size > 0) {
    const path = new URL("./lib/catalog.ts", import.meta.url);
    let source = readFileSync(path, "utf8");
    for (const [from, to] of rewrites) source = source.split(from).join(to);
    writeFileSync(path, source);
  }

  console.log(`\n✔ Mirrored ${done} image(s), ${skipped} already hosted.`);
  console.log(`  Bucket: ${BUCKET} (public)\n`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
