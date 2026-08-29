import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * The layers list: the stack as something you can look at and point at.
 *
 * The rules are pinned without a browser (tests/unit/storefront-layers.test.ts,
 * tests/component/layers-panel.test.tsx). What only the real editor can prove
 * is that the list opens INSIDE the panel rather than over the canvas, that the
 * order it draws is the order the board paints in, and that picking a row
 * really does hand back the block — including the one buried underneath, which
 * is the case that cannot be clicked at all.
 */

/** The depth every cell paints at, in DOM order (which is reading order and
 *  never changes). Same probe the layering spec uses. */
async function depths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
      (cell) => Number(getComputedStyle(cell).zIndex),
    ),
  );
}

/** Two shapes on the board, the circle inserted last and so in front. */
async function setUpBoard(page: Page, tag: string) {
  await signUp(page, freshUser(tag));
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
}

const layerRows = (page: Page) =>
  page.getByRole("list", { name: /Canvas layers/ }).getByRole("listitem");

test.describe("the layers list", () => {
  test("opens in the panel, over nothing, front row first", async ({
    page,
  }) => {
    await setUpBoard(page, "layerspanel");
    // The way in, from the block that is already selected.
    await page.getByRole("button", { name: "See all layers" }).click();

    const list = page.getByRole("list", { name: /Canvas layers/ });
    await expect(list).toBeVisible();
    await expect(layerRows(page)).toHaveCount(2);
    // Front first: the circle went on last, so it is the top row.
    await expect(layerRows(page).first()).toContainText("Circle");
    await expect(layerRows(page).last()).toContainText("Square");

    // IN the panel, not over the board: the list lives inside the design
    // column, which is the whole point of it not being a popup.
    expect(
      await list.evaluate(
        (node) => node.closest("[data-design-panel]") !== null,
      ),
    ).toBe(true);
  });

  test("reaches the block behind, and the list stays up to reach the next", async ({
    page,
  }) => {
    await setUpBoard(page, "layersreach");
    await page.getByRole("button", { name: "See all layers" }).click();
    // Pick the back row (the square) off the list.
    const backRow = layerRows(page).last();
    await backRow.getByRole("button").nth(1).click();
    await expect(backRow.getByRole("button").nth(1)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The list does NOT close on a pick: walking a stack means picking more
    // than once, and a list that dismissed itself would have to be reopened
    // between every two blocks.
    await expect(layerRows(page)).toHaveCount(2);

    // And the selection really did travel: the panel underneath says where
    // that block sits once the list is out of the way.
    await page.getByRole("button", { name: /leaving Layers/ }).click();
    await expect(page.getByText("Layer 1 of 2")).toBeVisible();
  });

  test("a row's own controls move that block, and the board repaints", async ({
    page,
  }) => {
    await setUpBoard(page, "layersmove");
    await page.getByRole("button", { name: "See all layers" }).click();
    const [firstBefore, secondBefore] = await depths(page);
    expect(secondBefore).toBeGreaterThan(firstBefore);

    // Expand the front row and send it all the way back.
    await layerRows(page)
      .first()
      .getByRole("button", { name: /Show layer options/ })
      .click();
    await page.getByRole("button", { name: /^Send to back: Circle/ }).click();

    const [first, second] = await depths(page);
    expect(second).toBeLessThan(first);
    // And the list redrew: the circle is the bottom row now.
    await expect(layerRows(page).last()).toContainText("Circle");
  });

  test("a row dragged down the list lands where it was let go", async ({
    page,
  }) => {
    await setUpBoard(page, "layersdrag");
    await page.getByRole("button", { name: "See all layers" }).click();
    const grip = layerRows(page).first().getByRole("button").first();
    const from = (await grip.boundingBox())!;
    const target = (await layerRows(page).last().boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Past the halfway mark of the row below, in steps, so the drop index is
    // computed from real movement rather than one teleport.
    await page.mouse.move(
      from.x + from.width / 2,
      target.y + target.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    await expect(layerRows(page).last()).toContainText("Circle");
    const [first, second] = await depths(page);
    expect(second).toBeLessThan(first);
  });

  test("the arrow keys on a grip walk the stack", async ({ page }) => {
    await setUpBoard(page, "layersarrows");
    await page.getByRole("button", { name: "See all layers" }).click();
    await layerRows(page).first().getByRole("button").first().focus();

    // Down is toward the back, because down is where the back is drawn.
    await page.keyboard.press("ArrowDown");
    const [first, second] = await depths(page);
    expect(second).toBeLessThan(first);
    await expect(layerRows(page).last()).toContainText("Circle");
  });

  test("Ctrl+brackets still work while the list is up, and it follows", async ({
    page,
  }) => {
    await setUpBoard(page, "layerskeys");
    await page.getByRole("button", { name: "See all layers" }).click();
    // The circle is selected (inserting selects) and is at the front.
    await expect(layerRows(page).first()).toContainText("Circle");

    await page.keyboard.press("Control+Shift+[");
    await expect(layerRows(page).last()).toContainText("Circle");
    await page.keyboard.press("Control+]");
    await expect(layerRows(page).first()).toContainText("Circle");

    // The Mac half of the same binding. Cmd is not a second shortcut, it is
    // the SAME one — the handler takes either modifier — and this is the only
    // way to prove it from a runner that is not a Mac.
    await page.keyboard.press("Meta+Shift+[");
    await expect(layerRows(page).last()).toContainText("Circle");
    await page.keyboard.press("Meta+]");
    await expect(layerRows(page).first()).toContainText("Circle");
  });

  test("comes back to the block it was opened from", async ({ page }) => {
    await setUpBoard(page, "layersback");
    await page.getByRole("button", { name: "See all layers" }).click();
    await expect(page.getByRole("button", { name: "Send to back" })).toBeHidden();

    await page.getByRole("button", { name: /leaving Layers/ }).click();
    await expect(page.getByRole("list", { name: /Canvas layers/ })).toBeHidden();
    await expect(page.getByRole("button", { name: "Send to back" })).toBeVisible();
  });

  test("adds no accessibility violations of its own", async ({ page }) => {
    // A DELTA, for the same reason the layering spec takes one: the editor
    // carries violations that predate this list and belong to it rather than
    // to the list.
    await setUpBoard(page, "layersaxe");

    async function serious() {
      // Settle any fade first: axe reads a mid-fade element as a contrast
      // failure that is not there.
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
    await page.getByRole("button", { name: "See all layers" }).click();
    await layerRows(page)
      .first()
      .getByRole("button", { name: /Show layer options/ })
      .click();
    const after = await serious();
    expect(after).toEqual(before);
    // Nothing the list itself contributes: every row control is a real button
    // named for what it does, never for the glyph on it.
    expect(after.filter((line) => /Reorder |layer options|Canvas layers/.test(line))).toEqual(
      [],
    );
  });

  test("is reachable with nothing selected at all", async ({ page }) => {
    await setUpBoard(page, "layersnosel");
    // The list's best use is finding the block you cannot click, and needing a
    // selection to open it would put it out of reach exactly then.
    await page.getByRole("button", { name: "Close shape panel" }).click();
    await expect(page.getByRole("button", { name: "See all layers" })).toBeHidden();

    // So it is also a row in the global settings menu, which is what the panel
    // shows when nothing is selected.
    await page.getByRole("button", { name: /^Layers/ }).click();
    await expect(layerRows(page)).toHaveCount(2);
  });
});
