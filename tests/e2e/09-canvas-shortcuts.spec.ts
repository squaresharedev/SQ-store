import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * Canvas keyboard shortcuts in the storefront designer.
 *
 * Note the selection model: clicking a tile TOGGLES it (DesignerCanvas'
 * `toggleSelection`), and inserting a block selects it straight away. So a
 * freshly inserted block is already selected — clicking it once deselects.
 *
 * The delete shortcut is guarded on the event target, so the interesting case
 * is not "does Delete work" but "does Backspace still edit text when the
 * seller is typing in a field".
 *
 * ONE account, ONE page, shared across the file: sign-ups are rate limited to
 * 5 per client per hour (RATE_LIMITS.authSignUpPerClient), so a signup per
 * test would start failing partway down the file for reasons that have nothing
 * to do with the assertions. Serial mode because the page is shared; every
 * test leaves the canvas empty again so the next one starts clean.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

/** The block's words, typed on the tile itself. */
const canvasText = () => page.getByRole("textbox", { name: "Block text" });

/**
 * Insert a text block. It comes back selected AND in typing mode (the words
 * are edited on the tile now), so Escape is what hands the keyboard back to
 * the canvas — every shortcut below is about a tile, not a caret.
 */
async function addTextBlock() {
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(canvasText()).toBeFocused();
  await page.keyboard.press("Escape");
  const tile = page.getByText("Your text here").first();
  await expect(tile).toBeVisible();
  return tile;
}

/** The selected block's inspector card. */
const inspector = () =>
  page.getByRole("button", { name: /close text block panel/i });

/** Drop the selection. Closing the inspector is what clears it — clicking the
 *  tile again would put the caret in it, not deselect. */
async function deselect() {
  await inspector().click();
  await expect(inspector()).toBeHidden();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("canvas-keys"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("storefront canvas shortcuts", () => {
  test("Delete removes the selected block", async () => {
    const tile = await addTextBlock();
    await expect(inspector()).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
    // Removing the selected block closes its inspector too.
    await expect(inspector()).toBeHidden();
  });

  test("Backspace removes the selected block", async () => {
    const tile = await addTextBlock();
    await page.keyboard.press("Backspace");
    await expect(tile).toBeHidden();
  });

  test("a tile selected by clicking can be deleted", async () => {
    const tile = await addTextBlock();
    // Deselect from the panel, not by clicking the tile again: on a text
    // block that second click means "let me type" (see 21-inplace-text).
    await deselect();
    await tile.click(); // selects it again
    await expect(inspector()).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });

  test("Delete does nothing when no block is selected", async () => {
    const tile = await addTextBlock();
    await deselect();

    await page.keyboard.press("Delete");
    await expect(tile).toBeVisible();

    // Leave the canvas empty for the next test.
    await tile.click();
    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });

  test("Backspace while typing edits the text, it does not delete the block", async () => {
    const tile = await addTextBlock();

    // Typing happens ON the tile, and the tile is the very thing Backspace
    // deletes when it is merely selected — so this is the shortcut's sharpest
    // edge: the key must belong to the caret, not to the canvas.
    await tile.click(); // already selected, so this puts the caret in it
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Hello");
    await page.keyboard.press("Backspace");

    const edited = page.getByText("Hell", { exact: true }).first();
    await expect(edited).toBeVisible();

    await page.keyboard.press("Escape"); // out of the caret, block still selected
    await page.keyboard.press("Delete");
    await expect(edited).toBeHidden();
  });

  test("Backspace in the storefront name field does not delete the block", async () => {
    const tile = await addTextBlock();

    const name = page.getByLabel("Storefront name");
    await name.click();
    await name.fill("My shop");
    await page.keyboard.press("Backspace");

    await expect(name).toHaveValue("My sho");
    await expect(tile).toBeVisible();

    // Leave the canvas empty for the next test.
    await tile.click();
    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });

  test("arrow keys move the caret while typing, and the block afterwards", async () => {
    const tile = await addTextBlock();
    const cell = page.locator("[data-grid-cell]").first();
    const before = await cell.getAttribute("style");

    await tile.click(); // selected already: the caret goes in
    await expect(canvasText()).toBeFocused();
    // Arrows belong to the caret here; the grid must not move the block under
    // the seller mid-word.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(cell).toHaveAttribute("style", before ?? "");

    // Escape hands the keyboard back to the TILE, so the same keys are the
    // block's again without any further clicking.
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowRight");
    await expect(cell).not.toHaveAttribute("style", before ?? "");

    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });
});
