import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { freshUser, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * THE REVIEWS PAGE, SEARCHED AND FILTERED.
 *
 * A store with a couple of dozen reviews across two products, through the real
 * app and the real database: the store's rating and its star breakdown, a
 * star row that filters, the search box (marking what matched), the product,
 * source and sort filters, tabs that keep them, and the empty state that
 * offers a way back.
 */

type Seeded = { rating: number; title: string | null; body: string; author: string; product: 0 | 1; moderation?: string; ground?: string };

const REVIEWS: Seeded[] = [
  { rating: 5, title: "Love it", body: "Solid oak and beautifully finished.", author: "Hannah K.", product: 0 },
  { rating: 5, title: "Perfect", body: "Exactly as pictured, arrived early.", author: "Tomás R.", product: 0 },
  { rating: 4, title: "Very happy", body: "Great table, one leg slightly wobbly at first.", author: "Ines M.", product: 0 },
  { rating: 4, title: null, body: "Does the job nicely and looks good doing it.", author: "Pieter V.", product: 1 },
  { rating: 3, title: "Mixed feelings", body: "Smaller than I imagined from the photos.", author: "Zuzana H.", product: 1 },
  { rating: 1, title: "Broke quickly", body: "Fell apart within a week.", author: "Oliver B.", product: 1 },
  { rating: 1, title: "Avoid this seller", body: "The photos are stolen and nothing they say is true.", author: "Marta P.", product: 0, moderation: "held", ground: "scam" },
];

test("a seller finds the reviews that matter: rating, search, filters", async ({ page }) => {
  const user = freshUser("reviewfind");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedProducts(sellerId, [{ title: "Roundhouse Coffee Table" }, { title: "Braid Knit Pouffe" }]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title&order=title.desc`)) as {
    id: string;
    title: string;
  }[];
  const [table, pouffe] = [products.find((p) => p.title.startsWith("Roundhouse"))!, products.find((p) => p.title.startsWith("Braid"))!];

  // Imported reviews need no orders: one Judge.me run carries them all.
  const importId = randomUUID();
  await serviceRest(`/review_imports`, {
    method: "POST",
    body: { id: importId, seller_id: sellerId, source: "judgeme", file_name: "judgeme.csv", row_count: REVIEWS.length, imported_count: REVIEWS.length, skipped_count: 0 },
  });
  await serviceRest(`/reviews`, {
    method: "POST",
    body: REVIEWS.map((review, index) => ({
      product_id: (review.product === 0 ? table : pouffe).id,
      import_id: importId,
      source: "judgeme",
      external_id: `e2e:${index}`,
      rating: review.rating,
      title: review.title,
      body: review.body,
      author_name: review.author,
      moderation_status: review.moderation ?? "clean",
      moderation_ground: review.ground ?? null,
      reviewed_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    })),
  });

  await page.goto("/products/reviews");
  const overview = page.getByRole("region", { name: "Store rating" });
  // Public reviews only: the held one does not count. (5+5+4+4+3+1) / 6 = 3.67.
  await expect(overview.getByText("3.7")).toBeVisible();
  await expect(page.getByText("7 reviews")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("reviews-page.png"), fullPage: true });

  // A star row narrows to those reviews.
  await overview.getByRole("button", { name: "Show only 5-star reviews (2)" }).click();
  await expect(page).toHaveURL(/rating=5/);
  await expect(page.getByText("2 reviews")).toBeVisible();
  await overview.getByRole("button", { name: "Show only 5-star reviews (2)" }).click();
  await expect(page).not.toHaveURL(/rating=/);

  // Search, with the match marked.
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("wobbly");
  await expect(page).toHaveURL(/q=wobbly/);
  await expect(page.getByText("1 review", { exact: true })).toBeVisible();
  await expect(page.locator("[data-review-match]")).toHaveText(["wobbly"]);
  await page.screenshot({ path: test.info().outputPath("reviews-search.png"), fullPage: true });

  // A search term is matched literally: % is not a wildcard.
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("%");
  await expect(page).toHaveURL(/q=%25/);
  await expect(page.getByText("No reviews match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("");
  await expect(page).not.toHaveURL(/q=/);

  // By product, lowest first.
  await page.getByRole("button", { name: "Product" }).click();
  await page.getByRole("option", { name: "Braid Knit Pouffe" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`product=${pouffe.id}`));
  await expect(page.getByText("3 reviews")).toBeVisible();
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("option", { name: "Lowest rated" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/sort=lowest/);
  await expect(page.locator("[data-review] h3").first()).toHaveText("Broke quickly");

  // The tab keeps the filters; nothing of the pouffe's is waiting.
  await page.getByRole("link", { name: /Waiting for you/ }).click();
  await expect(page).toHaveURL(/filter=held.*product=/);
  await expect(page.getByText("No reviews match")).toBeVisible();

  // Clearing keeps the tab and shows what waits there.
  await page.locator("[data-reviews-empty]").getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/product=/);
  await expect(page.locator('[data-review-status="held"]')).toHaveText("Waiting for you · scam");

  // Only imported reviews in this store: none from verified buyers.
  await page.getByRole("link", { name: /^All$/ }).click();
  await page.getByRole("button", { name: "Source" }).click();
  await page.getByRole("option", { name: "Verified buyers" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("No reviews match")).toBeVisible();
});
