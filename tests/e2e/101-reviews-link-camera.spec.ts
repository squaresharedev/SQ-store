import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * "★ 4.7 (13)" ON A PRODUCT PAGE OUT ON THE CANVAS moves the CAMERA to the
 * reviews, and scrolls nothing.
 *
 * It used to call scrollIntoView, which scrolls clipping boxes as readily as
 * scrolling ones: the page slid up inside its own card (which clips to the
 * page's height), left blank card underneath, and the part it pushed out of the
 * top could not be reached again, since neither the card nor the workspace has
 * a scrollbar. The canvas pans instead, so the whole page stays a pan away.
 */

/** The default theme, spelled out: the spec must not reach into src/. */
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

const PRODUCT_PAGE = {
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
    { id: "reviews", show: true },
    { id: "seller", show: true },
  ],
};

/** Every box from `selector` up to the document that has been scrolled at all. */
function scrolledAncestors(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const scrolled: string[] = [];
    for (let node = document.querySelector(selector); node; node = node.parentElement) {
      if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
        scrolled.push(`${node.tagName}.${node.className} ${node.scrollLeft},${node.scrollTop}`);
      }
    }
    return scrolled;
  }, selector);
}

/** `selector`'s box relative to the workspace window. */
function inWorkspace(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const workspace = document.querySelector("[data-canvas-stage]")!.parentElement!.getBoundingClientRect();
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return {
      left: box.left - workspace.left,
      top: box.top - workspace.top,
      right: box.right - workspace.left,
      bottom: box.bottom - workspace.top,
      width: workspace.width,
      height: workspace.height,
      centerX: box.left + box.width / 2,
      centerY: box.top + box.height / 2,
      workspaceCenterX: workspace.left + workspace.width / 2,
      workspaceCenterY: workspace.top + workspace.height / 2,
    };
  }, selector);
}

test("the rating on a canvas product page pans the camera to the reviews", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const user = freshUser("reviewscamera");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const [storefront] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await seedProducts(sellerId, [
    { title: "Oak lamp", purchase_url: "https://shop.example.com/lamp", description: "Warm light." },
  ]);
  const [{ id: oak }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await serviceRest(`/storefronts?id=eq.${storefront!.id}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [{ type: "product", productId: oak, x: 0, y: 0, w: 2, h: 2 }],
        productPage: PRODUCT_PAGE,
      },
    },
  });
  const importId = randomUUID();
  await serviceRest(`/review_imports`, {
    method: "POST",
    body: { id: importId, seller_id: sellerId, source: "loox", file_name: "loox.csv", row_count: 3, imported_count: 3, skipped_count: 0 },
  });
  await serviceRest(`/reviews`, {
    method: "POST",
    body: [5, 4, 5].map((rating, index) => ({
      product_id: oak,
      import_id: importId,
      source: "loox",
      external_id: `e2e:${index}`,
      rating,
      title: `Lovely ${index}`,
      body: "Warm light, well made.",
      author_name: "Aoife N.",
      moderation_status: "clean",
      reviewed_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    })),
  });

  // The designer, with the lamp's page out beside the board.
  await gotoApp(page, `/storefront/${storefront!.id}`);
  // The tile answers to its label, not to a role (see spec 46).
  await page.getByLabel(/^oak lamp\. press enter/i).click();
  await canvasStill(page);
  await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
  const artboard = `[data-artboard-id="${oak}"]`;
  const rating = `${artboard} [data-product-rating]`;
  const reviews = `${artboard} [data-product-section='reviews']`;
  await expect(page.locator(rating)).toHaveText("4.7(3)");
  const close = page.getByRole("button", { name: /^close .+ panel$/i }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await canvasStill(page);

  // Bring the rating to the middle of the window with the canvas's own pan, so
  // the press below is a real one at real coordinates. (Playwright's click
  // would scroll it into view itself, the very thing under test.)
  const before = await inWorkspace(page, rating);
  await page.mouse.move(before.workspaceCenterX, before.workspaceCenterY);
  await page.mouse.wheel(before.centerX - before.workspaceCenterX, before.centerY - before.workspaceCenterY);
  await canvasStill(page);
  expect(await scrolledAncestors(page, reviews)).toEqual([]);
  const ratingBox = await inWorkspace(page, rating);
  expect(ratingBox.top).toBeGreaterThan(0);
  expect(ratingBox.bottom).toBeLessThan(ratingBox.height);
  const reviewsBefore = await inWorkspace(page, reviews);
  // Well down the window, so getting them to its top is a real move.
  expect(reviewsBefore.top).toBeGreaterThan(ratingBox.bottom + 100);
  const stageBefore = await page.locator("[data-canvas-stage]").evaluate((node) => (node as HTMLElement).style.transform);
  await page.screenshot({ path: test.info().outputPath("before.png") });

  await page.mouse.click(ratingBox.centerX, ratingBox.centerY);
  await page.waitForTimeout(100);
  await canvasStill(page);
  await page.screenshot({ path: test.info().outputPath("after.png") });

  // Nothing scrolled: not the page's card, not the workspace, not the document.
  expect(await scrolledAncestors(page, reviews)).toEqual([]);
  // The camera moved instead, and the reviews heading is at the top of the
  // window, a margin below its edge.
  const stageAfter = await page.locator("[data-canvas-stage]").evaluate((node) => (node as HTMLElement).style.transform);
  expect(stageAfter).not.toBe(stageBefore);
  const reviewsAfter = await inWorkspace(page, reviews);
  expect(reviewsAfter.top).toBeGreaterThan(8);
  expect(reviewsAfter.top).toBeLessThan(48);
  await expect(page.locator(`${artboard} #product-reviews`)).toBeInViewport();
  // The card is still exactly as tall as the page: no blank band under it.
  const fit = await page.locator(`${artboard} [data-artboard-card]`).evaluate((card) => ({
    card: card.getBoundingClientRect().height,
    page: (card.firstElementChild as HTMLElement).getBoundingClientRect().height,
  }));
  expect(Math.abs(fit.card - fit.page)).toBeLessThan(2);

  // And the top of the page is a pan away, as it always was.
  await page.mouse.move(reviewsAfter.workspaceCenterX, reviewsAfter.workspaceCenterY);
  await page.mouse.wheel(0, -(reviewsBefore.top - reviewsAfter.top));
  await canvasStill(page);
  await expect(page.locator(rating)).toBeInViewport();
  expect(await scrolledAncestors(page, reviews)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("back.png") });
});
