import { expect, test, type Page } from "@playwright/test";

/**
 * A QUARTER-TURNED BLOCK SITS ON THE BOARD'S OWN LINES, whatever is done to it.
 *
 * The bug: rotate a tile, resize it in any direction, and the whole container
 * ends up offset from the grid — out of line with every level tile beside it,
 * and not on the cells the drag's own ghost promised. A block is drawn turned
 * about its centre, so a quarter turn moves its corners by (w - h) / 2; the
 * moment a resize makes those two differ in parity that is HALF A CELL, and no
 * whole-number placement can express the correction.
 *
 * The arithmetic is swept exhaustively in tests/unit/rotated-box.test.ts. What
 * only a browser can show is that the correction reaches the paint: that the
 * box the eye sees, after a real rotate and a real resize, lands on the lines.
 *
 * Driven through the dev harness rather than the designer: it renders the same
 * Grid and BlockTile, needs no auth or storefront, and its board is a known
 * 6x6 so a cell coordinate means something exact.
 */

const HARNESS = "/dev/grid-playground";
/** The blue 2x2 square. Square on purpose: it starts aligned at every angle,
 *  so any offset that appears came from the resize under test. */
const SQUARE = "s_00000000-0000-4000-8000-000000000001";
const COLUMNS = 6;

/**
 * Wait until React has taken over. The harness's own corner toggle is pure
 * state, so a label that flips proves the handlers are live — which a plain
 * load event does not, and a hydrating board silently ignores every key.
 */
async function hydrated(page: Page) {
  const toggle = page.getByRole("button", { name: /corners/i });
  await expect(async () => {
    const before = await toggle.textContent();
    await toggle.click();
    expect(await toggle.textContent()).not.toBe(before);
  }).toPass({ timeout: 30_000 });
  await toggle.click(); // leave it as it was found
}

/**
 * Where a cell PAINTS, in board cells, straight off the browser.
 *
 * The axis-aligned envelope, which at a quarter turn is the tile itself — and
 * a quarter turn is the only angle at which "on the grid" means anything.
 */
async function paintedCells(page: Page, key: string) {
  return page.evaluate((blockKey) => {
    const grid = document.querySelector<HTMLElement>("ul.ss-grid")!;
    const g = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gapX = Number.parseFloat(style.columnGap) || 0;
    const gapY = Number.parseFloat(style.rowGap) || 0;
    const cellW = (g.width - 5 * gapX) / 6;
    const cellH = (g.height - 5 * gapY) / 6;
    const el = document.querySelector<HTMLElement>(
      `li[data-grid-key="${blockKey}"]`,
    )!;
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - g.left) / (cellW + gapX),
      y: (r.top - g.top) / (cellH + gapY),
      w: (r.width + gapX) / (cellW + gapX),
      h: (r.height + gapY) / (cellH + gapY),
      rotate: el.style.rotate,
    };
  }, key);
}

/** How far the painted box misses the nearest grid line, in cells. */
function offGridBy(painted: { x: number; y: number }) {
  return Math.max(
    Math.abs(painted.x - Math.round(painted.x)),
    Math.abs(painted.y - Math.round(painted.y)),
  );
}

async function layout(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      document.querySelector('[data-testid="layout"]')!.textContent as string,
    ),
  );
}

/** A whole quarter turn, through the keyboard's own detent. */
async function turn(page: Page, key: string, quarterTurns: number) {
  const cell = page.locator(`li[data-grid-key="${key}"]`);
  await cell.locator("[data-block-tile]").focus();
  for (let i = 0; i < quarterTurns * 6; i += 1) {
    await page.keyboard.press("Alt+Shift+ArrowRight");
  }
  await expect
    .poll(async () => (await paintedCells(page, key)).rotate)
    .not.toBe("");
}

test.describe("a quarter-turned block stays on the grid", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await hydrated(page);
  });

  test("rotating alone leaves it on the lines", async ({ page }) => {
    const before = await paintedCells(page, SQUARE);
    expect(offGridBy(before)).toBeLessThan(0.01);

    await turn(page, SQUARE, 1);
    expect(offGridBy(await paintedCells(page, SQUARE))).toBeLessThan(0.01);
  });

  test("THE BUG: rotate, then grow it, and it is still on the lines", async ({
    page,
  }) => {
    await turn(page, SQUARE, 1);

    // Shift+Arrow is the keyboard resize. Each press changes one dimension by
    // a cell, so every press flips the parity — and every press used to leave
    // the tile half a cell out.
    for (const key of ["Shift+ArrowRight", "Shift+ArrowDown", "Shift+ArrowRight"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      const painted = await paintedCells(page, SQUARE);
      expect(offGridBy(painted), `after ${key}`).toBeLessThan(0.01);
      // ...and it is still a whole number of cells across, not a smeared box.
      expect(Math.abs(painted.w - Math.round(painted.w))).toBeLessThan(0.01);
      expect(Math.abs(painted.h - Math.round(painted.h))).toBeLessThan(0.01);
    }
  });

  test("shrinking it back is on the lines too", async ({ page }) => {
    await turn(page, SQUARE, 1);
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(150);
    expect(offGridBy(await paintedCells(page, SQUARE))).toBeLessThan(0.01);
  });

  test("dragging the corner handle lands it on the lines", async ({ page }) => {
    await turn(page, SQUARE, 1);
    const cell = page.locator(`li[data-grid-key="${SQUARE}"]`);
    const grid = await page.locator("ul.ss-grid").boundingBox();
    const stride = grid!.width / COLUMNS;

    const handle = cell.getByRole("button", { name: /^Resize/ });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + stride,
      box.y + box.height / 2 + stride,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(250);

    expect(offGridBy(await paintedCells(page, SQUARE))).toBeLessThan(0.01);
  });

  test("it holds through three quarter turns and a resize at each", async ({
    page,
  }) => {
    // The sweep, in a real browser: every quarter turn, with the parity
    // flipped underneath it each time.
    for (let quarter = 0; quarter < 3; quarter += 1) {
      await turn(page, SQUARE, 1);
      await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(120);
      const painted = await paintedCells(page, SQUARE);
      expect(offGridBy(painted), `quarter ${quarter + 1}`).toBeLessThan(0.01);
    }
  });

  test("a tilt that stays nearer level is left where it is", async ({
    page,
  }) => {
    // At 15 degrees the footprint has not transposed, so there is nothing to
    // put back: the block still covers the cells its own rect names.
    const cell = page.locator(`li[data-grid-key="${SQUARE}"]`);
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.waitForTimeout(150);
    const nudge = await cell.evaluate((el) => [el.style.left, el.style.top]);
    expect(nudge).toEqual(["", ""]);
  });

  test("THE REPORT: 85 and 91 degrees sit exactly where 90 does", async ({
    page,
  }) => {
    // It worked at 90 and nowhere near it, so turning a tile the last degree
    // onto the detent stepped the whole container half a cell sideways. The
    // nudge follows the FOOTPRINT, which has already transposed either side of
    // 90, so all three land on the same box.
    await turn(page, SQUARE, 1);
    // Parity has to differ for there to be anything to correct at all.
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(async () => (await layout(page))[SQUARE].w)
      .not.toBe((await layout(page))[SQUARE].h);

    /** The centre of the painted box, which is what a step sideways moves. */
    const centre = async () => {
      const painted = await paintedCells(page, SQUARE);
      return {
        x: +(painted.x + painted.w / 2).toFixed(2),
        y: +(painted.y + painted.h / 2).toFixed(2),
      };
    };

    const at90 = await centre();
    expect(offGridBy(await paintedCells(page, SQUARE))).toBeLessThan(0.01);

    const cell = page.locator(`li[data-grid-key="${SQUARE}"]`);
    await cell.locator("[data-block-tile]").focus();
    // 91, then down through 90 to 85: every degree either side of the detent.
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await paintedCells(page, SQUARE)).rotate).toBe("91deg");
    expect(await centre(), "91 degrees").toEqual(at90);

    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(async () => (await paintedCells(page, SQUARE)).rotate).toBe("85deg");
    expect(await centre(), "85 degrees").toEqual(at90);
  });

  test("the block still covers the cells the board thinks it does", async ({
    page,
  }) => {
    // The invariant behind the fix: a tile lands on its own footprint, so the
    // ghost that promised it, the cells drawn as taken, and the box painted
    // are one rect rather than three that agree to within half a cell.
    await turn(page, SQUARE, 1);
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(150);

    const stored = (await layout(page))[SQUARE];
    const painted = await paintedCells(page, SQUARE);
    // A quarter turn transposes the span and nothing else: same cells, other
    // way round.
    expect(Math.round(painted.w)).toBe(stored.h);
    expect(Math.round(painted.h)).toBe(stored.w);
    // Centred on the same point it turns about, floored onto a whole cell —
    // which is exactly rotatedFootprint.
    expect(Math.round(painted.x)).toBe(
      Math.floor(stored.x + stored.w / 2 - stored.h / 2),
    );
    expect(Math.round(painted.y)).toBe(
      Math.floor(stored.y + stored.h / 2 - stored.w / 2),
    );
  });
});
