import { expect, test, type Page } from "@playwright/test";

/**
 * A TURNED BLOCK GOES WHEREVER IT VISIBLY FITS.
 *
 * The report: with a block rotated (even a clean 90 degrees) it "just doesn't
 * want to move to certain cells even though it would fit". Every gesture held
 * the block's STORED rect to the board, and a turned block's stored rect shares
 * a centre with the cells it covers, so against an edge the stored rect reaches
 * past the board while every cell the tile paints on is on it. A turned 1x3 bar
 * could never lie across the top or bottom row; a turned 2x1 could never stand
 * in the last column.
 *
 * The arithmetic is swept exhaustively in tests/unit/turned-block-reach.test.ts.
 * What only a browser can show is that the real gestures arrive: the drag, the
 * arrows, a group, a resize there, with the board's own drop rule both ways
 * round, and that a tile whose stored rect now starts off the board is still
 * PAINTED on the cells it covers rather than dropped into auto-placement.
 *
 * Driven on the dev harness: the same Grid + BlockTile pair the designer
 * renders, no sign-in, on a known 6x6 board.
 */

const HARNESS = "/dev/grid-playground";
/** 2x2 square at (0, 0). Only used to know the board is on screen. */
const SQUARE = "s_00000000-0000-4000-8000-000000000001";
/** 1x1 circle at (3, 0), grown here into a 1x3 bar. */
const CIRCLE = "s_00000000-0000-4000-8000-000000000002";
/** 2x1 diamond at (1, 3). */
const DIAMOND = "s_00000000-0000-4000-8000-000000000003";
const COLUMNS = 6;
const ROWS = 6;

// Tall enough that every drag in here, overshoot included, stays on screen.
test.use({ viewport: { width: 1600, height: 1400 } });

type CellBox = { x: number; y: number; w: number; h: number };

function cellOf(page: Page, key: string) {
  return page.locator(`li[data-grid-cell][data-grid-key="${key}"]`);
}

async function nextPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function layout(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(
        document.querySelector('[data-testid="layout"]')!.textContent as string,
      ) as Record<string, CellBox & { rotation?: number }>,
  );
}

/** The grid's own geometry: cell pitch and how tall it is drawn, in px. */
async function board(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("ul.ss-grid")!;
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gapX = Number.parseFloat(style.columnGap) || 0;
    const columns = Number.parseInt(style.getPropertyValue("--ss-cols"), 10);
    const cell = (rect.width - (columns - 1) * gapX) / columns;
    return { stride: cell + gapX, cell, gap: gapX, height: rect.height };
  });
}

/**
 * Where a tile PAINTS, in board cells, straight off the browser. At a quarter
 * turn the axis-aligned envelope is the tile itself.
 */
async function painted(page: Page, key: string): Promise<CellBox> {
  return page.evaluate((blockKey) => {
    const grid = document.querySelector<HTMLElement>("ul.ss-grid")!;
    const g = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const columns = Number.parseInt(style.getPropertyValue("--ss-cols"), 10);
    const cell = (g.width - (columns - 1) * gap) / columns;
    const stride = cell + gap;
    const r = document
      .querySelector<HTMLElement>(`li[data-grid-cell][data-grid-key="${blockKey}"]`)!
      .getBoundingClientRect();
    return {
      x: (r.left - g.left) / stride,
      y: (r.top - g.top) / stride,
      w: (r.width + gap) / stride,
      h: (r.height + gap) / stride,
    };
  }, key);
}

/** Painted where expected, to a hundredth of a cell. */
async function expectPainted(page: Page, key: string, expected: CellBox, note: string) {
  await expect
    .poll(
      async () => {
        const got = await painted(page, key);
        const off = Math.max(
          Math.abs(got.x - expected.x),
          Math.abs(got.y - expected.y),
          Math.abs(got.w - expected.w),
          Math.abs(got.h - expected.h),
        );
        return off < 0.02 ? "ok" : JSON.stringify(got);
      },
      { message: `${note}: painted box should be ${JSON.stringify(expected)}` },
    )
    .toBe("ok");
}

/** The board is exactly its six rows tall: a stored rect reaching past the
 *  bottom must never add an implicit row to it. */
async function expectBoardHeight(page: Page) {
  const { cell, gap, height } = await board(page);
  expect(Math.abs(height - (ROWS * cell + (ROWS - 1) * gap))).toBeLessThan(1);
}

async function openBoard(page: Page, stacking: boolean) {
  await page.goto(HARNESS);
  await expect(cellOf(page, SQUARE)).toBeVisible();
  // A toggle that flips proves React has taken over, which a load event does
  // not: a hydrating board silently ignores every key and every drag.
  const toggle = page.getByRole("button", { name: "Allow stacking" });
  await expect(async () => {
    const before = await toggle.getAttribute("aria-pressed");
    await toggle.click();
    expect(await toggle.getAttribute("aria-pressed")).not.toBe(before);
  }).toPass({ timeout: 30_000 });
  if ((await toggle.getAttribute("aria-pressed")) !== String(stacking)) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", String(stacking));
  await page.locator("ul.ss-grid").scrollIntoViewIfNeeded();
  // Wait for the board to stop settling (fonts, the measured container).
  let last = "";
  for (let i = 0; i < 30; i += 1) {
    const now = JSON.stringify(await cellOf(page, SQUARE).boundingBox());
    if (now === last) break;
    last = now;
    await page.waitForTimeout(100);
  }
}

async function press(page: Page, key: string, keys: string) {
  await cellOf(page, key).locator("[data-block-tile]").focus();
  await page.keyboard.press(keys);
}

/** Grow the 1x1 circle into a 1x3 bar standing at (3, 0). */
async function makeBar(page: Page) {
  for (const h of [2, 3]) {
    await press(page, CIRCLE, "Shift+ArrowDown");
    await expect.poll(async () => (await layout(page))[CIRCLE].h).toBe(h);
  }
}

/** A quarter turn, one 15 degree detent at a time, each one confirmed. */
async function turn(page: Page, key: string, direction: 1 | -1) {
  for (let i = 1; i <= 6; i += 1) {
    await press(page, key, direction === 1 ? "Alt+Shift+ArrowRight" : "Alt+Shift+ArrowLeft");
    await expect
      .poll(async () => (await layout(page))[key].rotation ?? 0)
      .toBe(direction * 15 * i);
  }
}

/**
 * Drag a tile by whole cells, from its painted centre. The small first step is
 * what turns the press into a drag.
 */
async function dragBy(page: Page, key: string, cellsX: number, cellsY: number) {
  const { stride } = await board(page);
  const box = (await cellOf(page, key).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = { x: from.x + stride * cellsX, y: from.y + stride * cellsY };
  const viewport = page.viewportSize()!;
  expect(to.x > 0 && to.y > 0 && to.x < viewport.width && to.y < viewport.height).toBe(true);
  // The press has to land on THIS tile. With stacking on, a later block can
  // paint over part of it, and a drag started there moves that block instead.
  expect(
    await page.evaluate(
      ({ x, y, blockKey }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("li[data-grid-cell]")
          ?.getAttribute("data-grid-key") === blockKey,
      { x: from.x, y: from.y, blockKey: key },
    ),
    `the press at the centre of ${key} lands on another element`,
  ).toBe(true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(cellsX) * 8, from.y + Math.sign(cellsY) * 8);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await nextPaint(page);
  await page.mouse.up();
  await nextPaint(page);
}

test.describe("a turned block reaches every cell it fits in", () => {
  for (const direction of [1, -1] as const) {
    const angle = direction * 90;

    test(`THE BUG (${angle} degrees): a turned 1x3 bar drags onto the top row`, async ({
      page,
    }) => {
      await openBoard(page, true);
      await makeBar(page);
      await turn(page, CIRCLE, direction);

      // Standing at (3, 0), stood on its side it lies across columns 2..4 of
      // row 1: the row below its stored top.
      await expectPainted(page, CIRCLE, { x: 2, y: 1, w: 3, h: 1 }, "turned");

      // A cell further than it can go, so the clamp is what stops it.
      await dragBy(page, CIRCLE, 0, -2);
      await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(-1);
      await expectPainted(page, CIRCLE, { x: 2, y: 0, w: 3, h: 1 }, "top row");

      // Laid out from a real grid line, not dropped into auto-placement.
      expect(
        await cellOf(page, CIRCLE).evaluate((el) => getComputedStyle(el).gridRowStart),
      ).toBe("1");
      await expectBoardHeight(page);
    });
  }

  test("the same bar drags onto the bottom row and into both side columns", async ({
    page,
  }) => {
    await openBoard(page, true);
    await makeBar(page);
    await turn(page, CIRCLE, 1);

    // Routed so every press lands on bar nothing else covers: the harness's
    // orange square sits over the bottom-left corner and paints above the bar.
    // Each drag is a cell further than the bar can go.
    await dragBy(page, CIRCLE, 0, 5);
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(4);
    await expectPainted(page, CIRCLE, { x: 2, y: 5, w: 3, h: 1 }, "bottom row");
    // Its stored rect runs a row past the board, and the board must not grow
    // a seventh row to hold it.
    await expectBoardHeight(page);

    await dragBy(page, CIRCLE, 2, 0);
    await expect.poll(async () => (await layout(page))[CIRCLE].x).toBe(4);
    await expectPainted(page, CIRCLE, { x: 3, y: 5, w: 3, h: 1 }, "bottom-right corner");

    await dragBy(page, CIRCLE, 0, -6);
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(-1);
    await expectPainted(page, CIRCLE, { x: 3, y: 0, w: 3, h: 1 }, "top-right corner");

    await dragBy(page, CIRCLE, -4, 0);
    await expect.poll(async () => (await layout(page))[CIRCLE].x).toBe(1);
    await expectPainted(page, CIRCLE, { x: 0, y: 0, w: 3, h: 1 }, "top-left corner");
    await expectBoardHeight(page);
  });

  test("arrow keys walk a turned bar into the first and last rows, and stop there", async ({
    page,
  }) => {
    await openBoard(page, true);
    await makeBar(page);
    await turn(page, CIRCLE, 1);

    for (let i = 0; i < 3; i += 1) await press(page, CIRCLE, "ArrowUp");
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(-1);
    await expectPainted(page, CIRCLE, { x: 2, y: 0, w: 3, h: 1 }, "arrowed to the top");

    for (let i = 0; i < 8; i += 1) await press(page, CIRCLE, "ArrowDown");
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(4);
    await expectPainted(page, CIRCLE, { x: 2, y: 5, w: 3, h: 1 }, "arrowed to the bottom");
    await expectBoardHeight(page);
  });

  test("with stacking OFF, a turned 2x1 stands in the last column, and a real collision still springs back", async ({
    page,
  }) => {
    await openBoard(page, false);
    await turn(page, DIAMOND, 1);
    // Standing at (1, 3), turned it covers column 1, rows 2..3.
    await expectPainted(page, DIAMOND, { x: 1, y: 2, w: 1, h: 2 }, "turned");

    // Up two rows and a column past the right edge: column 5, rows 0..1, which
    // nothing else covers. Its stored rect would run past the right edge there.
    await dragBy(page, DIAMOND, 5, -2);
    await expect
      .poll(async () => {
        const at = (await layout(page))[DIAMOND];
        return `${at.x},${at.y}`;
      })
      .toBe("5,1");
    await expectPainted(page, DIAMOND, { x: 5, y: 0, w: 1, h: 2 }, "last column");

    // Down onto the product tile, which stacking-off refuses: the drop springs
    // back, so the footprint rule has not simply turned the collision check off.
    await dragBy(page, DIAMOND, 0, 2);
    await page.waitForTimeout(150);
    const at = (await layout(page))[DIAMOND];
    expect(`${at.x},${at.y}`).toBe("5,1");
  });

  test("a selection holding a turned bar moves up to the top row as one body", async ({
    page,
  }) => {
    await openBoard(page, true);
    await makeBar(page);
    await turn(page, CIRCLE, 1);
    await turn(page, DIAMOND, 1);

    await cellOf(page, CIRCLE).locator("[data-block-tile]").click();
    await expect(page.locator("[data-block-selected]")).toHaveCount(1);
    await cellOf(page, DIAMOND).locator("[data-block-tile]").click({ modifiers: ["Shift"] });
    await expect(page.locator("[data-block-selected]")).toHaveCount(2);

    // The bar lies in row 1 and the diamond starts at row 2: the group can
    // rise exactly one row, which puts the bar across the top row. It used to
    // rise none at all, because the bar's stored rect already touched row 0.
    for (let i = 0; i < 3; i += 1) await press(page, CIRCLE, "ArrowUp");
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(-1);
    expect((await layout(page))[DIAMOND].y).toBe(2);
    await expectPainted(page, CIRCLE, { x: 2, y: 0, w: 3, h: 1 }, "bar in the group");
    await expectPainted(page, DIAMOND, { x: 1, y: 1, w: 1, h: 2 }, "diamond in the group");
  });

  test("resizing a turned bar that lies across the top row keeps it in the top row", async ({
    page,
  }) => {
    await openBoard(page, true);
    await makeBar(page);
    await turn(page, CIRCLE, 1);
    await press(page, CIRCLE, "ArrowUp");
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(-1);

    // At a quarter turn, screen-left is the bar's own length: Shift+Left
    // lengthens it. Its stored rect grows further above the board, and it has
    // to stay put rather than be shoved back down a row.
    await press(page, CIRCLE, "Shift+ArrowLeft");
    await expect.poll(async () => (await layout(page))[CIRCLE].h).toBe(4);
    expect((await layout(page))[CIRCLE].y).toBe(-1);
    await expectPainted(page, CIRCLE, { x: 1, y: 0, w: 4, h: 1 }, "lengthened");
    await expectBoardHeight(page);
  });

  test("a level block is held to the board exactly as before", async ({ page }) => {
    await openBoard(page, true);
    await makeBar(page);
    // Standing 1x3 at (3, 0): up is a wall, and so is the bottom three rows on.
    for (let i = 0; i < 2; i += 1) await press(page, CIRCLE, "ArrowUp");
    await page.waitForTimeout(150);
    expect((await layout(page))[CIRCLE].y).toBe(0);
    await dragBy(page, CIRCLE, 0, 5);
    await expect.poll(async () => (await layout(page))[CIRCLE].y).toBe(ROWS - 3);
    await expectPainted(page, CIRCLE, { x: 3, y: 3, w: 1, h: 3 }, "level at the bottom");
    expect((await layout(page))[CIRCLE].x).toBeLessThan(COLUMNS);
  });
});

test.describe("the read-only storefront preview paints them there too", () => {
  test("turned blocks stored off the board paint flush against every edge, at both card sizes", async ({
    page,
  }) => {
    // The dashboard's storefront cards draw a saved board through the same Grid
    // in STATIC mode, scaled down to fit. The gallery case holds four turned
    // blocks whose stored rects reach past a 5x5 board on every side while the
    // cells they cover are all on it; it renders at 300px and at 160px.
    await page.goto("/dev/storefront-preview");
    const cards = page.locator("li", {
      has: page.getByRole("heading", { name: "Turned blocks against every edge" }),
    });
    await expect(cards).toHaveCount(2);

    // Where each block's footprint lies, sorted by row then column: the top-row
    // bar, the first-column 3x1, the last-column 2x1, the bottom-row bar.
    const expected = [
      { x: 1, y: 0, w: 3, h: 1 },
      { x: 0, y: 1, w: 1, h: 3 },
      { x: 4, y: 1, w: 1, h: 2 },
      { x: 1, y: 4, w: 3, h: 1 },
    ];

    for (let i = 0; i < 2; i += 1) {
      const grid = cards.nth(i).locator('ul[aria-label="Storefront preview"]');
      await grid.scrollIntoViewIfNeeded();
      await expect(grid.locator("li[data-grid-cell]")).toHaveCount(4);
      await expect
        .poll(
          () =>
            grid.evaluate((el: HTMLElement) => {
              const g = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              // Scaled to fit the card: the rect is on screen, the gap in layout px.
              const scale = el.offsetWidth > 0 ? g.width / el.offsetWidth : 1;
              const gap = (Number.parseFloat(style.columnGap) || 0) * scale;
              const columns = Number.parseInt(style.getPropertyValue("--ss-cols"), 10);
              const stride = (g.width - (columns - 1) * gap) / columns + gap;
              const tenth = (n: number) => Math.round(n * 10) / 10 + 0;
              const boxes = [...el.querySelectorAll<HTMLElement>("li[data-grid-cell]")]
                .map((cell) => {
                  const r = cell.getBoundingClientRect();
                  const lines = getComputedStyle(cell);
                  return {
                    x: tenth((r.left - g.left) / stride),
                    y: tenth((r.top - g.top) / stride),
                    w: tenth((r.width + gap) / stride),
                    h: tenth((r.height + gap) / stride),
                    // A real grid line, never "auto": an off-board line that the
                    // browser dropped would have sent the tile to auto-placement.
                    onLines: /^\d+$/.test(lines.gridRowStart) && /^\d+$/.test(lines.gridColumnStart),
                  };
                })
                .sort((a, b) => a.y - b.y || a.x - b.x);
              return {
                columns,
                rowsTall: tenth((g.height + gap) / stride),
                boxes,
              };
            }),
          { message: `card ${i + 1} of 2` },
        )
        .toEqual({
          columns: 5,
          rowsTall: 5,
          boxes: expected.map((box) => ({ ...box, onLines: true })),
        });
    }
  });
});
