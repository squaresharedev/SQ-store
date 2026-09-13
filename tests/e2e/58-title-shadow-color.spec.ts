import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * The Gallery layout's fade takes a colour, picked in the tile's own style
 * panel. What only the running editor can prove: the pick reaches the canvas
 * tile as a painted gradient, the name stays readable on a light tint, and
 * the colour survives a save and a reload.
 */

const PHOTO = "https://images.e2e.invalid/title-shadow.jpg";

async function setUp(page: Page) {
  const user = freshUser("shadowcolor");
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [{ title: "Linen Throw", image_key: PHOTO }]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Add product", exact: true }).first().click();
  await page.getByRole("button", { name: /linen throw/i }).first().click();
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
}

/** The band as painted: its background image and the name's ink. */
async function band(page: Page) {
  return page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(
      "li[data-grid-cell] [data-title-band]",
    );
    const title = [...(node?.querySelectorAll<HTMLElement>("span") ?? [])].find(
      (span) => (span.textContent ?? "").includes("Linen Throw"),
    );
    return node
      ? {
          image: getComputedStyle(node).backgroundImage,
          ink: title ? getComputedStyle(title).color : null,
        }
      : null;
  });
}

test.describe("shadow title colour", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the tile's picker tints the fade, and it persists", async ({ page }) => {
    await setUp(page);
    await page.locator("li[data-grid-cell]").first().click();

    const style = page.getByRole("button", { name: /^Tile style/ }).first();
    if ((await style.getAttribute("aria-expanded")) !== "true") await style.click();

    // No picker until the tile actually draws a shadow.
    const swatches = page.getByRole("group", { name: "Shadow color swatches" });
    await expect(swatches).toHaveCount(0);

    await page.getByRole("button", { name: "Gallery", exact: true }).first().click();
    await expect(swatches).toBeVisible();

    // Untouched, it is the black fade it always was.
    await expect
      .poll(async () => (await band(page))?.image ?? "")
      .toContain("rgba(0, 0, 0, 0.7)");
    expect((await band(page))!.ink).toBe("rgb(255, 255, 255)");

    await page.screenshot({ path: test.info().outputPath("before.png") });

    // A light swatch: the fade takes it and the name flips to dark ink.
    const white = swatches.locator('[aria-label^="White"]').first();
    await white.click();
    await expect
      .poll(async () => (await band(page))?.image ?? "")
      .toMatch(/rgba\(255, 255, 255, 0\.7\)/);
    expect((await band(page))!.ink).toBe("rgb(23, 23, 23)");

    await page.screenshot({ path: test.info().outputPath("after.png") });

    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
    await expect
      .poll(async () => (await band(page))?.image ?? "")
      .toMatch(/rgba\(255, 255, 255, 0\.7\)/);
  });
});
