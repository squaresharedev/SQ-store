import { expect, test, type Page } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

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

/** Insert a text block. It comes back already selected. */
async function addTextBlock() {
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  const tile = page.getByText("Your text here").first();
  await expect(tile).toBeVisible();
  return tile;
}

/** The selected block's inspector card. */
const inspector = () =>
  page.getByRole("button", { name: /close text block panel/i });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("canvas-keys"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
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
    await tile.click(); // toggles OFF
    await expect(inspector()).toBeHidden();
    await tile.click(); // toggles back ON
    await expect(inspector()).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });

  test("Delete does nothing when no block is selected", async () => {
    const tile = await addTextBlock();
    await tile.click(); // deselect
    await expect(inspector()).toBeHidden();

    await page.keyboard.press("Delete");
    await expect(tile).toBeVisible();

    // Leave the canvas empty for the next test.
    await tile.click();
    await page.keyboard.press("Delete");
    await expect(tile).toBeHidden();
  });

  test("Backspace while typing edits the text, it does not delete the block", async () => {
    await addTextBlock();

    // The selected block's own inspector — a Backspace here must belong to the
    // field, or the seller loses the tile they are editing.
    const textarea = page.getByRole("textbox", { name: "Text" });
    await expect(textarea).toBeVisible();
    await textarea.click();
    await textarea.fill("Hello");
    await page.keyboard.press("Backspace");

    await expect(textarea).toHaveValue("Hell");
    const edited = page.getByText("Hell", { exact: true }).first();
    await expect(edited).toBeVisible();

    await page.keyboard.press("Escape"); // out of the field
    await edited.click(); // deselect
    await edited.click(); // reselect, focus on the canvas
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
  });
});
