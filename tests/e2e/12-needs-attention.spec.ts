import { expect, test, type Page } from "@playwright/test";
import {
  createProductViaUI,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedOrders,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * The overview's "Needs attention" rows are only worth showing if their action
 * link lands on the surface that FIXES the thing the row names. This walks the
 * rows a real seller sees, in the order they appear, and follows each link.
 */

/** Click a row's action, wait for the navigation, and return where it landed. */
async function followAction(page: Page, name: RegExp, expected: RegExp) {
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await page.waitForURL(expected, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return new URL(page.url());
}

test.describe("needs attention links", () => {
  test("every row lands on the surface that resolves it", async ({ page }) => {
    const user = freshUser("attention");
    await signUp(page, user);
    await gotoApp(page, "/dashboard");
    await expect(page.getByText("Needs attention")).toBeVisible();

    // --- no Stripe row while connecting is impossible ---
    // /payments has nothing to connect until Stripe Connect ships, and a row
    // whose one action lands on a disabled button would be the first dead end
    // a new seller meets (lib/payments/availability.ts).
    await expect(page.getByRole("link", { name: /open payments/i })).toHaveCount(0);

    // --- no storefront yet -> the list, where the create action lives ---
    // While setup is unfinished this is a step in the "Get set up" checklist
    // rather than a Needs attention row; the destination is the same.
    let url = await followAction(page, /create storefront/i, /\/storefront$/);
    expect(url.pathname).toBe("/storefront");

    // Create one and leave its grid empty.
    await createStorefrontViaUI(page);
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];

    // --- empty storefront -> the designer for THAT storefront ---
    await gotoApp(page, "/dashboard");
    await expect(page.locator('[data-setup-step="storefront"]')).toContainText(
      /open your storefront/i,
    );
    url = await followAction(
      page,
      /open designer/i,
      new RegExp(`/storefront/${storefrontId}`),
    );
    expect(url.pathname).toBe(`/storefront/${storefrontId}`);

    // --- one imageless product -> that product's editor ---
    await createProductViaUI(page, { title: "Imageless piece", price: "12.00" });
    await gotoApp(page, "/dashboard");
    await expect(page.getByText(/1 product missing an image/i)).toBeVisible();
    url = await followAction(
      page,
      /add an image/i,
      /\/products\/[0-9a-f-]{36}\/edit/,
    );
    expect(url.pathname).toMatch(/^\/products\/[0-9a-f-]{36}\/edit$/);
    // It is the right product, not just a well-formed URL.
    await expect(page.getByLabel("Title")).toHaveValue("Imageless piece", {
      timeout: 20_000,
    });

    // --- several imageless products -> the product list ---
    await createProductViaUI(page, { title: "Second imageless", price: "13.00" });
    await gotoApp(page, "/dashboard");
    url = await followAction(page, /fix products/i, /\/products$/);
    expect(url.pathname).toBe("/products");

    // --- one flagged status -> the orders list, already filtered by it ---
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 4_500, status: "disputed", product_title: "Disputed one" },
    ]);
    await gotoApp(page, "/dashboard");
    await expect(page.getByText(/1 order to review/i)).toBeVisible();
    url = await followAction(page, /review orders/i, /\/orders\?status=disputed/);
    expect(url.pathname).toBe("/orders");
    expect(url.searchParams.get("status")).toBe("disputed");
    await expect(page.getByText("Disputed one").first()).toBeVisible();

    // --- both statuses flagged -> unfiltered, so neither is hidden ---
    await seedOrders(sellerId, [
      { amount_cents: 2_500, status: "refunded", product_title: "Refunded one" },
    ]);
    await gotoApp(page, "/dashboard");
    await expect(page.getByText(/2 orders to review/i)).toBeVisible();
    url = await followAction(page, /review orders/i, /\/orders$/);
    expect(url.pathname).toBe("/orders");
    expect(url.searchParams.get("status")).toBeNull();
    await expect(page.getByText("Disputed one").first()).toBeVisible();
    await expect(page.getByText("Refunded one").first()).toBeVisible();
  });
});
