import { expect, test } from "@playwright/test";

/**
 * Regression for a corner-resize grab that painted the tile smaller before
 * the hand had moved at all: the initial grab was read at the CENTRE of the
 * anchor's own far cell, half a cell short of that cell's true far edge, and
 * the live box used that reading directly as the edge position instead of
 * re-centring it first (see resizeLocalBox in gridConstants.ts).
 *
 * Exercised on the dev harness (same Grid + BlockTile pair as the designer,
 * no auth needed) rather than the designer itself, per the pattern in
 * 39-tile-frame-geometry.spec.ts. The resize handle only takes pointer events
 * once its tile is selected (it is otherwise `pointer-events-none` chrome
 * that fades in on hover/focus), so the tile is selected first.
 */

const HARNESS = "/dev/grid-playground";

/** The live box is written to the DOM from a requestAnimationFrame callback
 *  (see scheduleGesturePaint in Grid.tsx), so a read straight after a
 *  synthetic pointermove sees the pre-gesture layout. Two frames is enough
 *  for the scheduled paint to have landed. */
async function nextPaint(page: import("@playwright/test").Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("a corner-resize grab does not shrink the tile before the hand moves", async ({
  page,
}) => {
  await page.goto(HARNESS);
  const tile = page
    .locator("li[data-grid-cell]")
    .filter({ has: page.locator("img") });
  await expect(tile).toBeVisible();
  // The handle hangs below the tile, which the default viewport puts below
  // the fold — `page.mouse.*` operates in raw viewport coordinates and does
  // not auto-scroll the way a locator action does, so a click at its
  // unscrolled position lands past the bottom of the page and hits nothing.
  await tile.scrollIntoViewIfNeeded();

  // Select it: the handle is inert chrome until then.
  const tileBox = (await tile.boundingBox())!;
  await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2);
  await expect(tile.locator("[data-block-selected]")).toHaveCount(1);

  const before = (await tile.boundingBox())!;

  const handle = tile.getByRole("button", { name: /^resize/i });
  await expect(handle).toBeVisible();
  await handle.scrollIntoViewIfNeeded();
  const handleBox = (await handle.boundingBox())!;
  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;

  await page.mouse.move(hx, hy);
  await page.mouse.down();
  // One pixel of travel: enough to fire a pointermove and enter the resize
  // gesture, not enough to mean a deliberate resize. The tile must still
  // read as its original size here.
  await page.mouse.move(hx + 1, hy + 1);
  await nextPaint(page);

  // Sanity check on the harness itself: the gesture must actually have
  // engaged (an explicit inline size, imperatively written by the gesture
  // painter — see cell.style.width in Grid.tsx), or this test would also
  // pass with the click swallowed by opacity/pointer-events and nothing
  // having happened at all.
  const inlineWidth = await tile.evaluate((el) => (el as HTMLElement).style.width);
  expect(inlineWidth).not.toBe("");

  const duringGrab = (await tile.boundingBox())!;
  await page.mouse.up();

  // A pixel of slack for sub-pixel layout rounding, nothing more: the bug
  // shrank the tile by half a CELL, tens of pixels on this board.
  expect(duringGrab.width).toBeGreaterThanOrEqual(before.width - 1);
  expect(duringGrab.height).toBeGreaterThanOrEqual(before.height - 1);
});
