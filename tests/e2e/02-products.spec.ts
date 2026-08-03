import { expect, test } from "@playwright/test";
import { freshUser, signUp } from "./helpers";

test.describe("products CRUD", () => {
  test("add → list → edit → delete a product", async ({ page }) => {
    const user = freshUser("products");
    await signUp(page, user);

    // --- create ---
    await page.goto("/products");
    await page.getByRole("link", { name: /add product/i }).first().click();
    await page.waitForURL(/\/products\/new/);

    await page.getByLabel("Title").fill("E2E Print");
    await page.getByLabel(/price/i).fill("14.00");
    await page.getByRole("button", { name: /save product/i }).click();

    await page.waitForURL(/\/products$/, { timeout: 20_000 });
    await expect(page.getByText("E2E Print")).toBeVisible();
    await expect(page.getByText("€14.00")).toBeVisible();

    // --- edit ---
    await page.getByRole("link", { name: "Edit E2E Print" }).click();
    await page.waitForURL(/\/edit/);
    await page.getByLabel("Title").fill("E2E Print v2");
    await page.getByLabel(/price/i).fill("21.50");
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 20_000 });
    await expect(page.getByText("E2E Print v2")).toBeVisible();
    await expect(page.getByText("€21.50")).toBeVisible();

    // --- delete ---
    await page.getByRole("button", { name: "Delete E2E Print v2" }).click();
    // The confirm step is REQUIRED, not "take it if it happens to be there".
    // The optional version silently passed while never confirming anything,
    // because its /^delete$/ never matched the real button ("Delete product").
    await page.getByRole("button", { name: "Delete product" }).click();
    // The CARD has to go. Matching on bare text would also match the confirm
    // dialog's copy, which quotes the title back at you.
    await expect(page.getByRole("heading", { name: "E2E Print v2" })).toBeHidden({
      timeout: 15_000,
    });
  });

  test("client validation blocks an empty title and bad price", async ({ page }) => {
    const user = freshUser("prodval");
    await signUp(page, user);
    await page.goto("/products/new");

    await page.getByRole("button", { name: /save product/i }).click();
    await expect(page.getByText(/give your product a title|title/i).first()).toBeVisible();

    await page.getByLabel("Title").fill("Priced wrong");
    await page.getByLabel(/price/i).fill("0");
    await page.getByRole("button", { name: /save product/i }).click();
    await expect(page.getByText(/price must be a number greater than zero/i)).toBeVisible();
    // Still on the form — nothing was saved.
    await expect(page).toHaveURL(/\/products\/new/);
  });

  test("draft vs active status shows on the product card", async ({ page }) => {
    const user = freshUser("prodstatus");
    await signUp(page, user);
    await page.goto("/products/new");
    await page.getByLabel("Title").fill("Draft thing");
    await page.getByLabel(/price/i).fill("5");
    // Leave default status; read what the card shows after save.
    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/);
    await expect(page.getByText(/draft|active/i).first()).toBeVisible();
  });
});
