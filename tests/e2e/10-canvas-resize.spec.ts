import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * Resizing in the storefront designer.
 *
 * There is ONE handle, bottom-right, and it can be dragged in any direction:
 * the tile's own top-left cell anchors the gesture, and the block spans from
 * there to whatever cell the cursor is over. Dragging past the anchor puts the
 * span on the other side of it, which is how a tile grows up and left without
 * a second control.
 *
 * The invariant worth asserting is therefore that the ANCHOR CELL stays inside
 * the result no matter which way the drag went.
 *
 * One account, one page, shared: sign-ups are rate limited to 5 per client per
 * hour, so a signup per test would fail for reasons unrelated to resizing.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

/** Cell placement read back off the inline grid style. */
type Placement = { x: number; y: number; w: number; h: number };

async function placementOf(index = 0): Promise<Placement> {
  return page.evaluate((i) => {
    const cell = document.querySelectorAll("li[data-grid-cell]")[i] as HTMLElement;
    if (!cell) throw new Error("no grid cell");
    // "x+1 / span w"
    const col = cell.style.gridColumn.match(/(\d+)\s*\/\s*span\s*(\d+)/);
    const row = cell.style.gridRow.match(/(\d+)\s*\/\s*span\s*(\d+)/);
    if (!col || !row) throw new Error(`unparsed placement: ${cell.style.gridColumn}`);
    return {
      x: Number(col[1]) - 1,
      w: Number(col[2]),
      y: Number(row[1]) - 1,
      h: Number(row[2]),
    };
  }, index);
}

/**
 * One grid cell + gap, in SCREEN px — the distance a drag must cover.
 *
 * Measured off the rendered cells rather than computed from `columnGap`: the
 * canvas sits under a zoom transform, so a CSS gap is unscaled while a
 * bounding rect is not, and mixing the two silently overshoots by a cell.
 */
async function stride() {
  return page.evaluate(() => {
    const grid = document.querySelector("li[data-grid-cell]")?.parentElement;
    if (!grid) throw new Error("no grid");
    const rects = [...grid.children].map((el) => el.getBoundingClientRect());
    const smallestGapAlong = (
      pick: (r: DOMRect) => number,
      sameLine: (r: DOMRect) => number,
    ) => {
      let best = Infinity;
      for (const a of rects) {
        for (const b of rects) {
          if (Math.abs(sameLine(a) - sameLine(b)) > 1) continue;
          const d = pick(b) - pick(a);
          if (d > 1 && d < best) best = d;
        }
      }
      return best;
    };
    const x = smallestGapAlong((r) => r.left, (r) => r.top);
    const y = smallestGapAlong((r) => r.top, (r) => r.left);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("could not measure the grid stride");
    }
    return { x, y };
  });
}

/** Drag the one resize handle by a screen-px delta. */
async function dragHandle(dx: number, dy: number, index = 0) {
  // Selecting a block opens the colour layer over the canvas, and a board that
  // layer lands on eases out from under it. Measure the handle only once that
  // has finished, or the press lands where the handle used to be.
  await canvasStill(page);
  const button = page
    .locator("li[data-grid-cell]")
    .nth(index)
    .getByRole("button", { name: /resize/i });
  const box = await button.boundingBox();
  if (!box) throw new Error("no resize handle");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

const tiles = () => page.locator("li[data-grid-cell]");

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signUp(page, freshUser("canvas-resize"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await page.waitForTimeout(800);
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("storefront canvas resize", () => {
  test("there is exactly one resize handle", async () => {
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(tiles()).toHaveCount(1);
    await expect(
      tiles().first().getByRole("button", { name: /resize/i }),
    ).toHaveCount(1);
  });

  test("dragging the handle right and down still grows the tile", async () => {
    const before = await placementOf();
    const step = await stride();
    await dragHandle(step.x, step.y);

    const after = await placementOf();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.w).toBe(before.w + 1);
    expect(after.h).toBe(before.h + 1);
  });

  test("dragging the handle back shrinks the tile to its anchor cell", async () => {
    const before = await placementOf();
    const step = await stride();
    await dragHandle(-step.x * before.w, -step.y * before.h);

    const after = await placementOf();
    // Never smaller than the anchor cell, and never off it.
    expect(after).toEqual({ x: before.x, y: before.y, w: 1, h: 1 });
  });

  test("dragging the handle past the tile stretches it left", async () => {
    // The first block sits at 0,0 with nothing to its left. Add a second, then
    // delete the first, so the survivor has free space to stretch into.
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(tiles()).toHaveCount(2);
    await tiles().first().click();
    await page.keyboard.press("Delete");
    await expect(tiles()).toHaveCount(1);

    const before = await placementOf();
    expect(before.x, "survivor should not be at the left edge").toBeGreaterThan(0);

    // The handle sits at the block's RIGHT end, so crossing the anchor means
    // travelling the block's own width first — one stride would only shrink it.
    const step = await stride();
    await dragHandle(-step.x * before.w, 0);

    const after = await placementOf();
    expect(after.x).toBe(before.x - 1);
    expect(after.w).toBe(2);
    // The anchor cell is still in the block — the span flipped around it.
    expect(after.x + after.w).toBeGreaterThan(before.x);
    expect(after.y).toBe(before.y);
    expect(after.h).toBe(1);
  });

  test("dragging the handle past the tile stretches it up", async () => {
    // Move the tile down a row so there is space above it.
    await canvasStill(page);
    const tile = tiles().first();
    const box = (await tile.boundingBox())!;
    const step = await stride();
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 4,
      box.y + box.height / 2 + step.y,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    const before = await placementOf();
    expect(before.y, "tile should have moved down a row").toBeGreaterThan(0);

    await dragHandle(0, -step.y * before.h);

    const after = await placementOf();
    expect(after.y).toBe(before.y - 1);
    expect(after.h).toBe(2);
    expect(after.x).toBe(before.x);
  });

  test("a resize survives a save and reload", async () => {
    const before = await placementOf();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i);

    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(tiles()).toHaveCount(1);
    expect(await placementOf()).toEqual(before);
  });
});
