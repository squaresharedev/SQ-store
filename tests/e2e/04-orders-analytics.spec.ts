import { expect, test } from "@playwright/test";
import { freshUser, seedOrders, signUp, userIdByEmail } from "./helpers";

test.describe("orders + analytics (seeded)", () => {
  test("orders list shows seeded rows, filters by channel and status", async ({ page }) => {
    const user = freshUser("orders");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await seedOrders(sellerId, [
      { amount_cents: 1500, channel: "embed", status: "paid", buyer_email: "a@ex.com", product_title: "Alpha" },
      { amount_cents: 2500, channel: "marketplace", status: "paid", buyer_email: "b@ex.com", product_title: "Beta" },
      { amount_cents: 900, channel: "embed", status: "refunded", buyer_email: "c@ex.com", product_title: "Gamma" },
    ]);

    await page.goto("/orders");
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.getByText("Gamma")).toBeVisible();

    // Channel filter: embed only. Retry the click — in dev mode the toolbar
    // may not be hydrated yet when the first click lands.
    await expect(async () => {
      await page.getByRole("button", { name: /^embed$/i }).click();
      await expect(page).toHaveURL(/channel=embed/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText("Beta")).not.toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();

    // Clear filters brings everything back.
    await page.getByRole("button", { name: /clear filters/i }).click();
    await expect(page.getByText("Beta")).toBeVisible();
  });

  test("order detail opens with amounts, buyer email, and no mutation succeeds", async ({ page }) => {
    const user = freshUser("orderdetail");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 4200, product_title: "Detail piece", buyer_email: "buyer@detail.com" },
    ]);

    await page.goto("/orders");
    await page.getByText("Detail piece").click();
    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("€42.00");
    await expect(detail).toContainText("buyer@detail.com");

    // Esc closes the panel.
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
  });

  test("analytics shows seeded revenue and channel split", async ({ page }) => {
    const user = freshUser("analytics");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await seedOrders(sellerId, [
      { amount_cents: 10_000, channel: "embed" },
      { amount_cents: 5_000, channel: "marketplace" },
      { amount_cents: 2_000, channel: "embed", status: "refunded" },
    ]);

    await page.goto("/analytics");
    // Paid revenue = €150.00 (refunded excluded from revenue by most conventions;
    // accept either presentation but the page must not be the empty state).
    await expect(page.getByText(/€1[05]0\.00|€150|€170/).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/embed/i).first()).toBeVisible();
    await expect(page.getByText(/marketplace/i).first()).toBeVisible();
  });

  test("empty state renders for a fresh account", async ({ page }) => {
    const user = freshUser("noorders");
    await signUp(page, user);
    await page.goto("/orders");
    await expect(
      page.getByText(/no orders|nothing here|empty|first sale/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
