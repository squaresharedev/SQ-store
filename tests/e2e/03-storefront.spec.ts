import { expect, test } from "@playwright/test";
import {
  createProductViaUI,
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

test.describe("storefront designer", () => {
  test("create → add blocks → save → embed snippet + settings", async ({ page }) => {
    const user = freshUser("storefront");
    await signUp(page, user);

    // Create a product so the designer has something to place.
    await createProductViaUI(page, { title: "Grid piece", price: "9.00" });

    // --- create a storefront ---
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
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
    await expectToast(page, /storefront saved/i, 15_000);

    // --- reload: config persisted ---
    await page.reload();
    await expect(page.getByText("Your text here").first()).toBeVisible({ timeout: 20_000 });

    // --- embed modal from the storefront list ---
    await page.goto("/storefront");
    await page.getByRole("button", { name: /^Embed / }).first().click();
    const snippet = page.locator("pre");
    // The snippet carries the storefront's rotatable EMBED KEY, never its id.
    // Publishing the id would make the embed impossible to revoke without
    // deleting the storefront, and would leak the dashboard's own identifier
    // into every page that embeds it.
    await expect(snippet).toContainText("embed.squareshare.to/widget.js");
    await expect(snippet).toContainText(
      /data-squareshare-storefront="[0-9a-f-]{36}"/,
    );
    await expect(snippet).not.toContainText(storefrontId);

    // Embed settings: enable + set a domain, save.
    await page.locator("#embed-enabled").click();
    await page.locator("#embed-domains").fill("myblog.example.com");
    await page.getByRole("button", { name: /save/i }).last().click();
    await expectToast(page, /embed settings saved/i, 10_000);

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

  test("copy/paste duplicates shapes and text, never products", async ({ page }) => {
    const user = freshUser("copypaste");
    await signUp(page, user);
    await createProductViaUI(page, { title: "Uncopyable", price: "5.00" });

    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
    const cells = page.locator("li[data-grid-cell]");

    // --- product blocks have no copy path ---
    await page.getByRole("button", { name: "Add product", exact: true }).click();
    await page.getByRole("button", { name: /add uncopyable|uncopyable/i }).first().click();
    await expect(cells).toHaveCount(1);
    await page.getByRole("button", { name: /edit uncopyable/i }).click();
    await page.keyboard.press("ControlOrMeta+c");
    await expect(page.getByText(/block copied/i)).not.toBeVisible();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(1);

    // --- keyboard copy/paste on a shape ---
    await page.getByRole("button", { name: "Add shape", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add star" }).click();
    await expect(cells).toHaveCount(2);
    // Inserting selects the new block, so it is ready to copy.
    await page.keyboard.press("ControlOrMeta+c");
    await expect(page.getByText(/block copied/i)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(3);
    // Paste again: the clipboard survives and keeps stamping copies.
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(4);

    // --- Duplicate button on a text block (the no-keyboard path) ---
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(cells).toHaveCount(5);
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(cells).toHaveCount(6);
    // Scoped to the board: the inspector's textarea also carries this text.
    await expect(cells.getByText("Your text here")).toHaveCount(2);

    // --- copies are real blocks: they survive a save + reload ---
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();
    await expect(cells).toHaveCount(6, { timeout: 20_000 });
  });

  test("undo/redo works from the toolbar", async ({ page }) => {
    const user = freshUser("undo");
    await signUp(page, user);

    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("Your text here")).not.toBeVisible();

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();
  });
});
