import { expect, test, type Locator, type Page } from "@playwright/test";
import { canvasStill, createStorefrontViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * THE EDITOR'S TOOLS PAINT OVER THE ARTWORK, WHATEVER THE ARTWORK IS DOING.
 *
 * The quick bar and a tile's own resize and rotate handles are how a seller
 * works on a block, so nothing ON the board may ever be drawn over them: not a
 * block stacked in front of the selection, not a block being dragged across
 * them. Menus and sheets are the only things allowed above the tools.
 *
 * The handles used to live inside their cell, and a cell is its own stacking
 * context, so the only way to raise them was to raise the whole cell, content
 * and all. That lift was withheld whenever something in front overlapped the
 * block (raising it would have pulled the block out of its own layer), which
 * left exactly those handles buried under the block in front. They are drawn
 * in a layer of their own now, above every band a block can paint at, so the
 * tools always win and the block itself never moves in the stack.
 *
 * The board here is three blocks in one column:
 *
 *   - a circle on the top row, which the quick bar has to sit over;
 *   - the square being worked on, under it;
 *   - a second circle stacked IN FRONT of the square and one row deeper, so it
 *     covers both the square and the strip its handles hang in.
 */

// Tall enough that the rows under test clear the floating editor toolbar,
// which is app chrome and rightly paints over the bottom of the canvas.
test.use({ viewport: { width: 1280, height: 1100 } });

type Placement = { x: number; y: number; w: number; h: number };

const SQUARE_HANDLES = ["Resize square shape", "Rotate square shape"];

/** A cell's placement, read off the inline grid area the grid writes. */
async function placement(cell: Locator): Promise<Placement> {
  return cell.evaluate((el) => {
    const parse = (value: string) => {
      const [line, span] = value.split("/");
      return {
        start: Number.parseInt(line, 10) - 1,
        span: Number.parseInt(span.replace(/\D/g, ""), 10) || 1,
      };
    };
    const column = parse(el.style.gridColumn);
    const row = parse(el.style.gridRow);
    return { x: column.start, y: row.start, w: column.span, h: row.span };
  });
}

/** Walk a block to a placement from the keyboard: arrows move, Shift+arrows
 *  grow the far edge. Position first, so a grow never runs into the edge. */
async function arrange(page: Page, cell: Locator, target: Placement) {
  await cell.locator("[data-block-tile]").focus();
  for (let guard = 0; guard < 40; guard += 1) {
    const at = await placement(cell);
    let key: string | null = null;
    if (at.x !== target.x) key = at.x < target.x ? "ArrowRight" : "ArrowLeft";
    else if (at.y !== target.y) key = at.y < target.y ? "ArrowDown" : "ArrowUp";
    else if (at.w !== target.w) key = at.w < target.w ? "Shift+ArrowRight" : "Shift+ArrowLeft";
    else if (at.h !== target.h) key = at.h < target.h ? "Shift+ArrowDown" : "Shift+ArrowUp";
    if (!key) return;
    await page.keyboard.press(key);
    await expect.poll(() => placement(cell)).not.toEqual(at);
  }
  throw new Error(`block never reached ${JSON.stringify(target)}`);
}

/** Wait out every transition on the board, so nothing is measured mid-fade. */
async function settleBoard(page: Page) {
  await page.evaluate(async () => {
    const grid = document.querySelector(".ss-grid");
    if (!grid) return;
    await Promise.all(
      grid
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

/** Is the named handle drawn, and would a press on its middle land on it? */
async function reach(page: Page, label: string) {
  return page.evaluate((name) => {
    const control = document.querySelector<HTMLElement>(
      `button[aria-label="${name}"]`,
    );
    if (!control) return { drawn: false, reachable: false, hit: "no such control" };
    const r = control.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      drawn: r.width > 0 && Number(getComputedStyle(control).opacity) === 1,
      reachable: !!hit && (hit === control || control.contains(hit)),
      hit: hit
        ? `${hit.tagName}.${String(hit.className).slice(0, 60)}`
        : "nothing",
    };
  }, label);
}

async function buildBoard(page: Page) {
  await signUp(page, freshUser("toolingz"));
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);

  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "All shapes" })
    .click();
  await page.getByRole("button", { name: "Add square" }).click();
  await page.getByRole("button", { name: "Add circle" }).click();
  await page.getByRole("button", { name: "Add circle" }).click();
  const cells = page.locator("li[data-grid-cell]");
  await expect(cells).toHaveCount(3);
  await page.getByRole("button", { name: "Close library panel" }).click();
  await canvasStill(page);

  // Insertion order is DOM order: the square, then the two circles.
  const square = cells.nth(0);
  const cover = cells.nth(1);
  const above = cells.nth(2);
  const size = await placement(square);
  const x = Math.max(0, Math.floor((6 - size.w) / 2));
  await arrange(page, square, { x, y: 1, w: size.w, h: size.h });
  await arrange(page, cover, { x, y: 1, w: size.w, h: size.h + 1 });
  await arrange(page, above, { x, y: 0, w: size.w, h: 1 });
  return { cells, square, cover, above };
}

/** Alt-click walks down a stack; keep walking until the square is the one. */
async function selectBuriedSquare(page: Page, square: Locator) {
  const tile = square.locator("[data-block-tile]");
  for (let i = 1; i <= 4; i += 1) {
    if ((await tile.getAttribute("data-block-selected")) !== null) break;
    await canvasStill(page);
    const box = (await square.boundingBox())!;
    await page.keyboard.down("Alt");
    // Nudged every time: two clicks on one pixel arrive as a double click.
    await page.mouse.click(box.x + box.width / 2 + 6 * i, box.y + box.height / 2);
    await page.keyboard.up("Alt");
    await page.waitForTimeout(200);
  }
  await expect(tile).toHaveAttribute("data-block-selected", "");
  // Selected, but neither hovered nor focused: the handles must be out on the
  // strength of the selection alone. Whatever holds focus is let go, since
  // arranging the board left it on a tile.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(4, 4);
  await canvasStill(page);
  await settleBoard(page);
}

test("a buried selection keeps its handles on top, and stays in its layer", async ({
  page,
}) => {
  const { cells, square, cover } = await buildBoard(page);
  await selectBuriedSquare(page, square);

  // The premise: the block in front really does lie over the strip the
  // square's handles hang in, so a pass here is not a pass on an empty strip.
  // And the strip is on the open canvas, not under the editor's own floating
  // toolbar, which is allowed to cover the board.
  const premise = await page.evaluate(
    ({ names }) => {
      const coverCell = document.querySelectorAll("li[data-grid-cell]")[1];
      const c = coverCell.getBoundingClientRect();
      const t = document
        .querySelector('[role="toolbar"][aria-label="Editor tools"]')
        ?.getBoundingClientRect();
      const centres = names.map((name) => {
        const r = document
          .querySelector(`button[aria-label="${name}"]`)!
          .getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      return {
        covered: centres.every(
          (p) => p.x > c.left && p.x < c.right && p.y > c.top && p.y < c.bottom,
        ),
        underEditorToolbar: centres.some(
          (p) => !!t && p.x > t.left && p.x < t.right && p.y > t.top && p.y < t.bottom,
        ),
      };
    },
    { names: SQUARE_HANDLES },
  );
  expect(premise.covered, "the block in front does not cover the handle strip").toBe(true);
  expect(premise.underEditorToolbar, "the handle strip is under the editor toolbar").toBe(
    false,
  );

  for (const name of SQUARE_HANDLES) {
    const state = await reach(page, name);
    expect(state.drawn, `${name} is not drawn`).toBe(true);
    expect(state.reachable, `${name} is covered by ${state.hit}`).toBe(true);
  }

  // And the square was not bought its handles by being thrown in front of
  // the block covering it: the board still paints it underneath.
  const depths = await cells.evaluateAll((nodes) =>
    nodes.map((node) => Number(getComputedStyle(node).zIndex)),
  );
  expect(depths[0], "selecting the square pulled it forward").toBeLessThan(depths[1]);

  // A real press, through Playwright's own hit test, which refuses a click
  // another element would receive.
  await page.locator('button[aria-label="Resize square shape"]').hover({ timeout: 5_000 });

  // THE QUICK BAR, over the blocks around the selection.
  const bar = page.locator("[data-selection-toolbar]");
  await expect(bar).toBeVisible();
  const barState = await bar.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cellsUnder = [...document.querySelectorAll("li[data-grid-cell]")].filter(
      (cell) => {
        const c = cell.getBoundingClientRect();
        return c.left < r.right && r.left < c.right && c.top < r.bottom && r.top < c.bottom;
      },
    ).length;
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 6, r.top + r.height / 2],
      [r.right - 6, r.top + r.height / 2],
    ];
    const buried = points.filter(([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return !hit || !el.contains(hit);
    });
    return { cellsUnder, buried: buried.length };
  });
  expect(barState.cellsUnder, "the quick bar is not over any block").toBeGreaterThan(0);
  expect(barState.buried, "a block paints over the quick bar").toBe(0);

  // A BLOCK BEING DRAGGED is lifted above every other block, and still not
  // above the tools. Pressed in the part of the cover that hangs below the
  // square, clear of the handles at its corners and of its own edge strip.
  const coverBox = (await cover.boundingBox())!;
  const squareBox = (await square.boundingBox())!;
  const row = squareBox.height / (await placement(square)).h;
  const grab = {
    x: coverBox.x + coverBox.width / 2,
    y: coverBox.y + coverBox.height - row * 0.35,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 14, grab.y, { steps: 6 });
  await expect(cover).toHaveAttribute("data-valid", /true|false/);
  for (const name of SQUARE_HANDLES) {
    const state = await reach(page, name);
    expect(state.reachable, `mid-drag, ${name} is covered by ${state.hit}`).toBe(true);
  }
  await page.mouse.move(grab.x, grab.y, { steps: 6 });
  await page.mouse.up();
});
