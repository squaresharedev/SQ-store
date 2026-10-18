import { expect, test } from "@playwright/test";
import { freshUser, seedOrders, seedStorefronts, signUp, userIdByEmail } from "./helpers";

// The analytics page's custom date range.
//
// The regression this exists for: the picker's value was the URL's alone, so a
// picked day showed nothing (no highlight, no label) until the server had
// re-queried the whole page. On a slow read that is several seconds of a
// click that looks as if it never registered.

test("a picked day shows at once, before the page has re-queried", async ({ page }) => {
  const user = freshUser("rangepick");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedStorefronts(sellerId, [{ name: "Range shop" }]);
  await seedOrders(sellerId, [
    { amount_cents: 2500, created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  ]);

  await page.goto("/analytics");
  const range = page.locator('[data-tour="analytics-range"]');
  await expect(range).toBeVisible({ timeout: 30_000 });
  await range.getByText("Custom").click();
  const trigger = range.locator('button[aria-haspopup="dialog"]');
  await trigger.click();
  const days = page.locator('[role="dialog"] [role="grid"] button:not([disabled])');
  await expect(days.first()).toBeVisible();

  // Hold the server's answer back, so only what the browser does on its own
  // can change the label.
  await page.route(/\/analytics\?.*_rsc=/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });

  await days.nth(3).click();
  await expect(trigger).not.toHaveText(/Pick a range/, { timeout: 1000 });
  await expect(days.nth(3)).toHaveClass(/bg-primary/);
  // And the control says the page is still catching up.
  await expect(range).toHaveAttribute("aria-busy", "true");

  // The other end, picked while the first is still on its way.
  await days.nth(9).click();
  await expect(trigger).not.toHaveText(/…/, { timeout: 1000 });
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/, { timeout: 60_000 });
  await expect(trigger).not.toHaveText(/…|Pick a range/);
  await expect(page.locator('[data-analytics-section="sales"]')).toBeVisible({ timeout: 30_000 });
  await expect(range).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
});
