import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * Stacking blocks: the panel, the keyboard, undo, and the trip through a save.
 *
 * The rules themselves are pinned in tests/unit/storefront-layers.test.ts. What
 * only the browser can prove is that the order the rules produce is the order
 * the board actually PAINTS in, and that a stacked board still leaves the
 * editor's own chrome on top of it.
 */

/** The depth every cell paints at, in DOM order. DOM order is reading order
 *  and never changes, so a change here is a change to paint order alone.
 *
 *  The block's OWN depth, off the inline style the grid writes from its layer,
 *  rather than the computed one. A cell whose controls are showing is lifted
 *  clear of its neighbours for as long as they are — the handles hang outside
 *  the tile, so they would otherwise be drawn under whatever sits next to it
 *  (see the `.ss-grid > [data-grid-cell]` lift rules in globals.css, which fire
 *  on hover, on focus, and while the cell holds the SELECTED block; that last
 *  one is why reading the computed depth here would report the selection
 *  rather than the layer). The lift is deliberate, and it is not the layer
 *  order this asks about. */
async function depths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
      (cell) => Number(cell.style.zIndex),
    ),
  );
}

/** Two shapes in neighbouring cells, the second tilted far enough that its
 *  corners really do paint into the first one's cell. */
async function setUpOverlappingBoard(page: Page, tag: string) {
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
  await page.getByRole("button", { name: "Add circle" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
  await page.getByRole("button", { name: "Close library panel" }).click();

  // A tilt is what first makes two blocks paint over each other: a square
  // turned 45 degrees grows its painted box by about 41 percent, while the
  // cells it OCCUPIES are unchanged, so nothing about placement moves. The
  // keyboard route (a detent per press, on the focused tile) rather than the
  // panel's quick angles, which only offer the quarter turns a square is
  // unchanged by.
  const tilted = page.locator("li[data-grid-cell]").nth(1);
  await tilted.locator("[data-block-tile]").focus();
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Alt+Shift+ArrowRight");
  }
  await expect(
    page.getByRole("button", { name: "Bring to front" }),
  ).toBeVisible();
  return user;
}

test.describe("stacking blocks", () => {
  test("a board nobody layered paints in reading order", async ({ page }) => {
    await setUpOverlappingBoard(page, "layerbase");
    const [first, second] = await depths(page);
    expect(second).toBeGreaterThan(first);
  });

  test("touching a block never moves it in front of what covers it", async ({
    page,
  }) => {
    // THE COMPUTED depth, not the inline one every other test here reads: the
    // question is precisely whether the chrome lift is overriding the layer.
    const painted = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
          (cell) => Number(getComputedStyle(cell).zIndex),
        ),
      );

    await setUpOverlappingBoard(page, "layerlift");
    // STACKED ON THE SAME CELLS, not merely tilted into each other: a tilt
    // spills PAINT past the cells a block covers, and coverage here is the
    // footprint every other rule on this board reads. Dropping one on the
    // other is what makes one block genuinely cover the other.
    const [first, second] = await page.locator("li[data-grid-cell]").all();
    const target = (await first.boundingBox())!;
    const source = (await second.boundingBox())!;
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Exactly one of them may rise for its chrome: the one on top, which has
    // nothing to be painted over. The buried one may not, or touching it
    // would drag it out in front of the very block covering it.
    await expect(first).not.toHaveAttribute("data-chrome-lift");
    await expect(second).toHaveAttribute("data-chrome-lift", "");

    // The dragged block is on top AND already the selection, so this is the
    // lift still doing its job where it is free (the handles hanging off a
    // selected tile stay pressable — see 41-tile-chrome-outside.spec.ts).
    const [, topZ] = await painted();
    expect(topZ).toBeGreaterThan(500);

    // ALT-CLICK REACHES THE ONE UNDERNEATH, and selecting it is a question,
    // not a layer move. This used to throw it to the top of the board
    // (SELECTED_CHROME_Z carries the cell's CONTENT with it), so the canvas
    // contradicted the layers list the moment a seller pointed at anything.
    const box = (await first.boundingBox())!;
    await page.keyboard.down("Alt");
    await page.mouse.click(box.x + box.width / 2 + 6, box.y + box.height / 2);
    await page.keyboard.up("Alt");
    await expect(first.locator("[data-block-tile]")).toHaveAttribute(
      "data-block-selected",
      "",
    );
    const [buriedZ, coverZ] = await painted();
    expect(buriedZ).toBeLessThan(coverZ);
  });

  test("sending a block back changes what paints on top", async ({ page }) => {
    await setUpOverlappingBoard(page, "layerback");
    // The second block is selected (inserting selects), and it is the one in
    // front to begin with.
    await page.getByRole("button", { name: "Send to back" }).click();
    const [first, second] = await depths(page);
    expect(second).toBeLessThan(first);

    // And the panel says where it landed.
    await expect(page.getByText("Layer 1 of 2")).toBeVisible();
  });

  test("both ends disable when there is nowhere left to go", async ({
    page,
  }) => {
    await setUpOverlappingBoard(page, "layerends");
    // The freshly inserted block is at the front already.
    await expect(page.getByRole("button", { name: "Bring forward" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bring to front" })).toBeDisabled();
    await page.getByRole("button", { name: "Send to back" }).click();
    await expect(page.getByRole("button", { name: "Send backward" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Bring forward" })).toBeEnabled();
  });

  test("Ctrl+brackets walk the stack without navigating the browser", async ({
    page,
  }) => {
    await setUpOverlappingBoard(page, "layerkeys");
    const url = page.url();
    await page.getByRole("button", { name: "Send to back" }).click();
    expect((await depths(page))[1]).toBeLessThan((await depths(page))[0]);

    await page.keyboard.press("Control+]");
    const [first, second] = await depths(page);
    expect(second).toBeGreaterThan(first);

    // The Shift half, which is a DIFFERENT character on the same key ("}"),
    // and so the half a handler matching on the character alone silently
    // drops.
    await page.keyboard.press("Control+Shift+[");
    expect((await depths(page))[1]).toBeLessThan((await depths(page))[0]);
    await page.keyboard.press("Control+Shift+]");
    expect((await depths(page))[1]).toBeGreaterThan((await depths(page))[0]);

    // On macOS these are Back and Forward. An editor that navigated away here
    // would take the unsaved board with it.
    expect(page.url()).toBe(url);
  });

  test("undo restores the previous order in one step", async ({ page }) => {
    await setUpOverlappingBoard(page, "layerundo");
    const before = await depths(page);
    await page.getByRole("button", { name: "Send to back" }).click();
    expect(await depths(page)).not.toEqual(before);

    // Each press is its own intention, so one press is one undo step.
    await page.keyboard.press("Control+z");
    expect(await depths(page)).toEqual(before);
  });

  test("the order survives a save and a reload", async ({ page }) => {
    await setUpOverlappingBoard(page, "layersave");
    await page.getByRole("button", { name: "Send to back" }).click();
    const stacked = await depths(page);

    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
    expect(await depths(page)).toEqual(stacked);
  });

  test("a block dropped on another one lands there instead of springing back", async ({
    page,
  }) => {
    // The move stacking exists to serve. This drop used to be refused: the
    // tile would snap back to where it came from because the cell was taken.
    await setUpOverlappingBoard(page, "layerdrop");
    const [first, second] = await page.locator("li[data-grid-cell]").all();
    const target = (await first.boundingBox())!;
    const source = (await second.boundingBox())!;

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Both blocks are still on the board, on the same cells.
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
        (cell) => `${cell.style.gridColumn}|${cell.style.gridRow}`,
      ),
    );
    expect(cells[0]).toBe(cells[1]);

    // And the panel now offers the way back to the one underneath.
    await expect(
      page.getByText("Alt-click a stack to reach the block underneath."),
    ).toBeVisible();
  });

  test("Alt-click walks down through a stack", async ({ page }) => {
    await setUpOverlappingBoard(page, "layeralt");
    const [first, second] = await page.locator("li[data-grid-cell]").all();
    const target = (await first.boundingBox())!;
    const source = (await second.boundingBox())!;
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The dragged block is still the selection, and it is the one on top: a
    // plain click cannot reach past it (it would just deselect it), which is
    // the whole reason this shortcut exists.
    const readout = page.getByText(/Layer \d of 2/);
    const top = await readout.textContent();

    /**
     * One Alt-click on the stack.
     *
     * The box is re-measured every time: selecting a shape opens the colour
     * panel, which takes width off the workspace and re-clamps the board's
     * pan, so coordinates taken before the previous click point somewhere
     * else by now. The nudge is for a second reason: two clicks on the very
     * same pixel arrive as a DOUBLE click, which a tile reads as "start
     * editing me" rather than as two selections.
     */
    let nudge = 0;
    const altClick = async () => {
      nudge += 6;
      const box = (await page.locator("li[data-grid-cell]").first().boundingBox())!;
      await page.keyboard.down("Alt");
      await page.mouse.click(box.x + box.width / 2 + nudge, box.y + box.height / 2);
      await page.keyboard.up("Alt");
    };

    await altClick();
    await expect(readout).not.toHaveText(top ?? "");

    // And again wraps back round to the one on top, so the stack can be
    // walked without ever getting stuck at the bottom of it.
    await altClick();
    await expect(readout).toHaveText(top ?? "");
  });

  test("layering the board adds no accessibility violations", async ({
    page,
  }) => {
    // A DELTA rather than an absolute count, deliberately. The editor carries
    // two violations that predate this feature and belong to it rather than to
    // layering: an unlabelled file input, and the tile's own remove button
    // nested inside a role="button" tile. Asserting zero here would either fail
    // for someone else's defect or, once waived, stop noticing this one's.
    await setUpOverlappingBoard(page, "layeraxe");

    /** Every serious/critical violation, as one line per offending node, so a
     *  new one shows up as a new line rather than a changed count. */
    async function serious() {
      // Settle any fade before scanning: axe reads a mid-fade element as a
      // contrast failure that does not exist.
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .exclude("nextjs-portal")
        .analyze();
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`))
        .sort();
    }

    const before = await serious();
    await page.getByRole("button", { name: "Send to back" }).click();
    expect(await serious()).toEqual(before);

    // And nothing the layer group itself contributes, at any point: its four
    // controls are real buttons named for the action rather than the icon.
    expect(before.filter((line) => /Bring |Send |Block layer/.test(line))).toEqual(
      [],
    );
  });
});
