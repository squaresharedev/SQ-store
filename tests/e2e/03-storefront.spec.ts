import { expect, test } from "@playwright/test";
import { createProductViaUI, freshUser, gotoApp, signUp } from "./helpers";

test.describe("storefront designer", () => {
  test("create → add blocks → save → embed snippet + settings", async ({ page }) => {
    const user = freshUser("storefront");
    await signUp(page, user);

    // Create a product so the designer has something to place.
    await createProductViaUI(page, { title: "Grid piece", price: "9.00" });

    // --- create a storefront ---
    await gotoApp(page, "/storefront");
    await page
      .getByRole("button", { name: /new storefront|create storefront/i })
      .first()
      .click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 20_000 });
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];

    // --- add a text block via the toolbar ---
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    // --- add a product block ---
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    // Product picker lists our product with an add affordance.
    await page.getByRole("button", { name: /add grid piece|grid piece/i }).first().click();

    // --- save ---
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/saved\.?$/i).first()).toBeVisible({ timeout: 15_000 });

    // --- reload: config persisted ---
    await page.reload();
    await expect(page.getByText("Your text here").first()).toBeVisible({ timeout: 20_000 });

    // --- embed modal from the storefront list ---
    await page.goto("/storefront");
    await page.getByRole("button", { name: /^Embed / }).first().click();
    const snippet = page.locator("pre");
    await expect(snippet).toContainText(storefrontId);
    await expect(snippet).toContainText("embed.squareshare.to/widget.js");

    // Embed settings: enable + set a domain, save.
    await page.locator("#embed-enabled").click();
    await page.locator("#embed-domains").fill("myblog.example.com");
    await page.getByRole("button", { name: /save/i }).last().click();
    await expect(page.getByText(/^saved\.?$/i).first()).toBeVisible({ timeout: 10_000 });

    // Pasting a URL is normalized (scheme/path stripped), not rejected.
    await page.locator("#embed-domains").fill("https://pasted.example.com/shop");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator("#embed-domains")).toHaveValue("pasted.example.com");

    // A genuinely invalid domain (wildcard) is rejected with a visible error.
    await page.locator("#embed-domains").fill("*.wildcard.example.com");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /bare lowercase domains/i }),
    ).toBeVisible();
  });

  test("undo/redo works from the toolbar", async ({ page }) => {
    const user = freshUser("undo");
    await signUp(page, user);

    await page.goto("/storefront");
    await page
      .getByRole("button", { name: /new storefront|create storefront/i })
      .first()
      .click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("Your text here")).not.toBeVisible();

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();
  });
});
