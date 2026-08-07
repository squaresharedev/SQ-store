import { devices, expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * UNIVERSAL SEARCH ON A PHONE.
 *
 * A command palette is exactly the pattern that tends to break on touch: the
 * trigger shrinks to an unhittable sliver, the on-screen keyboard covers the
 * input, or a sub-16px field makes iOS zoom the whole page on focus. Each of
 * those is asserted here rather than eyeballed.
 *
 * Its own file because Playwright refuses a device fixture inside a describe
 * block — the same reason 08-storefront-mobile.spec.ts is separate.
 */

test.use({ ...devices["iPhone 13"] });

/** signUp resolves while the /dashboard navigation is still in flight. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

function combobox(page: Page) {
  return page.getByRole("combobox", { name: "Search" });
}

test.describe("universal search — phone", () => {
  let user: ReturnType<typeof freshUser>;

  test.beforeEach(async ({ page }) => {
    user = freshUser("searchm");
    await signUp(page, user);
    await settle(page);
  });

  test("the mobile header carries a search button that opens a full-screen sheet", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    const trigger = page.getByRole("button", { name: "Search" }).first();
    await expect(trigger).toBeVisible();

    // A real touch target, not a 20px sliver between the menu and the bell.
    const box = await trigger.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    await trigger.tap();
    await expect(combobox(page)).toBeVisible();

    // The sheet fills the viewport rather than sitting in a cramped dropdown.
    const dialog = page.getByRole("dialog", { name: "Search" });
    const sheet = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(sheet!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  });

  test("the input is 16px or larger, so iOS does not zoom the page on focus", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: "Search" }).first().tap();
    const fontSize = await combobox(page).evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test("results are tappable and the X close button closes the sheet", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: "Search" }).first().tap();
    await combobox(page).fill("payments");

    const hit = page.getByRole("option").filter({ hasText: "Payments" }).first();
    // Comfortable touch target on every row.
    expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await hit.tap();
    await expect(page).toHaveURL(/\/payments/);

    await page.getByRole("button", { name: "Search" }).first().tap();
    await page.getByRole("button", { name: "Close search" }).tap();
    await expect(combobox(page)).toBeHidden();
  });

  test("a real product from the database is findable on a phone too", async ({
    page,
  }) => {
    // Seeded, not created through the form: this spec is about search on a
    // phone, and driving the product form at 390px would make it fail for
    // reasons that have nothing to do with the palette.
    const title = `Beacon ${Date.now()}`;
    await seedProducts(await userIdByEmail(user.email), [{ title }]);

    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: "Search" }).first().tap();
    await combobox(page).fill("beacon");
    await expect(
      page.getByRole("option").filter({ hasText: title }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
