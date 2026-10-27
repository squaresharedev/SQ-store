import { expect, test } from "@playwright/test";
import { freshUser, signUp } from "./helpers";

/**
 * A SLOW CLICK ANSWERS BACK.
 *
 * Click a sidebar link while the server is slow and the page used to sit
 * still until the new one arrived. Now a thin bar crosses the top of the
 * window once the wait outlasts the delay (ui/motion-tokens PENDING_DELAY_MS),
 * and goes when the page lands. The wait is staged here by holding back the
 * page's own request.
 */

const HOLD_MS = 1_500;

test("a slow page change shows the progress bar, and the bar leaves with the wait", async ({ page }) => {
  await signUp(page, freshUser("slowclick"));

  // Hold the Orders page's data request, the one a client-side move makes.
  await page.route(
    (url) => url.pathname === "/orders" && url.searchParams.has("_rsc"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await route.continue();
    },
  );

  const bar = page.locator(".nav-progress-bar");
  await expect(bar).toHaveCount(0);

  await page.locator('a[href="/orders"]').first().click();

  // Past the delay and before the page lands: the bar, and its spoken twin.
  await expect(bar).toBeVisible({ timeout: HOLD_MS });
  await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toHaveCount(1);

  await expect(page).toHaveURL(/\/orders/);
  await expect(bar).toHaveCount(0, { timeout: 5_000 });
});
