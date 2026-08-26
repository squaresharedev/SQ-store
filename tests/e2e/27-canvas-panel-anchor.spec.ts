import { expect, test, type Page } from "@playwright/test";
import { createStorefrontViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * PANELS MOVE, THE BOARD DOES NOT.
 *
 * The designer's pan is measured from the workspace's own top-left corner, and
 * a docked panel appearing beside the workspace MOVES that corner: opening the
 * colour or shape column used to shove the whole design sideways by the panel's
 * width, under the seller's cursor, for no reason they could see.
 *
 * The rule now is two lines: hold the board on the same pixels of the SCREEN,
 * and move it only when a panel is genuinely standing on it, by the least
 * amount that gets it back out. These specs drive both halves at a laptop size
 * (where panels are docked columns) and at a phone size (where the same panels
 * are sheets laid over the canvas), because the two reach the rule by opposite
 * routes: one changes the workspace box, the other covers it.
 *
 * One account, one page, shared: sign-ups are rate limited per client.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

/** Where the board is on SCREEN. The stage carries the pan/zoom transform. */
async function stageBox() {
  const box = await page.locator("[data-canvas-stage]").boundingBox();
  if (!box) throw new Error("no canvas stage");
  return box;
}

/** The left-hand column, once the shape library has opened it. */
function libraryPanel() {
  return page.locator("[data-canvas-panel]").filter({
    has: page.getByRole("tab", { name: /shapes/i }),
  });
}

async function openShapeLibrary() {
  await page.getByRole("button", { name: "Add element" }).click();
  await page.getByRole("menuitem", { name: /all shapes/i }).click();
  await expect(libraryPanel()).toBeVisible();
  await settle();
}

async function closeShapeLibrary() {
  await libraryPanel()
    .getByRole("button", { name: /close/i })
    .first()
    .click();
  await expect(libraryPanel()).toBeHidden();
  await settle();
}

/** The panel surface actually painted over the canvas, on a phone. */
function sheet() {
  return page.locator("[data-canvas-panel]:visible").first();
}

/** Pan the workspace. The wheel handler moves the board by -delta. */
async function pan(dx: number, dy: number) {
  const area = await page.locator("main").first().boundingBox();
  if (!area) throw new Error("no workspace");
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(-dx, -dy);
  await settle();
}

/** Put the board's left edge at a known screen x. Iterated rather than
 *  computed: the pan is clamped, so one wheel does not always land it. */
async function panBoardTo(targetX: number) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const box = await stageBox();
    const delta = targetX - box.x;
    if (Math.abs(delta) < 2) return;
    await pan(delta, 0);
  }
}

/** The re-anchor eases rather than jumping, so give it room to land. */
async function settle() {
  await page.waitForTimeout(500);
}

/**
 * Drop the selection, through the inspector's own close button.
 *
 * It matters which of the two anchors is in play: with a block selected the
 * board keeps THAT block clear of a panel, and with nothing selected it is the
 * board as a whole. Clicking bare workspace would do it too, but "bare" depends
 * on where the board happens to be sitting.
 */
async function deselect() {
  // The colour column FIRST. Selecting a block opens both it and the
  // inspector, and on a phone they share the one bottom slot: while the colour
  // sheet is up the inspector is display:none, so its close button cannot be
  // reached and the block would quietly stay selected.
  const closeColor = page.getByRole("button", { name: "Close color panel" });
  if (await closeColor.count()) await closeColor.click();
  await expect(closeColor).toHaveCount(0);

  const close = page.getByRole("button", {
    name: /^close (text block|shape|product|image|add product|\d+ blocks) panel$/i,
  });
  if (await close.count()) await close.first().click();
  await expect(close).toHaveCount(0);
  await settle();
}

const tiles = () => page.locator("li[data-grid-cell]");

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signUp(page, freshUser("canvas-anchor"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await page.waitForTimeout(800);

  // One tile, so there is something on the board to anchor and to select.
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(tiles()).toHaveCount(1);
  // A selected block opens the colour column and becomes the anchor; these
  // specs open their own panels and say which anchor they mean.
  await deselect();
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("canvas holds still when a panel opens (desktop)", () => {
  test("a panel opening beside the board does not move it", async () => {
    // Park the board clear of the strip the column will take.
    await pan(420, 0);
    const before = await stageBox();

    await openShapeLibrary();
    const panel = (await libraryPanel().boundingBox())!;
    expect(
      before.x,
      "precondition: the board must start clear of the panel",
    ).toBeGreaterThan(panel.width);

    const after = await stageBox();
    // Same pixels of the screen, not the same offset inside a workspace that
    // just moved.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    await closeShapeLibrary();
    const closed = await stageBox();
    expect(Math.abs(closed.x - before.x)).toBeLessThanOrEqual(1);
  });

  test("a panel that lands ON the board slides it clear, minimally", async () => {
    // Small enough to fit the workspace the column leaves behind: a board with
    // nowhere to fit is deliberately left alone (moving it would only swap
    // which edge is cropped).
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole("button", { name: "Zoom out" }).click();
    }
    await settle();
    // Then hard against the left edge, where the column is about to open.
    await pan(-2000, 0);
    await deselect();
    const before = await stageBox();

    await openShapeLibrary();
    const panel = (await libraryPanel().boundingBox())!;
    const panelRight = panel.x + panel.width;
    const overlap = panelRight - before.x;
    expect(overlap, "precondition: the panel must land on the board").toBeGreaterThan(4);

    const after = await stageBox();
    // Out from under it...
    expect(after.x).toBeGreaterThanOrEqual(panelRight - 1);
    // ...and not one pixel further than it had to come.
    expect(after.x - before.x).toBeLessThanOrEqual(overlap + 1);

    await closeShapeLibrary();
  });

  test("selecting a tile under the colour column brings the tile out", async () => {
    // Clicking a block opens the colour column, which is exactly the move that
    // used to throw the board sideways. With a block selected the anchor is
    // that BLOCK rather than the whole board: a seller who reached for a tile
    // is asking about the tile, and showing it is possible on screens where
    // showing the board is not.
    //
    // A shape rather than the text block: clicking a selected TEXT tile means
    // "let me type", which is a different gesture from the one under test.
    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("menuitem", { name: "Add square" }).click();
    await expect(tiles()).toHaveCount(2);
    const shape = tiles().nth(1);
    await deselect();
    await settle();

    // Park the shape inside the strip the column is about to take.
    const board = await stageBox();
    const offset = (await shape.boundingBox())!.x - board.x;
    await panBoardTo(40 - offset);
    const tileBefore = (await shape.boundingBox())!;

    await shape.click();
    await settle();
    // The colour column is the first panel in the document; the design column
    // is docked on the other side.
    const column = page.locator("[data-canvas-panel]").first();
    const columnBox = (await column.boundingBox())!;
    expect(columnBox.x, "the colour column docks at the left edge").toBeLessThan(10);
    const columnRight = columnBox.x + columnBox.width;
    expect(
      columnRight - tileBefore.x,
      "precondition: the column must land on the tile",
    ).toBeGreaterThan(4);

    const tileAfter = (await shape.boundingBox())!;
    expect(tileAfter.x).toBeGreaterThanOrEqual(columnRight - 1);

    await deselect();
  });

  test("closing a panel leaves the board where the seller left it", async () => {
    const before = await stageBox();
    await page.getByRole("button", { name: "Hide design panel" }).click();
    await settle();
    const hidden = await stageBox();
    expect(Math.abs(hidden.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(hidden.y - before.y)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Show design panel" }).click();
    await settle();
    const shown = await stageBox();
    expect(Math.abs(shown.x - before.x)).toBeLessThanOrEqual(1);
  });
});

/**
 * A phone reaches the same rule by the opposite route. The panels are fixed
 * sheets here, so they do NOT change the workspace box at all: nothing moves
 * the corner, and the whole question is what the sheet is lying on top of.
 */
test.describe("canvas lifts off a bottom sheet (phone)", () => {
  /** The shape block, whose click is a plain selection (a text tile's second
   *  click means "let me type"). */
  const shape = () => page.locator("li[data-grid-cell]").nth(1);

  test.beforeAll(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    await deselect();
  });

  /** Where a sheet's top edge lands, measured by opening one. */
  async function sheetTopEdge() {
    await shape().click();
    await expect(sheet()).toBeVisible();
    await settle();
    const top = (await sheet().boundingBox())!.y;
    await deselect();
    return top;
  }

  test("a sheet that opens clear of the tile leaves the board alone", async () => {
    const sheetTop = await sheetTopEdge();
    const tile = (await shape().boundingBox())!;
    // Well above where the sheet will open.
    await pan(0, sheetTop - 140 - tile.y);
    const tileBefore = (await shape().boundingBox())!;
    const before = await stageBox();
    expect(
      tileBefore.y + tileBefore.height,
      "precondition: the tile must start clear of the sheet",
    ).toBeLessThan(sheetTop);

    await shape().click();
    await expect(sheet()).toBeVisible();
    await settle();

    const after = await stageBox();
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await deselect();
  });

  test("selecting a tile under a sheet brings that tile above it", async () => {
    // Measure where the sheet opens, then put the tile squarely under it.
    const sheetTop = await sheetTopEdge();

    const tile = (await shape().boundingBox())!;
    await pan(0, sheetTop + 30 - tile.y);
    const tileBefore = (await shape().boundingBox())!;
    const stageBefore = await stageBox();
    expect(
      tileBefore.y,
      "precondition: the tile must start under the sheet",
    ).toBeGreaterThan(sheetTop);

    await shape().click();
    await expect(sheet()).toBeVisible();
    await settle();

    // The board comes up, and the tile lands wholly inside the strip the sheet
    // left behind: clear of the sheet below, and not shoved off the top.
    const stageAfter = await stageBox();
    const tileAfter = (await shape().boundingBox())!;
    const workspaceTop = (await page.locator("main").first().boundingBox())!.y;
    expect(stageAfter.y).toBeLessThan(stageBefore.y - 1);
    expect(tileAfter.y + tileAfter.height).toBeLessThanOrEqual(sheetTop + 1);
    expect(tileAfter.y).toBeGreaterThanOrEqual(workspaceTop - 1);
  });
});
