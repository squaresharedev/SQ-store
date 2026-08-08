import { expect, test, type Page } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

/**
 * SETTINGS BETWEEN THE RAILS.
 *
 * The dashboard rail pins itself open at md (768px) and takes 16rem. If the
 * settings sub-nav also became a 15rem rail there, the two of them ate the
 * window and the settings content was left narrower than it gets on a phone.
 * So the settings layout flips at lg, not md, and this file guards the seam
 * from both sides: still a strip at 770, a real column at 1024, and enough
 * room for the content at each.
 *
 * Widths are asserted against the CARD, not the viewport — that is the number
 * the regression was actually about.
 */

/** Narrower than this and the forms inside the cards start to suffer. */
const MIN_CARD_WIDTH = 400;

async function navAxis(page: Page) {
  return page
    .getByRole("navigation", { name: "Settings sections" })
    .evaluate((el) => ({
      direction: getComputedStyle(el).flexDirection,
      scrollable: el.scrollWidth > el.clientWidth,
    }));
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(
      doc.scrollWidth - doc.clientWidth,
      document.body.scrollWidth - doc.clientWidth,
    );
  });
}

/** The first settings card on the page — what the content actually gets. */
function card(page: Page) {
  return page.locator("main section, section").first();
}

test.describe("settings — between the rails", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page, freshUser("settab"));
    await page.waitForLoadState("networkidle").catch(() => {});
  });

  test("at 770px the sub-nav is still a strip and the content keeps its width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 770, height: 900 });
    await gotoApp(page, "/settings/account");

    // The dashboard rail is open here; a second rail beside it is what broke.
    const nav = await navAxis(page);
    expect(nav.direction, "sub-nav should still be a row at 770px").toBe("row");
    expect(nav.scrollable, "the strip should swipe, not wrap").toBe(true);

    const box = (await card(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("at 1024px the sub-nav becomes a column, still leaving room for the content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await gotoApp(page, "/settings/account");

    const nav = await navAxis(page);
    expect(nav.direction, "sub-nav should be a column at lg").toBe("column");

    // The whole point of waiting until lg: the second rail has to be affordable.
    const box = (await card(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("the heading appears once the mobile top bar stops carrying it", async ({
    page,
  }) => {
    // Below md the top bar says "Settings", so the rail heading is sr-only.
    await page.setViewportSize({ width: 700, height: 900 });
    await gotoApp(page, "/settings/account");
    const heading = page.getByRole("heading", { name: "Settings", level: 1 });
    expect((await heading.boundingBox())!.height).toBeLessThanOrEqual(1);

    // At md the bar is gone, so the heading has to draw itself.
    await page.setViewportSize({ width: 900, height: 900 });
    expect((await heading.boundingBox())!.height).toBeGreaterThan(10);
  });
});
