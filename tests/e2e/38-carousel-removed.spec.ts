import { expect, test, type Page } from "@playwright/test";
import { freshUser, gotoApp, seedProducts, seedStorefronts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * Carousel display mode is pulled for the MVP: grid is the only layout now.
 * `theme.displayMode` no longer exists in the schema (a stored value is
 * silently dropped on parse, see lib/validation/storefront.ts), the Canvas
 * group's "Display mode" toggle is gone, and CarouselStrip itself is deleted.
 * This pins the seller-visible half of that: nothing in the editor still
 * offers or names it.
 */

async function seed(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Grid only" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  await seedProducts(sellerId, [{ title: "Oak lamp", price_cents: 12900 }]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const lamp = products.find((p) => p.title === "Oak lamp")!.id;

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: {
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
        },
        blocks: [{ type: "product", productId: lamp, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });

  return { storefrontId, lamp };
}

test("the storefront canvas renders as a grid with no carousel toggle", async ({ page }) => {
  const s = await seed(page, "nocarousel");
  await gotoApp(page, `/storefront/${s.storefrontId}`);

  // The board renders (grid), the product tile is on it.
  await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();
  await expect(page.locator("[data-canvas-board]")).toBeVisible();
  await expect(page.getByText("Oak lamp")).toBeVisible();

  // No carousel strip anywhere.
  await expect(page.getByRole("list", { name: "Storefront carousel" })).toHaveCount(0);

  // Open the Canvas group of the design panel and confirm there is no
  // "Display mode" control left.
  await page.getByText("Canvas", { exact: true }).first().click();
  await expect(page.getByText("Display mode", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Carousel", exact: true })).toHaveCount(0);
  // The rest of the Canvas group is still there.
  await expect(page.getByText("Canvas width")).toBeVisible();
  await expect(page.getByText("Grid density")).toBeVisible();

  // The search field cannot find a "display mode" or "carousel" setting.
  await page.getByRole("button", { name: /^back to all settings/i }).first().click();
  const field = page.getByRole("combobox", { name: "Find a setting or object" });
  await field.fill("carousel");
  const options = page.getByRole("option");
  await page.waitForTimeout(300);
  expect(await options.count()).toBe(0);
  await expect(page.getByText("Nothing in the editor matches that.")).toBeVisible();
});
