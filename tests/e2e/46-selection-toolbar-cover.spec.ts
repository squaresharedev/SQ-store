import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * THE SELECTION TOOLBAR AND THE PANELS IT HAS TO SHARE A SCREEN WITH.
 *
 * The bar is clamped inside the canvas window so it can never sail off the
 * edge — which is exactly what put it on top of an open panel: pan the block
 * under the colour column and the bar stops at the window's left edge and sits
 * over the column, offering tools for a block nobody can see.
 *
 * It measures the open part of the window now (`data-canvas-panel` +
 * panelInset, the same cover the board itself steps out from under), so:
 *
 *   - it never parks on an open panel, and
 *   - when the block it points at has gone under one, or off the side, it
 *     stands down until the block is back.
 *
 * The third case here is the pair of whole-block actions the bar ends on: with
 * no keyboard, this is the only route to duplicating a block.
 */

/** A board with one square on it, selected. */
async function setUpShape(page: Page, tag: string) {
  await signUp(page, freshUser(tag));
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "Add square" })
    .click();
  await canvasStill(page);
  const shape = page.locator("li[data-grid-cell]").first().locator("[data-block-tile]");
  if ((await shape.getAttribute("data-block-selected")) === null) {
    await shape.click();
    await canvasStill(page);
  }
  await expect(shape).toHaveAttribute("data-block-selected", "");
  return shape;
}

test("the bar duplicates a block, and keeps off an open panel", async ({ page }) => {
  await setUpShape(page, "seltoolbarcover");
  const bar = page.locator("[data-selection-toolbar]");
  await expect(bar).toBeVisible();

  // ONE ISLAND, AND IT FITS. Whatever the block, the bar stays inside the cap
  // that keeps it reading as a thing held over one tile.
  const barBox = (await bar.boundingBox())!;
  expect(barBox.width, "the bar has outgrown its cap").toBeLessThanOrEqual(384);

  // --- Duplicate: the no-keyboard copy/paste, on the bar itself. ---
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  await bar.getByRole("button", { name: /^duplicate/i }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);

  // --- And it does not sit on the colour panel it just opened. ---
  await canvasStill(page);
  await bar.getByRole("button", { name: /change the colour/i }).click();
  const panel = page.locator("[data-canvas-panel]").first();
  await expect(panel).toBeVisible();
  await canvasStill(page);

  const overlap = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-selection-toolbar]");
    const cover = document.querySelector<HTMLElement>("[data-canvas-panel]");
    if (!el || !cover) return null;
    // A bar that has stood down entirely is also "not on the panel".
    const hidden = getComputedStyle(el).visibility === "hidden";
    const b = el.getBoundingClientRect();
    const p = cover.getBoundingClientRect();
    return {
      hidden,
      on: b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top,
    };
  });
  expect(overlap).not.toBeNull();
  expect(overlap!.hidden || !overlap!.on, "the bar is parked on an open panel").toBe(
    true,
  );
});

test("a summoned control lands in the middle of the panel", async ({ page }) => {
  await setUpShape(page, "seltoolbarsummon");

  // Park the panel at its head, so the field being asked for is below the
  // fold. `block: "nearest"` used to answer this by moving the least it could
  // get away with, which lands the field flush against the panel's bottom edge
  // with none of its own group in sight.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>("[data-design-panel] *").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
    });
  });

  await page
    .locator("[data-selection-toolbar]")
    .getByRole("button", { name: /edit the stroke/i })
    .click();
  await expect(
    page.locator("[data-block-field='stroke'] [role='slider'][data-highlighted]"),
  ).toBeVisible();

  // Where it ended up, as a percentage of the panel's own height. Polled
  // because the scroll is smooth: the answer arrives over a few frames.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const field = document.querySelector<HTMLElement>(
            "[data-block-field='stroke']",
          );
          if (!field) return -1;
          let node = field.parentElement;
          while (node && !(node.scrollHeight > node.clientHeight + 1)) {
            node = node.parentElement;
          }
          if (!node) return -1;
          const f = field.getBoundingClientRect();
          const p = node.getBoundingClientRect();
          return Math.round(((f.top + f.height / 2 - p.top) / p.height) * 100);
        }),
      { message: "the summoned field is jammed against an edge of the panel" },
    )
    // Room below it, rather than flush with the bottom edge (which is where
    // "nearest" put it, at ~93%). Not 50: this panel runs out of content below
    // the field, and clamping is the right answer once it does.
    .toBeLessThan(85);
});

test("the bar stands down when its block is panned out of view", async ({ page }) => {
  await setUpShape(page, "seltoolbaraway");
  const bar = page.locator("[data-selection-toolbar]");
  await expect(bar).toBeVisible();

  // Shove the board far enough that the selected cell leaves the window
  // entirely. Wheel over the canvas is the pan gesture.
  const canvas = page.locator("main").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, 400);
  }

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const cell = document.querySelector<HTMLElement>(
            "li[data-grid-cell]:has([data-block-selected])",
          );
          const area = document.querySelector<HTMLElement>("main");
          if (!cell || !area) return "no-cell";
          const c = cell.getBoundingClientRect();
          const a = area.getBoundingClientRect();
          return c.bottom < a.top || c.top > a.bottom ? "gone" : "visible";
        }),
      { message: "the board never panned the block out of the window" },
    )
    .toBe("gone");

  // The block is off screen, so its tools have nothing to point at.
  await expect(bar).toBeHidden();
});
