import { expect, test, type Page } from "@playwright/test";

/**
 * A SELECTION MOVES AS ONE OBJECT.
 *
 * Dragging a tile that is part of a selection used to carry that tile alone
 * and leave the rest of the selection where it was, which is not what "these
 * three are selected" means anywhere else in the editor: Delete takes all of
 * them, Rotate takes all of them, and the inspector edits all of them.
 *
 * The grid itself stays selection-agnostic — it is handed a list of keys that
 * travel together (`groupKeys`) and one callback for where they landed
 * (`onMoveMany`, so several tiles arriving somewhere new is ONE undo step).
 * What that leaves to prove is geometry, which only a real board can answer:
 *
 *   - every selected block moves, by the SAME whole-cell delta, so the group
 *     arrives in the arrangement it left in;
 *   - a group runs out of room as a body rather than letting the blocks with
 *     room keep going, which would deform it;
 *   - the keyboard agrees with the pointer, since an arrow is the other way to
 *     move a block and the two must not mean different things;
 *   - a lone block still moves alone.
 *
 * Driven on the dev harness (the same Grid + BlockTile pair the designer
 * renders, no sign-in) per the pattern in 41-corner-resize-grab.
 */

const HARNESS = "/dev/grid-playground";

/**
 * The two the harness seeds that can travel together: a 2x2 square at the
 * board's top-left and a 1x1 circle three columns along it, both clear of the
 * product tile below them. Named rather than picked by position, so a change to
 * the harness's board fails loudly here instead of quietly testing nothing.
 */
const SQUARE = "s_00000000-0000-4000-8000-000000000001";
const CIRCLE = "s_00000000-0000-4000-8000-000000000002";
/** A third, well away from both, that must not move when they do. */
const DIAMOND = "s_00000000-0000-4000-8000-000000000003";

/** The gesture paints from a requestAnimationFrame callback, and the commit
 *  lands on pointerup; two frames is enough for both to have settled. */
async function nextPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Every cell's grid coordinates, by key, read off the layout the browser
 *  actually resolved rather than off the harness's own state. */
async function placements(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const cell of document.querySelectorAll<HTMLElement>(
      "li[data-grid-cell][data-grid-key]",
    )) {
      const style = getComputedStyle(cell);
      // "3 / span 2" — the grid line is 1-based, the block's own x is not.
      out[cell.dataset.gridKey!] = {
        x: Number.parseInt(style.gridColumnStart, 10) - 1,
        y: Number.parseInt(style.gridRowStart, 10) - 1,
      };
    }
    return out;
  });
}

function cellOf(page: Page, key: string) {
  return page.locator(`li[data-grid-cell][data-grid-key="${key}"]`);
}

/** The centre of one cell, in viewport coordinates. */
async function centreOf(page: Page, key: string) {
  const box = (await cellOf(page, key).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Open the harness with its board on screen and STILL.
 *
 *  The board is measured in a layout effect and the cells resize with it, so a
 *  cold arrival — the first visit compiles the route, and the web fonts land
 *  after that — moves the tiles a frame or two after they are first visible.
 *  A click aimed before that settles lands where the tile WAS, which is how
 *  this file's first test could fail on a gesture its other three perform
 *  happily a moment later. Wait for the geometry to stop changing. */
async function openBoard(page: Page) {
  await page.goto(HARNESS);
  await expect(cellOf(page, SQUARE)).toBeVisible();
  await cellOf(page, SQUARE).scrollIntoViewIfNeeded();
  await boardStill(page);
}

/** Wait until the board's cells stop moving: the same box twice in a row. */
async function boardStill(page: Page, timeout = 5_000) {
  const read = async () =>
    JSON.stringify(await placements(page)) +
    JSON.stringify(await cellOf(page, SQUARE).boundingBox());
  const deadline = Date.now() + timeout;
  let last = await read();
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = await read();
    if (now === last) return;
    last = now;
  }
}

/** Select two blocks: a plain click on the first, shift-click on the second —
 *  the same gesture the designer's board takes.
 *
 *  Each half is asserted on its own so a failure says WHICH click missed, and
 *  so the shift-click is never aimed at a board that the first click has just
 *  re-laid out. */
async function selectBoth(page: Page) {
  await cellOf(page, SQUARE).locator("[data-block-tile]").click();
  await expect(page.locator("[data-block-selected]")).toHaveCount(1);
  await cellOf(page, CIRCLE)
    .locator("[data-block-tile]")
    .click({ modifiers: ["Shift"] });
  await expect(page.locator("[data-block-selected]")).toHaveCount(2);
}

/** The board's own column pitch in screen pixels — cell plus gap, the same
 *  quantity the grid's gestures divide the pointer's travel by. Measured off
 *  the live grid so this never has to guess at cell sizes. */
async function strideX(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("ul[aria-label]")!;
    const rect = grid.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const columns = Number.parseInt(
      getComputedStyle(grid).getPropertyValue("--ss-cols"),
      10,
    );
    return (rect.width - (columns - 1) * gap) / columns + gap;
  });
}

/** Drag one cell by `cells` whole cells horizontally. The first small step is
 *  what turns the press into a drag: a single jump can land in the same frame
 *  as the press and never cross the threshold. */
async function dragBy(page: Page, key: string, cells: number) {
  const pitch = await strideX(page);
  const from = await centreOf(page, key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(cells) * 8, from.y);
  await page.mouse.move(from.x + pitch * cells, from.y);
  await nextPaint(page);
}

test.describe("moving a selection", () => {
  test("carries every selected block by the same step", async ({ page }) => {
    await openBoard(page);
    await selectBoth(page);
    const before = await placements(page);

    await dragBy(page, SQUARE, 1);
    // MID-DRAG both cells are lifted, and each has a landing ghost of its own:
    // a selection being carried has to show where all of it is going, not just
    // where the tile under the hand is.
    await expect(page.locator("li[data-grid-cell][data-valid]")).toHaveCount(2);

    await page.mouse.up();
    await nextPaint(page);

    const after = await placements(page);
    expect(after[SQUARE].x - before[SQUARE].x).toBe(1);
    expect(
      after[CIRCLE].x - before[CIRCLE].x,
      "the other selected block stayed behind",
    ).toBe(1);
    expect(after[SQUARE].y).toBe(before[SQUARE].y);
    expect(after[CIRCLE].y).toBe(before[CIRCLE].y);
    expect(
      after[DIAMOND],
      "an unselected block travelled with the selection",
    ).toEqual(before[DIAMOND]);
  });

  test("runs out of room as a body rather than deforming", async ({ page }) => {
    await openBoard(page);
    await selectBoth(page);

    const before = await placements(page);
    const gap = before[CIRCLE].x - before[SQUARE].x;

    // Far past the right-hand edge. The circle reaches the last column first;
    // clamping per block would let the square keep going and close this gap.
    await dragBy(page, SQUARE, 5);
    await page.mouse.up();
    await nextPaint(page);

    const after = await placements(page);
    expect(after[CIRCLE].x - after[SQUARE].x, "the group changed shape").toBe(
      gap,
    );
    // And it really did move, so this is not a test that passes by doing
    // nothing at all.
    expect(after[SQUARE].x).toBeGreaterThan(before[SQUARE].x);
  });

  test("an arrow key moves what the pointer would", async ({ page }) => {
    await openBoard(page);
    await selectBoth(page);

    const before = await placements(page);
    // The cell listens for the key; the tile inside it is what takes focus.
    await cellOf(page, SQUARE).locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowDown");
    await nextPaint(page);

    const after = await placements(page);
    expect(after[SQUARE].y - before[SQUARE].y).toBe(1);
    expect(
      after[CIRCLE].y - before[CIRCLE].y,
      "the arrow moved the focused block only",
    ).toBe(1);
    expect(after[DIAMOND]).toEqual(before[DIAMOND]);
  });

  test("a lone block still moves alone", async ({ page }) => {
    // The group path must not have taken over the ordinary one: with a single
    // selection a drag carries exactly the tile under the hand.
    await openBoard(page);
    const square = await centreOf(page, SQUARE);
    await page.mouse.click(square.x, square.y);
    await expect(page.locator("[data-block-selected]")).toHaveCount(1);

    const before = await placements(page);
    await dragBy(page, SQUARE, 1);
    await expect(page.locator("li[data-grid-cell][data-valid]")).toHaveCount(1);
    await page.mouse.up();
    await nextPaint(page);

    const after = await placements(page);
    expect(after[SQUARE].x - before[SQUARE].x).toBe(1);
    expect(after[CIRCLE]).toEqual(before[CIRCLE]);
  });
});
