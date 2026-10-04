import { expect, test } from "@playwright/test";
import { freshUser, seedOrders, signUp, userIdByEmail } from "./helpers";

// TEMPORARY probe (deleted after use): the hero at the reporter's window size.
test.use({ viewport: { width: 1529, height: 860 }, deviceScaleFactor: 1.65 });

test("probe: figure inset at 1529 wide, loaded and navigated to", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const user = freshUser("hero-probe");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const day = 24 * 60 * 60 * 1000;
  const shape = [7, 6, 11, 10, 10, 4, 9, 6, 5.5, 11, 7, 10, 12, 10, 7, 5, 13, 12, 6.5, 8, 10, 5, 8, 10.5, 10, 8.5, 14, 10, 5, 4.5];
  await seedOrders(
    sellerId,
    shape.map((k, i) => ({
      amount_cents: Math.round(k * 100_000),
      created_at: new Date(Date.now() - (shape.length - 1 - i) * day - 60_000).toISOString(),
    })),
  );

  const insets = () =>
    page.evaluate(() => {
      const hero = document.querySelector('[data-analytics-section="sales"] [data-analytics-panel="trend"]')!;
      const frame = hero.getBoundingClientRect();
      const figure = hero.querySelector('[data-analytics-metric="sales.revenue"]')!.getBoundingClientRect();
      const heading = document.querySelector("#analytics-sales")!.parentElement!.parentElement!.getBoundingClientRect();
      const overlay = hero.querySelector('[data-analytics-metric="sales.revenue"]')!.parentElement!;
      return {
        frameLeft: frame.left,
        frameWidth: frame.width,
        figureInset: figure.left - frame.left,
        headingRowLeft: heading.left - frame.left,
        overlayClass: overlay.className,
        overlayPaddingLeft: getComputedStyle(overlay).paddingLeft,
      };
    });

  // 1. A full page load (server-rendered).
  await page.goto("/analytics");
  await page.mouse.move(0, 0);
  await expect(page.locator(".recharts-area-curve").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  console.log("LOADED", JSON.stringify(await insets()));
  await page.screenshot({ path: testInfo.outputPath("probe-loaded.png") });

  // 2. Arrived at by clicking the rail link from another page (client-rendered).
  await page.goto("/orders");
  await page.getByRole("link", { name: "Analytics" }).first().click();
  await page.waitForURL(/\/analytics/);
  await page.mouse.move(0, 0);
  await expect(page.locator(".recharts-area-curve").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  console.log("NAVIGATED", JSON.stringify(await insets()));
  await page.screenshot({ path: testInfo.outputPath("probe-navigated.png") });
});
