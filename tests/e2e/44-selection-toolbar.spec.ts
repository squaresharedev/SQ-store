import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * THE SELECTED BLOCK'S TOOLBAR, IN THE REAL DESIGNER.
 *
 * The controls for a block used to be a chip welded to its tile. They are one
 * floating island now (SelectionToolbar), which raises three questions a
 * component test cannot answer, because all three are about the board:
 *
 *   - does it find its block? The bar is placed from the cells' on-screen
 *     boxes, so it has to be right at whatever pan and zoom the canvas opens
 *     at, and stay right when the block is moved;
 *   - does it stay clear of the two handles that hang under a tile? A bar
 *     parked on them hides the only route a touchscreen has to resize or
 *     rotate;
 *   - does it offer the right things for the block that is actually selected —
 *     a product's page and crop, a shape's colour and outline.
 */

const PHOTO = "https://images.e2e.invalid/toolbar.jpg";

async function setUpBoard(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [{ title: "Enamel Mug", image_key: PHOTO }]);

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
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
}

/** Where the bar sits relative to the block it belongs to. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-selection-toolbar]");
    const cell = document.querySelector<HTMLElement>(
      "li[data-grid-cell]:has([data-block-selected])",
    );
    if (!bar || !cell) return null;
    const b = bar.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const handles = [
      ...cell.querySelectorAll<HTMLElement>("button[aria-label]"),
    ].map((el) => el.getBoundingClientRect());
    return {
      centredOn: Math.round(b.left + b.width / 2 - (c.left + c.width / 2)),
      above: b.bottom <= c.top + 1,
      below: b.top >= c.bottom - 1,
      // Never drawn over the tile's own face.
      onFace: b.bottom > c.top + 1 && b.top < c.bottom - 1,
      // Nor over a handle, which is the thing it could most easily bury.
      onHandle: handles.some(
        (h) =>
          b.left < h.right && b.right > h.left && b.top < h.bottom && b.bottom > h.top,
      ),
    };
  });
}

test.describe("the selection toolbar", () => {
  test("floats over the selected block and follows it", async ({ page }) => {
    await setUpBoard(page, "seltoolbar");
    const tile = page.locator("li[data-grid-cell] [data-block-tile]");

    // Nothing selected, nothing offered.
    await expect(page.locator("[data-selection-toolbar]")).toHaveCount(0);

    await tile.click();
    await expect(page.locator("[data-selection-toolbar]")).toBeVisible();

    const at = (await geometry(page))!;
    expect(at.onFace, "the bar is drawn over the tile's own face").toBe(false);
    expect(at.onHandle, "the bar is drawn over a resize or rotate handle").toBe(
      false,
    );
    expect(Math.abs(at.centredOn), "not centred on its block").toBeLessThanOrEqual(2);
    expect(at.above || at.below).toBe(true);

    // It is tied to the block by position, so moving the block moves it.
    const before = (await page
      .locator("[data-selection-toolbar]")
      .boundingBox())!;
    await tile.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => {
        const box = await page.locator("[data-selection-toolbar]").boundingBox();
        return box ? Math.round(box.x) : 0;
      })
      .not.toBe(Math.round(before.x));
    const moved = (await geometry(page))!;
    expect(Math.abs(moved.centredOn)).toBeLessThanOrEqual(2);
  });

  test("offers a product its page and its crop", async ({ page }) => {
    await setUpBoard(page, "seltoolbarprod");
    await page.locator("li[data-grid-cell] [data-block-tile]").click();

    const bar = page.locator("[data-selection-toolbar]");
    await expect(bar.getByRole("button", { name: /open the product page/i })).toBeVisible();
    await expect(bar.getByRole("button", { name: /frame the image/i })).toBeVisible();
    await expect(bar.getByRole("button", { name: /remove .* from grid/i })).toBeVisible();
    // The block's name is in the accessible names, not drawn on the bar: it
    // was the widest thing on it, and the bar has to fit over its own tile.
    await expect(bar).not.toContainText("Enamel Mug");

    // The page node still opens the page beside the board.
    await bar.locator('button[data-page-node="closed"]').click();
    await expect(bar.locator('button[data-page-node="open"]')).toBeVisible();
  });

  test("offers a shape its colour and its outline, and no name", async ({
    page,
  }) => {
    await setUpBoard(page, "seltoolbarshape");
    // The Element menu carries the common shapes itself; the library behind it
    // is a panel away and not needed for one square.
    await page.getByRole("button", { name: "Add element" }).click();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "Add square" })
      .click();

    // Closing the library makes the board step back out from under it, and a
    // click aimed before that settles lands where the tile WAS.
    await canvasStill(page);
    const shape = page.locator("li[data-grid-cell]").nth(1).locator("[data-block-tile]");
    // Inserting a block SELECTS it, so a click here would toggle it back off.
    if ((await shape.getAttribute("data-block-selected")) === null) {
      await shape.click();
    }
    await expect(shape).toHaveAttribute("data-block-selected", "");

    const bar = page.locator("[data-selection-toolbar]");
    // Canva's four, in Canva's order. The two whole-block actions after the
    // divider (duplicate, remove) are not part of them.
    await expect(
      bar.locator("button").evaluateAll((els) =>
        els
          .map((el) => el.getAttribute("aria-label") ?? "")
          .filter((name) => !/remove|duplicate/i.test(name)),
      ),
    ).resolves.toEqual([
      "Change the colour of Square",
      "Edit the stroke of Square",
      "Edit the corner roundness of Square",
      "Edit the opacity of Square",
    ]);
    // Icons only, so the bar stays narrower than the block it points at.
    await expect(bar).not.toContainText("Square");
    // And nothing that belongs to a product.
    await expect(bar.getByRole("button", { name: /product page/i })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /frame the image/i })).toHaveCount(0);

    // EACH ONE POINTS AT THE PANEL rather than opening a slider over the
    // block. A popover here covers the very shape whose number is being
    // dragged; the inspector is docked beside the canvas and covers nothing.
    // Stroke, corners and opacity are all slider fields: no wash on the row
    // around them, the slider itself lights up in the accent (see
    // SummonedField's "slider" variant and `.ss-slider[data-highlighted]`).
    await bar.getByRole("button", { name: /edit the stroke/i }).click();
    await expect(
      page.locator("[data-block-field='stroke'] [role='slider'][data-highlighted]"),
    ).toBeVisible();
    await expect(
      page.getByRole("spinbutton", { name: /border thickness/i }),
    ).toBeVisible();


    await bar.getByRole("button", { name: /corner roundness/i }).click();
    await expect(
      page.locator("[data-block-field='corners'] [role='slider'][data-highlighted]"),
    ).toBeVisible();

    await bar.getByRole("button", { name: /edit the opacity/i }).click();
    await expect(
      page.locator("[data-block-field='opacity'] [role='slider'][data-highlighted]"),
    ).toBeVisible();

    // Nothing was drawn over the board to do any of it.
    await expect(page.locator("[data-toolbar-popover]")).toHaveCount(0);

    // And the panel's control really drives this block: 40% roundness typed
    // there is 40% on the shape's own field afterwards.
    await page.getByRole("spinbutton", { name: /corner roundness/i }).fill("40");
    await expect(
      page.getByRole("spinbutton", { name: /corner roundness/i }),
    ).toHaveValue("40");

    // Colour opens the colour panel on this shape's own fill.
    await bar.getByRole("button", { name: /change the colour/i }).click();
    await expect(page.locator("[data-canvas-panel]").first()).toBeVisible();
  });

});
