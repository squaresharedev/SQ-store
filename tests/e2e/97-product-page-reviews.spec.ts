import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  freshUser,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * REVIEWS ON THE PRODUCT PAGE, as an anonymous buyer gets them, through the
 * real app and the real database:
 *
 *   - the product's rating and the reviews, newest first, more on request;
 *   - the star breakdown narrows the list to one rating, and lets go again;
 *   - only public reviews count: a held one is neither shown nor averaged;
 *   - a product with none says so;
 *   - the seller's switch takes the whole section away.
 */

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 0,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

/** A complete product page config (the schema is strict), with the reviews switch as given. */
function productPage(reviews: boolean) {
  return {
    enabled: true,
    imageFit: "contain",
    ctaLabel: "Buy now",
    priceNote: "incl-vat",
    shippingNote: "plus-shipping",
    showStock: true,
    showSeller: true,
    allowIndexing: false,
    sections: [
      { id: "description", show: true },
      { id: "specs", show: true },
      { id: "documents", show: true },
      { id: "shipping", show: true },
      { id: "returns", show: true },
      { id: "safety", show: true },
      { id: "reviews", show: reviews },
      { id: "seller", show: true },
    ],
  };
}

/** Twelve 5-star, one 1-star and one held: more than a page, and something to filter. */
const RATINGS = [...Array.from({ length: 12 }, () => 5), 1];

test("a buyer reads a product's reviews, narrows them, and the seller can switch them off", async ({ page }) => {
  const user = freshUser("pagereviews");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const [storefront] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await seedProducts(sellerId, [
    { title: "Oak lamp", purchase_url: "https://shop.example.com/lamp" },
    { title: "Brass lamp", purchase_url: "https://shop.example.com/brass" },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const oak = products.find((p) => p.title === "Oak lamp")!.id;
  const brass = products.find((p) => p.title === "Brass lamp")!.id;

  async function configure(reviews: boolean) {
    await serviceRest(`/storefronts?id=eq.${storefront!.id}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [
            { type: "product", productId: oak, x: 0, y: 0, w: 2, h: 2 },
            { type: "product", productId: brass, x: 2, y: 0, w: 2, h: 2 },
          ],
          productPage: productPage(reviews),
        },
      },
    });
  }
  await configure(true);

  const importId = randomUUID();
  await serviceRest(`/review_imports`, {
    method: "POST",
    body: { id: importId, seller_id: sellerId, source: "loox", file_name: "loox.csv", row_count: 14, imported_count: 14, skipped_count: 0 },
  });
  await serviceRest(`/reviews`, {
    method: "POST",
    body: [
      ...RATINGS.map((rating, index) => ({
        product_id: oak,
        import_id: importId,
        source: "loox",
        external_id: `e2e:${index}`,
        rating,
        title: rating === 1 ? "Flickers" : `Lovely ${index}`,
        body: rating === 1 ? "The bulb flickers on the lowest setting." : "Warm light, well made.",
        author_name: "Aoife N.",
        moderation_status: "clean",
        reviewed_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
      })),
      {
        product_id: oak,
        import_id: importId,
        source: "loox",
        external_id: "e2e:held",
        rating: 1,
        title: "Held one",
        body: "This shop is a scam.",
        author_name: "Marta P.",
        moderation_status: "held",
        reviewed_at: new Date().toISOString(),
      },
    ],
  });

  // An anonymous buyer.
  await page.context().clearCookies();
  await page.goto(`/s/${storefront!.id}/p/${oak}`);
  const section = page.locator("[data-product-section='reviews']");
  await expect(section).toBeVisible();
  // (12×5 + 1) / 13 = 4.69: the held review is not counted.
  await expect(section.getByText("4.7", { exact: true })).toBeVisible();
  await expect(section.getByText("Based on 13 reviews")).toBeVisible();
  await expect(section.getByText("Held one")).toHaveCount(0);
  await expect(section.locator("[data-review]")).toHaveCount(10);
  await page.screenshot({ path: test.info().outputPath("product-reviews.png"), fullPage: true });

  // More, a page at a time.
  await section.getByRole("button", { name: "Show more reviews" }).click();
  await expect(section.locator("[data-review]")).toHaveCount(13);
  await expect(section.getByRole("button", { name: "Show more reviews" })).toHaveCount(0);

  // Narrowed to the one-star reviews from the breakdown.
  await section.getByRole("button", { name: "Show 1-star reviews (1)" }).click();
  await expect(section.getByText("Showing 1-star reviews")).toBeVisible();
  await expect(section.locator("[data-review]")).toHaveCount(1);
  await expect(section.getByText("The bulb flickers on the lowest setting.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Show 3-star reviews (0)" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("product-reviews-filtered.png"), fullPage: true });
  await section.getByRole("button", { name: "Show all reviews" }).click();
  await expect(section.locator("[data-review]")).toHaveCount(10);

  // A product nobody has reviewed says so.
  await page.goto(`/s/${storefront!.id}/p/${brass}`);
  await expect(page.locator("[data-product-section='reviews']").getByText("No reviews yet")).toBeVisible();

  // The seller's switch takes the section away.
  await configure(false);
  await page.goto(`/s/${storefront!.id}/p/${oak}`);
  await expect(page.getByRole("heading", { name: "Oak lamp" })).toBeVisible();
  await expect(page.locator("[data-product-section='reviews']")).toHaveCount(0);
});
