import { expect, test } from "@playwright/test";
import { createStorefrontViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * "Create storefront" makes one in a single press: no questions first, straight
 * into the designer, on a default name the seller can change there.
 */
test("Create storefront goes straight to the designer, on the default name", async ({ page }) => {
  await signUp(page, freshUser("sf-create"));
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await gotoApp(page, "/storefront");
  await expect(page.getByText("Untitled storefront").first()).toBeVisible({ timeout: 30_000 });
});
