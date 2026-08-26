import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * The masthead's WORDS, typed where they read: double-clicking the store name
 * or the bio on the canvas puts a caret in the line instead of sending the
 * seller to the panel's fields.
 *
 * The gesture itself is the thing under test. Selecting a line opens the left
 * panel, which is docked, so the board moves between the two presses of a
 * double-click — these run against a storefront whose panel starts closed,
 * which is the case that gesture has to survive.
 *
 * ONE account, ONE page, shared across the file (sign-ups are rate limited);
 * serial because the page is shared. Every test reloads to a clean masthead.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let storefrontUrl: string;

const DEFAULT_NAME = "Your store name";

/** The static lines, before anything is being typed in them. */
const nameLine = () => page.getByRole("button", { name: "Edit the store name" });
const bioLine = () => page.getByRole("button", { name: "Edit the store bio" });

/** The same lines once they are fields. Matched on the tag as well as the
 *  label, so a text block's in-place editor can never stand in for one. */
const nameField = () => page.locator('h2[role="textbox"][aria-label="Store name"]');
const bioField = () => page.locator('p[role="textbox"][aria-label="Store bio"]');

/** Open one of the design panel's collapsed sections by its heading. */
async function openSection(name: string) {
  const toggle = page.getByRole("button", { name, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

const liveSelection = () =>
  page.evaluate(() => window.getSelection()?.toString() ?? "");

/** The left panel's heading, which names the line it is aimed at. */
const panelHeading = (name: string) =>
  page.getByRole("heading", { name, exact: true });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("mastheadtype"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  storefrontUrl = page.url();
});

test.beforeEach(async () => {
  await gotoApp(page, storefrontUrl);
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("typing the masthead on the canvas", () => {
  test("the FIRST double-click both aims the panel and starts typing", async () => {
    // The whole point of the gesture. The first press opens the docked panel,
    // which slides the board sideways before the second press lands — so the
    // second press is matched by point and time rather than by element, and
    // one double-click has to produce BOTH results, not just the panel.
    await nameLine().dblclick();
    await expect(nameField()).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();

    // Ready to type or delete straight away: the double-clicked word is the
    // selection, so one keystroke replaces it.
    const selected = await liveSelection();
    expect(selected.length).toBeGreaterThan(0);
    expect(DEFAULT_NAME).toContain(selected);

    await page.keyboard.press("Backspace");
    await expect
      .poll(() => nameField().textContent())
      .not.toBe(DEFAULT_NAME);
  });

  test("the double-click survives the line moving between the presses", async () => {
    // What actually goes wrong in the app: the first press aims the panel, the
    // panel opens, the board re-clamps, and the second press lands somewhere
    // else — so the browser never fires dblclick. Reproduced here by moving the
    // line the moment it becomes the selected one, which is the same cause.
    const shift = await page.addStyleTag({
      content: `h2[aria-label="Edit the store name"][aria-pressed="true"]
                { transform: translateX(420px); }`,
    });
    const box = (await nameLine().boundingBox())!;
    const x = box.x + 30;
    const y = box.y + box.height / 2;

    // Back to back: the two presses have to fall inside the double-click
    // window, so nothing may be awaited between them.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.up();

    await expect(nameField()).toBeVisible();
    expect(await liveSelection()).not.toBe("");
    // Take the rule back out. Every test in this file shares one page, so a
    // style left behind goes on jerking the name line 420px sideways under
    // every later double-click.
    await shift.evaluate((node) => node.parentNode?.removeChild(node));
    await page.keyboard.press("Escape");
  });

  test("a second double-click goes straight back to typing", async () => {
    await nameLine().dblclick();
    await expect(nameField()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nameField()).toHaveCount(0);

    // The panel never left the line, so this one has nothing to open: it only
    // puts the caret back, on the word it was aimed at.
    await expect(panelHeading("Store name")).toBeVisible();
    await nameLine().dblclick();
    await expect(nameField()).toBeVisible();
    await expect(panelHeading("Store name")).toBeVisible();
    expect(DEFAULT_NAME).toContain(await liveSelection());
    expect(await liveSelection()).not.toBe("");
  });

  test("what is typed on the canvas is what the panel holds", async () => {
    await nameLine().dblclick();
    await expect(nameField()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Bloom Coffee");
    await expect(nameField()).toHaveText("Bloom Coffee");

    // The panel's own field, not the line on the canvas: while a line is being
    // typed in, both answer to "Store name".
    await openSection("Header");
    const field = page.locator("input").and(page.getByLabel("Store name"));
    await expect(field).toHaveValue("Bloom Coffee");
  });

  test("a line emptied by hand keeps its caret", async () => {
    await nameLine().dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");

    // The field stays on the board with nothing in it — the first Backspace
    // that clears the words must not take the field away with them.
    await expect(nameField()).toBeVisible();
    await expect(nameField()).toHaveAttribute("data-empty", "true");
    await page.keyboard.type("Bloom");
    await expect(nameField()).toHaveText("Bloom");
  });

  test("Escape ends the edit, and one undo takes the whole burst back", async () => {
    await nameLine().dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Bloom Coffee");
    await page.keyboard.press("Escape");

    // Back to a static line, carrying the new words.
    await expect(nameField()).toHaveCount(0);
    await expect(nameLine()).toHaveText("Bloom Coffee");

    // A burst of keystrokes is one edit, exactly like typing on a text tile.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(nameLine()).toHaveText(DEFAULT_NAME);
  });

  test("the bio takes real line breaks, and they survive a save", async () => {
    await bioLine().dblclick();
    await expect(bioField()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Roasted weekly");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Shipped Fridays");
    expect(await bioField().evaluate((node) => node.textContent)).toBe(
      "Roasted weekly\nShipped Fridays",
    );

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();

    await expect(bioLine()).toBeVisible({ timeout: 20_000 });
    expect(await bioLine().evaluate((node) => node.textContent)).toBe(
      "Roasted weekly\nShipped Fridays",
    );
  });

  test("a click on the line the panel is already on starts typing", async () => {
    // The single-click route, which is also what makes the gesture reliable
    // while the panel is opening: the first click aims the panel, the second
    // puts the caret in the words.
    await nameLine().click();
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
    await nameLine().click();
    await expect(nameField()).toBeVisible();

    // Styling still reaches the line while the caret is in it.
    await page.keyboard.press("ControlOrMeta+b");
    await expect
      .poll(() => nameField().evaluate((node) => getComputedStyle(node).fontWeight))
      .toBe("700");
  });
});
