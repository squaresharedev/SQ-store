import { devices, expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * `createStorefrontViaUI`, but able to survive a phone.
 *
 * The shared helper clicks "Skip setup", which on a 390px screen shares the
 * wizard's bottom bar with Next's own dev-tools badge — and loses, so the
 * click never becomes actionable. The badge is dev chrome that no seller ever
 * sees, so the press is forced past it rather than the spec being written
 * around a thing that is not part of the product.
 */
async function createStorefrontOnAPhone(page: Page) {
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await page.getByRole("button", { name: /skip setup/i }).click({ force: true });
  await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

/**
 * THE SELECTION TOOLBAR ON A PHONE.
 *
 * Its own file because `test.use` with a device forces a worker of its own,
 * and the desktop cases (44-selection-toolbar) share one.
 *
 * A phone is where this bar has to work hardest. It is the only route to
 * removing a block, cropping a photo or opening a product's page — a finger
 * has no hover, and the controls that used to be drawn on the tile are gone —
 * and it is competing for a 390px-wide screen with the tile it points at, the
 * two handles under that tile, and the inspector sheet that selecting the
 * block just opened along the bottom.
 */

const PHOTO = "https://images.e2e.invalid/toolbar-mobile.jpg";

test.use({ ...devices["iPhone 13"] });

test("a phone gets the bar as icons, clear of the tile and its handles", async ({
  page,
}) => {
  const user = freshUser("seltoolbarphone");
  await signUp(page, user);
  await seedProducts(await userIdByEmail(user.email), [
    { title: "Enamel Mug", image_key: PHOTO },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontOnAPhone(page);
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /add enamel mug|enamel mug/i })
    .first()
    .click();
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);

  await page.locator("li[data-grid-cell] [data-block-tile]").tap();

  const bar = page.locator("[data-selection-toolbar]");
  await expect(bar).toBeVisible();

  const viewport = page.viewportSize()!;
  const box = (await bar.boundingBox())!;
  expect(box.width, "the bar is wider than the phone").toBeLessThanOrEqual(
    viewport.width,
  );
  expect(box.x, "the bar hangs off the left edge").toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    "the bar hangs off the right edge",
  ).toBeLessThanOrEqual(viewport.width + 1);

  // Every button is a 44px touch target, and reachable — nothing is painted
  // over it.
  const buttons = await bar.getByRole("button").all();
  expect(buttons.length).toBeGreaterThanOrEqual(2);
  for (const button of buttons) {
    const b = (await button.boundingBox())!;
    expect(b.height, "a target smaller than a fingertip").toBeGreaterThanOrEqual(
      40,
    );
    const reached = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    });
    expect(reached, "something is painted over a toolbar button").toBe(true);
  }

  // And it is not sitting on the block or on the handles under it.
  const clear = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-selection-toolbar]")!;
    const cell = document.querySelector<HTMLElement>(
      "li[data-grid-cell]:has([data-block-selected])",
    )!;
    const b = el.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const handles = [
      ...cell.querySelectorAll<HTMLElement>("button[aria-label]"),
    ].map((h) => h.getBoundingClientRect());
    return {
      onFace: b.bottom > c.top + 1 && b.top < c.bottom - 1,
      onHandle: handles.some(
        (h) => b.left < h.right && b.right > h.left && b.top < h.bottom && b.bottom > h.top,
      ),
    };
  });
  expect(clear.onFace).toBe(false);
  expect(clear.onHandle).toBe(false);
});
