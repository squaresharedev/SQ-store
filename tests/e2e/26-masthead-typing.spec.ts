import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * The masthead's WORDS, typed where they read: clicking the store name or the
 * bio on the canvas both aims the left-hand panel at it AND puts a caret in
 * it, in one motion, instead of sending the seller to the panel's fields for
 * the words and back to the canvas for how they look.
 *
 * ONE press is the whole gesture now — there used to be a second one (a
 * double-click, or a click on the line the panel was already on), needed only
 * because the first press opened the docked panel, which slid the board
 * sideways before a second press could land. Collapsing to one press removes
 * that problem rather than surviving it: there is nothing left to survive.
 *
 * ONE account, ONE page, shared across the file (sign-ups are rate limited);
 * serial because the page is shared. Every test reloads to a clean masthead.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let storefrontUrl: string;

// What a freshly created (setup skipped) storefront's header seeds to: the
// row's own default name (see baseName in lib/storefront/actions.ts).
const DEFAULT_NAME = "Untitled storefront";

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
  test("the first click both aims the panel and starts typing", async () => {
    // The whole point of the gesture: one press, both results.
    await nameLine().click();
    await expect(nameField()).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();

    // An ordinary click drops a collapsed caret rather than selecting a word
    // — that is reserved for a genuine double/triple click, which by the time
    // it would land is already inside the field, where the browser's own
    // double-click-selects-a-word takes over.
    expect(await liveSelection()).toBe("");

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect.poll(() => nameField().textContent()).toBe("");
  });

  test("clicking again after Escape goes straight back to typing", async () => {
    await nameLine().click();
    await expect(nameField()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nameField()).toHaveCount(0);

    // The panel never left the line, so this one has nothing to open: it only
    // puts the caret back.
    await expect(panelHeading("Store name")).toBeVisible();
    await nameLine().click();
    await expect(nameField()).toBeVisible();
    await expect(panelHeading("Store name")).toBeVisible();
  });

  test("what is typed on the canvas is what the panel holds", async () => {
    await nameLine().click();
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
    await nameLine().click();
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
    await nameLine().click();
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
    await bioLine().click();
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
});
