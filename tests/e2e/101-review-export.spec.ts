import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Response } from "@playwright/test";
import { downloadFrom, expectToast, freshUser, seedProducts, serviceRest, signUp, toast, userIdByEmail } from "./helpers";

/**
 * A SELLER TAKES THEIR REVIEWS AWAY IN A FILE. Through the real page, the real
 * route and the real database:
 *
 *   - the file holds the view on screen, every page of it: the tab, search,
 *     product filter and sort narrow and order it exactly as they do the list,
 *     and an empty view offers nothing to export;
 *   - what buyers typed cannot run as a formula, a review over several lines
 *     stays one cell, and published / held / hidden / pending are told apart;
 *   - the file stays small: it stops at 5,000 reviews or 4 MB, whichever
 *     comes first, and the page says the file is the first part of the view;
 *   - a teammate exports the store they are in, never their own beside it;
 *   - each member has a budget, the store has one across its team, and
 *     neither a signed-out caller nor a refusal produces a file;
 *   - the file read back on the import page is known as a Square Share export:
 *     everything already in the store says so, nothing is written, and another
 *     store's file adds nothing either.
 */

const EXPORT_PATH = "/api/sellers/export-reviews";
const HEADER =
  "review_id,review_date,product_title,product_id,rating,title,body,reviewer_name,verified_buyer,source,published,moderation_status,hidden_reason,moderation_ground,exported_from";
const MAX_ROWS = 5_000;
const MAX_BYTES = 4 * 1024 * 1024;

type SeedReview = {
  product: string;
  rating?: number;
  title?: string | null;
  body?: string;
  author?: string;
  /** Hours before now; later reviews in the list default to older. */
  hoursAgo?: number;
  moderation?: "pending" | "clean" | "held" | "blocked";
  ground?: string;
  hidden?: "spam" | "offensive" | "personal_info" | "unrelated";
  native?: boolean;
  verified?: boolean;
};

/** Reviews straight into the database: imported ones under one run, native ones without. */
async function seedReviews(sellerId: string, reviews: SeedReview[], chunk = 500) {
  const importId = randomUUID();
  await serviceRest("/review_imports", {
    method: "POST",
    body: { id: importId, seller_id: sellerId, source: "judgeme", file_name: "seed.csv", row_count: reviews.length, imported_count: reviews.length, skipped_count: 0 },
  });
  const now = Date.now();
  for (let start = 0; start < reviews.length; start += chunk) {
    await serviceRest("/reviews", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: reviews.slice(start, start + chunk).map((review, offset) => ({
        product_id: review.product,
        import_id: review.native ? null : importId,
        source: review.native ? "native" : "judgeme",
        external_id: review.native ? null : `e2e:${randomUUID()}`,
        rating: review.rating ?? 5,
        title: review.title === undefined ? `Review ${start + offset}` : review.title,
        body: review.body ?? "Lovely.",
        author_name: review.author ?? "Ana",
        is_verified_buyer: review.verified ?? false,
        moderation_status: review.moderation ?? "clean",
        moderation_ground: review.ground ?? null,
        is_approved: !review.hidden,
        hidden_reason: review.hidden ?? null,
        reviewed_at: new Date(now - (review.hoursAgo ?? start + offset + 100) * 3_600_000).toISOString(),
      })),
    });
  }
}

/** The file as the export writes it: a byte-order mark, RFC 4180 cells, CRLF rows. */
function readCsv(text: string): { header: string; rows: Record<string, string>[] } {
  expect(text.charCodeAt(0), "starts with a byte-order mark").toBe(0xfeff);
  const lines: string[][] = [];
  let line: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 1; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      line.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      line.push(cell);
      lines.push(line);
      line = [];
      cell = "";
      index++;
    } else cell += char;
  }
  expect(cell, "the last row ends in CRLF").toBe("");
  const [columns = [], ...data] = lines;
  return {
    header: columns.join(","),
    rows: data.map((cells) => {
      expect(cells).toHaveLength(columns.length);
      return Object.fromEntries(columns.map((column, index) => [column, cells[index]!]));
    }),
  };
}

type Exported = { text: string; header: string; rows: Record<string, string>[]; response: Response; fileName: string; bytes: number };

/** Press Export and read the file it saves, with the response it came from. */
async function exportReviews(page: Page): Promise<Exported> {
  const response = page.waitForResponse((r) => r.url().includes(EXPORT_PATH), { timeout: 60_000 });
  const download = await downloadFrom(page, page.locator("[data-reviews-export='ready']"));
  const path = (await download.path())!;
  const text = await readFile(path, "utf8");
  return { text, ...readCsv(text), response: await response, fileName: download.suggestedFilename(), bytes: (await stat(path)).size };
}

/** Press Export expecting a refusal: the toast says why and no file is saved. */
async function expectRefusal(page: Page, message: string) {
  let downloaded = false;
  const onDownload = () => (downloaded = true);
  page.on("download", onDownload);
  const button = page.locator("[data-reviews-export='ready']");
  await expect(button).toBeVisible();
  // A click before hydration sends nothing: press until the route answers.
  await expect(async () => {
    const response = page.waitForResponse((r) => r.url().includes(EXPORT_PATH), { timeout: 4_000 });
    await button.click();
    expect((await response).status()).toBe(429);
  }).toPass({ timeout: 30_000 });
  await expectToast(page, message);
  await expectToast(page, "Wait a few minutes and try again.");
  page.off("download", onDownload);
  expect(downloaded).toBe(false);
}

/** Fill a member's export budget, as twenty exports this hour would. */
async function spendMemberBudget(userId: string) {
  await serviceRest("/rate_limits?on_conflict=user_id,action", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { user_id: userId, action: "reviews_export", hits: Array.from({ length: 20 }, () => new Date().toISOString()) },
  });
}

/** Fill a store's export budget across its team (keys are hashed as lib/rate-limit.ts hashes them). */
async function spendStoreBudget(storeId: string) {
  const key = createHash("sha256").update(storeId.trim().toLowerCase()).digest("hex");
  await serviceRest("/rate_limit_keys?on_conflict=key,action", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: { key, action: "reviews_export_store", hits: Array.from({ length: 40 }, () => new Date().toISOString()) },
  });
}

/** The list's "N reviews" line (the rating card and the pagination say it too). */
const listCount = (page: Page) => page.locator("[data-reviews-count]");

async function pickFilter(page: Page, filter: string, option: string) {
  await page.getByRole("button", { name: filter }).click();
  await page.getByRole("option", { name: option }).click();
  await page.keyboard.press("Escape");
}

test("a seller exports the reviews in view, every page of them, safe to open", async ({ page }) => {
  test.setTimeout(300_000);
  const user = freshUser("reviewexport");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedProducts(sellerId, [{ title: "Roundhouse Coffee Table" }, { title: "Braid Knit Pouffe" }]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const table = products.find((p) => p.title.startsWith("Roundhouse"))!.id;
  const pouffe = products.find((p) => p.title.startsWith("Braid"))!.id;

  // 25 reviews: more than the page's 20, so "every page" is something to prove.
  await seedReviews(sellerId, [
    { product: table, rating: 1, title: '=HYPERLINK("http://evil.example","Click me")', body: "+1 would buy again", author: "@admin", hoursAgo: 1 },
    { product: pouffe, rating: 3, title: 'Mixed, "honest" feelings', body: "Smaller than I imagined.\nStill comfy, though.", author: "Zuzana Hájková", hoursAgo: 2 },
    ...Array.from({ length: 18 }, (_, index) => ({
      product: index % 2 ? pouffe : table,
      rating: index % 3 === 0 ? 4 : 5,
      title: `Happy buyer ${index + 1}`,
      body: "Solid and beautifully finished.",
      author: `Buyer ${index + 1}`,
      hoursAgo: 3 + index,
    })),
    { product: table, rating: 4, title: "Very happy", body: "One leg slightly wobbly at first.", author: "Ines M.", hoursAgo: 30 },
    { product: table, rating: 1, title: "Avoid this seller", body: "The photos are stolen.", author: "Marta P.", moderation: "held", ground: "scam", hoursAgo: 31 },
    { product: pouffe, rating: 5, title: "Call me", body: "Ring me on 0612345678 for a discount.", author: "Promo", hidden: "personal_info", hoursAgo: 32 },
    { product: pouffe, rating: 5, title: "Arrived early", body: "Exactly as pictured.", author: "Hannah K.", native: true, verified: true, hoursAgo: 33 },
    { product: table, rating: 2, title: "Just arrived", body: "First impressions.", author: "Pieter V.", moderation: "pending", hoursAgo: 34 },
  ]);
  const inDb = (await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id&order=reviewed_at.desc`)) as { id: string }[];
  expect(inDb).toHaveLength(25);

  await page.goto("/products/reviews");
  await expect(listCount(page)).toHaveText("25 reviews");
  const button = page.locator("[data-reviews-export='ready']");
  await expect(button).toHaveAttribute("title", "Download the reviews in this view as a CSV file.");
  const axe = await new AxeBuilder({ page }).include("[data-reviews-export]").analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("reviews-export-header.png") });
  // On a phone the pair wraps; neither button runs off the screen. Loaded at
  // that size, since a resize catches the sidebar mid-slide.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(button).toBeVisible();
  for (const control of [button, page.getByRole("link", { name: "Import from anywhere" })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 16);
  }
  await page.screenshot({ path: test.info().outputPath("reviews-export-phone.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();

  // THE WHOLE STORE: every review, newest first, as a download that is never cached.
  const all = await exportReviews(page);
  expect(all.fileName).toMatch(/^square-share-reviews-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(all.response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(all.response.headers()["cache-control"]).toBe("no-store");
  expect(all.response.headers()["x-reviews-export-truncated"]).toBeUndefined();
  expect(all.header).toBe(HEADER);
  // The watermark: on every row, saying where the file came from.
  expect(new Set(all.rows.map((row) => row.exported_from))).toEqual(new Set(["Square Share"]));
  expect(all.rows.map((row) => row.review_id)).toEqual(inDb.map((row) => row.id));

  const byTitle = (title: string) => all.rows.find((row) => row.title.endsWith(title) || row.title === title)!;
  // What a buyer typed never runs: each text cell that could is marked as text.
  const formula = all.rows[0]!;
  expect(formula.title).toBe(`'=HYPERLINK("http://evil.example","Click me")`);
  expect(formula.body).toBe("'+1 would buy again");
  expect(formula.reviewer_name).toBe("'@admin");
  expect(formula.rating).toBe("1");
  // A review over two lines, with commas and quotes, is one cell as written.
  expect(byTitle('Mixed, "honest" feelings')).toMatchObject({
    body: "Smaller than I imagined.\nStill comfy, though.",
    reviewer_name: "Zuzana Hájková",
    product_title: "Braid Knit Pouffe",
    product_id: pouffe,
  });
  // Where each review stands, the seller's say and the check's kept apart.
  expect(byTitle("Avoid this seller")).toMatchObject({ published: "false", moderation_status: "held", moderation_ground: "scam", hidden_reason: "" });
  expect(byTitle("Call me")).toMatchObject({ published: "false", moderation_status: "clean", hidden_reason: "personal_info" });
  expect(byTitle("Just arrived")).toMatchObject({ published: "false", moderation_status: "pending" });
  expect(byTitle("Arrived early")).toMatchObject({ published: "true", verified_buyer: "true", source: "native" });
  expect(byTitle("Happy buyer 1")).toMatchObject({ published: "true", verified_buyer: "false", source: "judgeme" });
  expect(new Date(byTitle("Very happy").review_date).toString()).not.toBe("Invalid Date");

  // A HAND-EDITED ADDRESS: what the page would not recognise is dropped, as on
  // the page, so the file is the whole store, not an error and not nothing.
  const garbled = await page.request.get(
    `${EXPORT_PATH}?rating=9&product=not-a-uuid&sort=evil&filter=all%27--&source=everything&page=-4`,
  );
  expect(garbled.status()).toBe(200);
  expect(readCsv((await garbled.body()).toString("utf8")).rows).toHaveLength(25);
  // A search no review matches, however long: a header and nothing else.
  const nothing = await page.request.get(`${EXPORT_PATH}?q=${"x".repeat(5_000)}`);
  expect(nothing.status()).toBe(200);
  expect(nothing.headers()["x-reviews-export-truncated"]).toBeUndefined();
  expect(readCsv((await nothing.body()).toString("utf8"))).toEqual({ header: HEADER, rows: [] });

  // ON PAGE TWO it is still the whole view: the file is every page.
  await page.goto("/products/reviews?page=2");
  await expect(page.locator("[data-review]")).toHaveCount(5);
  expect((await exportReviews(page)).rows).toHaveLength(25);

  // ONE PRODUCT, lowest rated first: the file follows the list.
  await page.goto("/products/reviews");
  await pickFilter(page, "Product", "Braid Knit Pouffe");
  await expect(page).toHaveURL(new RegExp(`product=${pouffe}`));
  await pickFilter(page, "Sort", "Lowest rated");
  await expect(page).toHaveURL(/sort=lowest/);
  const pouffeCount = all.rows.filter((row) => row.product_id === pouffe).length;
  await expect(listCount(page)).toHaveText(`${pouffeCount} reviews`);
  const pouffes = await exportReviews(page);
  expect(pouffes.response.url()).toContain(`product=${pouffe}`);
  expect(pouffes.rows).toHaveLength(pouffeCount);
  expect(new Set(pouffes.rows.map((row) => row.product_title))).toEqual(new Set(["Braid Knit Pouffe"]));
  const ratings = pouffes.rows.map((row) => Number(row.rating));
  expect(ratings).toEqual([...ratings].sort((a, b) => a - b));

  // A TAB WITH NOTHING IN IT offers nothing to export: no pouffe review waits.
  await page.getByRole("link", { name: /Waiting for you/ }).click();
  await expect(page).toHaveURL(/filter=held.*product=/);
  await expect(page.getByText("No reviews match")).toBeVisible();
  const empty = page.locator("[data-reviews-export='empty']");
  await expect(empty).toBeDisabled();
  await expect(empty).toHaveAttribute("title", "There are no reviews in this view to export.");

  // The held tab alone: the one review waiting.
  await page.locator("[data-reviews-empty]").getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/product=/);
  const held = await exportReviews(page);
  expect(held.rows.map((row) => row.title)).toEqual(["Avoid this seller"]);

  // A search, as typed.
  await page.goto("/products/reviews");
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("wobbly");
  await expect(page).toHaveURL(/q=wobbly/);
  await expect(listCount(page)).toHaveText("1 review");
  const searched = await exportReviews(page);
  expect(searched.rows.map((row) => row.title)).toEqual(["Very happy"]);
});

test("the export stays small: it stops at 5,000 reviews or 4 MB, and says so", async ({ page }) => {
  test.setTimeout(420_000);
  const user = freshUser("reviewcap");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedProducts(sellerId, [{ title: "Sticker Pack" }]);
  const [product] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];

  // BY COUNT: one review more than a file carries.
  await seedReviews(sellerId, Array.from({ length: MAX_ROWS + 1 }, (_, index) => ({ product: product!.id, title: null, hoursAgo: index + 1 })));
  await page.goto("/products/reviews");
  await expect(listCount(page)).toHaveText(/^5,?001 reviews$/, { timeout: 30_000 });
  const byCount = await exportReviews(page);
  expect(byCount.response.headers()["x-reviews-export-truncated"]).toBe(String(MAX_ROWS));
  expect(byCount.rows).toHaveLength(MAX_ROWS);
  const cutShort = "The file holds the first 5,000 reviews of this view. Narrow the list by product or rating to export the rest.";
  await expectToast(page, cutShort);
  // It stays until read: past any timed toast's life, and then it can be closed.
  await page.waitForTimeout(9_000);
  await expectToast(page, cutShort);
  await toast(page, cutShort).locator("xpath=ancestor::li").getByRole("button", { name: /dismiss|close/i }).click();
  await expect(toast(page, cutShort)).toHaveCount(0);
  // The newest come first, so the one left out is the oldest.
  const oldest = (await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id&order=reviewed_at.asc&limit=1`)) as { id: string }[];
  expect(byCount.rows.map((row) => row.review_id)).not.toContain(oldest[0]!.id);

  // BY SIZE: five hundred of the longest reviews allowed, in two-byte letters,
  // weigh about five megabytes; the file stops before four.
  await serviceRest(`/reviews?seller_id=eq.${sellerId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await seedReviews(
    sellerId,
    Array.from({ length: 500 }, (_, index) => ({ product: product!.id, body: "é".repeat(5_000), title: "Très réussi", hoursAgo: index + 1 })),
    100,
  );
  await page.reload();
  await expect(listCount(page)).toHaveText("500 reviews", { timeout: 30_000 });
  const bySize = await exportReviews(page);
  const held = Number(bySize.response.headers()["x-reviews-export-truncated"]);
  expect(held).toBeGreaterThan(300);
  expect(held).toBeLessThan(500);
  expect(bySize.rows).toHaveLength(held);
  expect(bySize.bytes).toBeLessThanOrEqual(MAX_BYTES);
  expect(bySize.rows[0]!.body).toBe("é".repeat(5_000));
  await expectToast(page, `The file holds the first ${held} reviews of this view.`);
});

test("a teammate exports the store they are in; budgets per member and per store; no file signed out", async ({ page, browser, request }) => {
  test.setTimeout(300_000);

  // SIGNED OUT: refused, as JSON, before anything is read.
  const anonymous = await request.get(EXPORT_PATH);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  expect(await anonymous.json()).toMatchObject({ error: "Your session has expired." });

  const owner = freshUser("reviewowner");
  await signUp(page, owner);
  const ownerId = await userIdByEmail(owner.email);
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = freshUser("reviewmate");
  await signUp(memberPage, member);
  const memberId = await userIdByEmail(member.email);

  await seedProducts(ownerId, [{ title: "Ledger Lamp" }]);
  await seedProducts(memberId, [{ title: "Member Mug" }]);
  const [lamp] = (await serviceRest(`/products?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];
  const [mug] = (await serviceRest(`/products?owner_id=eq.${memberId}&select=id`)) as { id: string }[];
  await seedReviews(ownerId, [
    { product: lamp!.id, title: "Warm light", hoursAgo: 1 },
    { product: lamp!.id, title: "Heavy base", hoursAgo: 2 },
  ]);
  await seedReviews(memberId, [{ product: mug!.id, title: "Not the owner's", hoursAgo: 1 }]);

  // The member is a viewer of the owner's store, and is working in it.
  await serviceRest("/team_members", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: { account_owner_id: ownerId, member_user_id: memberId, invited_email: member.email.toLowerCase(), role: "viewer", status: "active", accepted_at: new Date().toISOString() },
  });
  await memberContext.addCookies([{ name: "ss_active_account", value: ownerId, url: "http://localhost:3100" }]);

  // A VIEWER CAN EXPORT what they can read, and gets the owner's store only.
  await memberPage.goto("/products/reviews");
  await expect(listCount(memberPage)).toHaveText("2 reviews");
  await expect(memberPage.getByRole("link", { name: "Import from anywhere" })).toHaveCount(0);
  const asMember = await exportReviews(memberPage);
  expect(asMember.rows.map((row) => row.title)).toEqual(["Warm light", "Heavy base"]);
  expect(asMember.rows.every((row) => row.product_title === "Ledger Lamp")).toBe(true);

  await page.goto("/products/reviews");
  const asOwner = await exportReviews(page);
  expect(asOwner.rows.map((row) => row.title)).toEqual(["Warm light", "Heavy base"]);

  // THE MEMBER'S BUDGET: the owner's spent, the teammate's untouched.
  await spendMemberBudget(ownerId);
  await expectRefusal(page, "That's a lot of review exports in a short time.");
  expect((await exportReviews(memberPage)).rows).toHaveLength(2);

  // THE STORE'S BUDGET, across its team: the teammate stops too, and the
  // owner, given a fresh budget of their own, is still held by the store's.
  await spendStoreBudget(ownerId);
  await memberPage.reload();
  await expectRefusal(memberPage, "Your team has exported this store's reviews many times in the last hour.");
  await serviceRest(`/rate_limits?user_id=eq.${ownerId}&action=eq.reviews_export`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await page.reload();
  await expectRefusal(page, "Your team has exported this store's reviews many times in the last hour.");

  await memberContext.close();
});

test("an export read back on the import page is known, already here, and adds nothing", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const owner = freshUser("reviewback");
  await signUp(page, owner);
  const ownerId = await userIdByEmail(owner.email);
  // A title unlike the handle its imported review first came under, which is
  // what kept a fingerprint from ever matching this file.
  await seedProducts(ownerId, [{ title: "Roundhouse Coffee Table" }]);
  const [table] = (await serviceRest(`/products?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];
  await seedReviews(ownerId, [
    { product: table!.id, title: "From a buyer", native: true, verified: true, hoursAgo: 1 },
    { product: table!.id, title: "From Judge.me", hoursAgo: 2 },
    { product: table!.id, title: "Waiting", moderation: "held", ground: "scam", hoursAgo: 3 },
    { product: table!.id, title: "Hidden", hidden: "spam", hoursAgo: 4 },
  ]);
  const reviewCount = async (seller: string) => ((await serviceRest(`/reviews?seller_id=eq.${seller}&select=id`)) as unknown[]).length;

  await page.goto("/products/reviews");
  await expect(listCount(page)).toHaveText("4 reviews");
  const exported = await exportReviews(page);
  expect(exported.rows).toHaveLength(4);
  const file = (text: string) => ({ name: exported.fileName, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") });
  const tile = (on: Page, id: string) => on.locator(`[data-review-import-tally="${id}"]`);
  async function expectTally(on: Page, counts: { ready: number; already: number; leftOut: number }) {
    for (const [id, count] of Object.entries(counts)) await expect(tile(on, id)).toContainText(String(count));
  }

  // THE STORE'S OWN FILE: said to be ours, every review already here, nothing to do.
  await page.goto("/products/import-reviews");
  await page.locator("#review-import-file").setInputFiles(file(exported.text));
  await expect(page.locator("[data-review-import-square-share]")).toContainText("A Square Share export");
  await expectTally(page, { ready: 0, already: 4, leftOut: 0 });
  await expect(page.locator("[data-review-import-already]")).toContainText("4 reviews in this file are already here");
  // No app to pick and no products to match: nothing here is an import.
  await expect(page.locator("#review-import-source")).toHaveCount(0);
  await expect(page.locator("[data-review-import-mapping]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("review-import-square-share.png"), fullPage: true });

  // THE ROUTE REFUSES IT TOO, whatever a caller says the file is.
  const refused = await page.evaluate(async (csv) => {
    const response = await fetch("/api/sellers/import-reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv, fileName: "x.csv", source: "judgeme", matches: {} }),
    });
    return { status: response.status, body: await response.json() };
  }, exported.text);
  expect(refused).toEqual({ status: 400, body: { ok: false, error: "square_share_export" } });
  expect(await reviewCount(ownerId)).toBe(4);

  // A FILE FROM BEFORE THE WATERMARK, like one already in someone's downloads.
  const withoutWatermark = exported.text
    .split("\r\n")
    .map((line) => line.slice(0, Math.max(0, line.lastIndexOf(","))))
    .join("\r\n");
  expect(withoutWatermark).not.toContain("exported_from");
  await page.goto("/products/import-reviews");
  await page.locator("#review-import-file").setInputFiles(file(withoutWatermark));
  await expect(page.locator("[data-review-import-square-share]")).toBeVisible();
  await expectTally(page, { ready: 0, already: 4, leftOut: 0 });

  // A REVIEW GONE SINCE THE EXPORT is left out, and the page says why.
  const gone = exported.rows.find((row) => row.title === "From Judge.me")!.review_id;
  await serviceRest(`/reviews?id=eq.${gone}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await page.goto("/products/import-reviews");
  await page.locator("#review-import-file").setInputFiles(file(exported.text));
  await expectTally(page, { ready: 0, already: 3, leftOut: 1 });
  await page.locator("[data-review-import-skipped] summary").click();
  await expect(page.locator("[data-review-import-skipped]")).toContainText("1 not in this store");
  expect(await reviewCount(ownerId)).toBe(3);

  // ANOTHER STORE reading this file: none of it is theirs, none of it lands.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const other = freshUser("reviewother");
  await signUp(otherPage, other);
  const otherId = await userIdByEmail(other.email);
  await seedProducts(otherId, [{ title: "Roundhouse Coffee Table" }]);
  await otherPage.goto("/products/import-reviews");
  await otherPage.locator("#review-import-file").setInputFiles(file(exported.text));
  await expect(otherPage.locator("[data-review-import-square-share]")).toBeVisible();
  await expectTally(otherPage, { ready: 0, already: 0, leftOut: 4 });
  await expect(otherPage.getByRole("button", { name: "Nothing new to import" })).toBeDisabled();
  expect(await reviewCount(otherId)).toBe(0);
  await otherContext.close();
});
