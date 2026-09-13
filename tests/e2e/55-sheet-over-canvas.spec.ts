import { devices, expect, test, type Page } from "@playwright/test";
import { createStorefrontViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * A BOTTOM SHEET IS THE TOP OF THE SCREEN, AND THE BLOCK IT DESCRIBES IS ON IT.
 *
 * Two faults, reported together from a phone, with one cause between them: the
 * seller taps a block, the sheet for it slides up over the bottom half of the
 * screen, and the block ends up painted straight OVER that sheet — sitting on
 * top of the rotation field and the shape picker meant to change it.
 *
 *   - WHY IT PAINTED THROUGH. A selected tile's chrome is drawn at z-index
 *     660 (SELECTED_CHROME_Z), which it has to be: the resize and rotate
 *     handles hang outside the tile and must paint over every block on the
 *     board. On the DESIGN canvas that number is harmless: the pan/zoom stage
 *     is a stacking context and traps it. The MOBILE PREVIEW has no stage; it
 *     is a plain scrolling column, so the band was being compared against
 *     the sheet's own z-index directly, and won. The workspace is `isolate`d
 *     now, which seals every band the board paints at inside it whatever the
 *     numbers grow to, and the sheets sit at z-50, above the floating toolbar
 *     rather than level with it.
 *
 *   - WHY IT WAS UNDER THE SHEET AT ALL. The canvas anchor moves the board out
 *     from under a panel, but it is switched off in mobile preview (there is no
 *     pan to move). The column scrolls instead now (useScrollReveal), to the
 *     same rule.
 *
 * And the rule itself got stricter on both surfaces: a selection that has to be
 * revealed is CENTRED in the strip the sheet leaves, not slid the least
 * possible distance into it. The minimal answer left a tile flush with the
 * sheet's top edge, which buries the handles welded under that edge — the only
 * route to resizing or rotating on a touchscreen.
 */

test.use({ ...devices["iPhone 13"] });

const CLOSE_SHAPE = /close shape panel/i;

async function openDesigner(page: Page, tag: string) {
  await signUp(page, freshUser(tag));
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  // The advisory banner rides above the workspace and can end up over the
  // device switch, which pans with the board. Put it away: it is not what is
  // under test, and it is the first thing a real seller does with it.
  const dismiss = page.getByRole("button", {
    name: "Dismiss the small-screen editing notice",
  });
  if (await dismiss.count()) await dismiss.click();
  await page.waitForTimeout(800);
}

/** Put `count` squares on the board, leaving nothing selected. */
async function addSquares(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "All shapes" })
      .click();
    await page.getByRole("button", { name: "Add square" }).click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(i + 1);
    await page.getByRole("button", { name: "Close library panel" }).click();
    await page.getByRole("button", { name: CLOSE_SHAPE }).click();
    await page.waitForTimeout(300);
  }
}

/** Where the selected cell, its chrome and the open sheet all are, plus what a
 *  finger would actually reach at the points where the two meet. */
function scene(page: Page) {
  return page.evaluate(() => {
    const cell = Array.from(
      document.querySelectorAll<HTMLElement>("li[data-grid-cell]"),
    ).find((node) => node.querySelector("[data-block-selected]"));
    const sheet = Array.from(
      document.querySelectorAll<HTMLElement>("[data-canvas-panel]"),
    ).find((node) => node.getBoundingClientRect().height > 0);
    if (!cell || !sheet) return null;

    const cellRect = cell.getBoundingClientRect();
    const sheetRect = sheet.getBoundingClientRect();
    const box = (r: DOMRect) => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    });
    // The cell PLUS everything hanging outside it: the same box the reveal
    // rules anchor on, and the reason a flush reveal is not a reveal. The
    // handles are drawn in the cell's chrome layer, its sibling.
    const layer = document.querySelector<HTMLElement>(
      `li[data-grid-chrome="${CSS.escape(cell.dataset.gridKey ?? "")}"]`,
    );
    const chrome = Array.from(
      layer?.querySelectorAll<HTMLElement>("[data-tile-chrome]") ?? [],
    )
      .map((node) => node.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    const withChrome = chrome.reduce(
      (acc, r) => ({
        top: Math.min(acc.top, r.top),
        bottom: Math.max(acc.bottom, r.bottom),
        left: Math.min(acc.left, r.left),
        right: Math.max(acc.right, r.right),
      }),
      box(cellRect),
    );

    // Three points down the sheet, on the selected tile's own column: whatever
    // is drawn there has to belong to the sheet.
    const x = Math.min(
      Math.max((cellRect.left + cellRect.right) / 2, sheetRect.left + 4),
      sheetRect.right - 4,
    );
    const through = [10, 40, 90]
      .map((down) => sheetRect.top + down)
      .filter((y) => y < sheetRect.bottom - 4)
      .map((y) => {
        const under = document.elementFromPoint(x, y);
        return {
          y: Math.round(y),
          inSheet: !!under && sheet.contains(under),
          hit: `${under?.tagName}.${(under?.className || "").toString().slice(0, 40)}`,
        };
      });

    return {
      cell: box(cellRect),
      withChrome,
      sheetTop: sheetRect.top,
      chromeZ: layer ? getComputedStyle(layer).zIndex : null,
      through,
      // The strip the sheet leaves: from the top of the workspace to its edge.
      workspaceTop: document.querySelector("main")!.getBoundingClientRect().top,
    };
  });
}

test("mobile preview: a selected block never paints over the sheet", async ({
  page,
}) => {
  await openDesigner(page, "sheet-over-preview");
  // Enough blocks that the preview column runs past the bottom of the screen,
  // so one of them is genuinely under where the sheet opens.
  await addSquares(page, 3);

  await page.getByRole("button", { name: "Mobile preview" }).first().click();
  await page.waitForTimeout(1_200);
  // The premise: this really is the stage-less preview column. On the design
  // canvas the stage traps the lift on its own and the bug cannot occur.
  expect(await page.locator("[data-canvas-stage]").count()).toBe(0);

  const tile = page.locator("li[data-grid-cell]").last();
  const box = (await tile.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: CLOSE_SHAPE })).toBeVisible();
  await page.waitForTimeout(1_200);

  const after = (await scene(page))!;
  expect(after, "a tile is selected and a sheet is up").not.toBeNull();

  // The chrome is still above every block: this was never fixed by giving
  // the board up.
  expect(after.chromeZ).toBe("660");
  // And every point down the sheet belongs to the sheet.
  expect(after.through.length).toBeGreaterThan(0);
  for (const point of after.through) {
    expect(point.inSheet, `${point.hit} is drawn over the sheet at y=${point.y}`).toBe(
      true,
    );
  }
});

test("mobile preview: selecting a block scrolls it into the open, centred", async ({
  page,
}) => {
  await openDesigner(page, "sheet-scroll-preview");
  await addSquares(page, 3);

  await page.getByRole("button", { name: "Mobile preview" }).first().click();
  await page.waitForTimeout(1_200);

  const tile = page.locator("li[data-grid-cell]").last();
  const box = (await tile.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: CLOSE_SHAPE })).toBeVisible();
  await page.waitForTimeout(1_500);

  const after = (await scene(page))!;
  // Wholly inside the strip the sheet left, chrome and all...
  expect(after.withChrome.bottom).toBeLessThanOrEqual(after.sheetTop + 1);
  expect(after.withChrome.top).toBeGreaterThanOrEqual(after.workspaceTop - 1);
  // ...and centred in it rather than shoved against one end.
  const above = after.withChrome.top - after.workspaceTop;
  const below = after.sheetTop - after.withChrome.bottom;
  expect(Math.abs(above - below)).toBeLessThan(24);
});

test("design canvas: a revealed block is centred, so its handles stay reachable", async ({
  page,
}) => {
  await openDesigner(page, "sheet-centre-design");
  await addSquares(page, 1);

  const tile = page.locator("li[data-grid-cell]").first();
  await tile.click();
  await expect(page.getByRole("button", { name: CLOSE_SHAPE })).toBeVisible();
  await page.waitForTimeout(1_500);

  const after = (await scene(page))!;
  const above = after.withChrome.top - after.workspaceTop;
  const below = after.sheetTop - after.withChrome.bottom;
  expect(after.withChrome.bottom).toBeLessThanOrEqual(after.sheetTop + 1);
  expect(Math.abs(above - below)).toBeLessThan(24);

  // The point of centring: the handles welded under the tile are drawn clear
  // of the sheet and a finger reaches them, rather than landing on the sheet.
  for (const name of [/^Resize /, /^Rotate /]) {
    const control = page.getByRole("button", { name }).or(
      page.getByRole("slider", { name }),
    );
    const handle = (await control.first().boundingBox())!;
    expect(handle, `${name} has no box`).not.toBeNull();
    const reached = await page.evaluate(
      ({ x, y }) => {
        const under = document.elementFromPoint(x, y);
        const cell = under?.closest("li[data-grid-cell], li[data-grid-chrome]");
        return { onBoard: !!cell, hit: under?.tagName ?? "none" };
      },
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    );
    expect(reached.onBoard, `${name} is covered by ${reached.hit}`).toBe(true);
  }
});
