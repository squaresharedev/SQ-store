import { expect, test } from "@playwright/test";
import { freshUser, gotoApp, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * THE SHARE CARD GALLERY (/dev/share-cards) and the photo route behind its
 * cutouts.
 *
 *   - Every template draws, at the format's exact size, and a signed-in
 *     seller finds their own products in it beside the fixtures. (The
 *     background-removal model itself is not run here: it is an 88 MB
 *     download, and the seeded product has no photo. It is checked by hand
 *     in a real browser, see lib/share-card/cutout/engine.ts.)
 *   - The page is cross-origin isolated, for the model's CPU threads.
 *   - /api/products/[id]/photo serves a store's own product photo from our
 *     own origin, and nothing else to anyone else.
 */

const SIZES = { "1:1": 360, "4:5": 450, "9:16": 640 } as const;

/** A raster photo on HTTPS, which presignGetUrl passes straight through for
 *  seeded rows: the app's own published sample photo. */
const SEEDED_PHOTO = "https://dashboard.squareshare.eu/sample-storefront/camera.webp";

async function productIdOf(sellerId: string, title: string): Promise<string> {
  const rows = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&title=eq.${encodeURIComponent(title)}&select=id`,
  )) as { id: string }[];
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

test("the gallery draws every template in every format, on the seller's own products too", async ({ page }) => {
  const user = freshUser("share");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedProducts(sellerId, [{ title: "Walnut serving board", price_cents: 6400 }]);

  const response = await page.goto("/dev/share-cards");
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-embedder-policy"]).toBe("credentialless");
  await page.waitForLoadState("networkidle").catch(() => {});

  const own = page.getByRole("button", { name: /Yours\s*Walnut serving board/ });
  await expect(own).toBeVisible();
  await own.click();

  const cards = page.locator("[data-share-gallery] [data-share-card]");
  for (const [ratio, height] of Object.entries(SIZES)) {
    await page.getByText(ratio).first().click();
    await expect(cards).toHaveCount(6);
    for (const box of await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect()).map(({ width, height }) => ({ width, height })),
    )) {
      expect(box).toEqual({ width: 360, height });
    }
    await expect(cards.filter({ hasText: /walnut serving/i })).toHaveCount(6);
  }

  // The seller's price, in the short form a card prints.
  await expect(cards.first()).toContainText("€64");
  // No photo, so nothing to cut out: the product stands as a placeholder.
  await expect(page.locator("[data-share-subject='photo']")).toHaveCount(6);
});

test("the photo route serves a store's own photo, from our origin, and nothing else", async ({ page }) => {
  const owner = freshUser("photo");
  await signUp(page, owner);
  const ownerId = await userIdByEmail(owner.email);
  await seedProducts(ownerId, [
    { title: "Pictured lamp", image_key: SEEDED_PHOTO },
    { title: "Unpictured lamp" },
  ]);
  const pictured = await productIdOf(ownerId, "Pictured lamp");
  const unpictured = await productIdOf(ownerId, "Unpictured lamp");

  await gotoApp(page, "/products");
  const photo = await page.request.get(`/api/products/${pictured}/photo`);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe("image/webp");
  expect(photo.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await photo.body()).byteLength).toBeGreaterThan(1000);

  expect((await page.request.get(`/api/products/${unpictured}/photo`)).status()).toBe(404);
  expect((await page.request.get(`/api/products/not-a-uuid/photo`)).status()).toBe(404);

  // Another store's member asks for it: no such product, as far as they know.
  const other = freshUser("photo2");
  await page.context().clearCookies();
  await signUp(page, other);
  expect((await page.request.get(`/api/products/${pictured}/photo`)).status()).toBe(404);

  // Nobody signed in at all.
  await page.context().clearCookies();
  expect((await page.request.get(`/api/products/${pictured}/photo`)).status()).toBe(401);
});
