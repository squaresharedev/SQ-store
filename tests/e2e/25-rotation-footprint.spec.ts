import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * Turning a block changes WHICH WAY ROUND its cells lie, and nothing else.
 *
 * The geometry is pinned in tests/unit/rotated-box.test.ts. What only the
 * browser can show is that the board agrees with it: that a 1x3 bar turned a
 * quarter turn covers three cells across instead of three down, that the
 * empty-cell guides say so, and that the block itself has not moved or
 * changed size while that happened.
 */

/** Every cell's grid area, in DOM order: "col / span n|row / span n". */
async function areas(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
      (cell) => `${cell.style.gridColumn}|${cell.style.gridRow}`,
    ),
  );
}

/** How many free-cell buttons the board is drawing. */
async function freeCells(page: Page): Promise<number> {
  return page.locator("button[data-grid-empty]").count();
}

async function setUpBar(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);

  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "All shapes" })
    .click();
  await page.getByRole("button", { name: "Add square" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close library panel" }).click();

  // A 1x3 bar in the top-left corner: tall, against both edges, so a quarter
  // turn has to take it somewhere.
  const tile = page.locator("li[data-grid-cell]").first();
  await growToRows(page, tile, 2);
  await growToRows(page, tile, 3);
  return user;
}

/**
 * Grow the block to `span` rows with Shift+Arrow, one row at a time.
 *
 * Checked BEFORE each press rather than after, so a lost press is retried and
 * a slow render can never grow the block past the target. The tile is
 * re-focused each time: it re-renders as it resizes, and a press that lands
 * while focus is elsewhere is simply dropped.
 */
async function growToRows(page: Page, tile: Locator, span: number) {
  const target = `1 / span 1|1 / span ${span}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await areas(page))[0] === target) return;
    await tile.locator("[data-block-tile]").focus();
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(120);
  }
  throw new Error(`Could not grow the block to ${span} rows`);
}

test.describe("a turned block covers different cells", () => {
  test("the same three cells, lying the other way round", async ({ page }) => {
    await setUpBar(page, "footguides");
    // One column in, so the bar has a cell either side of it to lie across
    // once it is turned and the whole of it stays on the board.
    const tile = page.locator("li[data-grid-cell]").first();
    await tile.locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => areas(page)).toEqual(["2 / span 1|1 / span 3"]);

    // A 6x6 board with a 1x3 bar on it: 36 cells less the 3 it covers.
    expect(await freeCells(page)).toBe(33);
    /** Which of a row's six cells still show a guide. */
    const guidesInRow = (row: number) =>
      page.evaluate((line) => {
        const drawn = new Set(
          [
            ...document.querySelectorAll<HTMLElement>("button[data-grid-empty]"),
          ].map((button) => button.getAttribute("aria-label")),
        );
        return [1, 2, 3, 4, 5, 6].map((column) =>
          drawn.has(`Add a block at column ${column}, row ${line}`),
        );
      }, row);

    // Standing up: column 2 is covered for three rows.
    expect(await guidesInRow(2)).toEqual([true, false, true, true, true, true]);

    await page.getByRole("button", { name: "Rotate to 90 degrees" }).click();
    await page.waitForTimeout(200);

    // Lying down: STILL three cells, now three columns of one row. This is the
    // whole rule in one assertion, and the board's own account of it.
    expect(await freeCells(page)).toBe(33);
    expect(await guidesInRow(2)).toEqual([false, false, false, true, true, true]);
    // Row 1 and row 3 got their guides back.
    expect(await guidesInRow(1)).toEqual([true, true, true, true, true, true]);
    expect(await guidesInRow(3)).toEqual([true, true, true, true, true, true]);
  });

  test("turning a block never moves it or resizes it", async ({ page }) => {
    // The whole contract of the rotate control, and the thing it must not get
    // wrong: the seller asked for a turn, so a turn is all they get. Not a
    // nudge onto the board, not a bigger block, not a neighbour shoved aside.
    await setUpBar(page, "footstill");
    const before = await areas(page);

    for (const angle of ["Rotate to 90 degrees", "Rotate to -90 degrees"]) {
      await page.getByRole("button", { name: angle }).click();
      await page.waitForTimeout(150);
      // The bar is against the left edge, which is where a block gets shoved
      // if anything is going to shove it.
      expect(await areas(page)).toEqual(before);
    }

    await page.getByRole("button", { name: "Level the block" }).click();
    await page.waitForTimeout(150);
    expect(await areas(page)).toEqual(before);
  });

  test("an arrow into the board's edge changes nothing at all", async ({
    page,
  }) => {
    // The bar is in the top-left corner, so up and left are both walls. A
    // press that cannot move the block must not report a move either: doing so
    // marks the editor dirty and pushes an undo step for a key that did
    // nothing, which is how a seller ends up with a Save button they cannot
    // explain and an undo that appears to do nothing.
    await setUpBar(page, "footwall");
    // Saved first, so "unsaved changes" means something: building the bar is
    // itself a real edit.
    await page.getByRole("button", { name: "Save" }).click();
    // The header's dirty signal, as a whole: it renders the phrase twice (wide
    // and screen-reader-only), so the status region is the thing to watch
    // rather than either copy of the words.
    const unsaved = page.locator('[role="status"]', {
      hasText: "Unsaved changes",
    });
    await expect(unsaved).toBeHidden();

    const before = await areas(page);
    const guides = await freeCells(page);
    const tile = page.locator("li[data-grid-cell]").first();
    await tile.locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);

    expect(await areas(page)).toEqual(before);
    expect(await freeCells(page)).toBe(guides);
    await expect(unsaved).toBeHidden();

    // A press that CAN move it still does, so the guard has not simply turned
    // the arrows off.
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => areas(page)).toEqual(["2 / span 1|1 / span 3"]);
    await expect(unsaved).toBeVisible();
  });
});
