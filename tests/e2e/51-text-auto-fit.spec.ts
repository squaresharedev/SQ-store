import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * A text block used to render at a flat size (its style's own scale) no
 * matter what the seller typed, so a paragraph in a small box was silently
 * clipped by the tile's own overflow:hidden with no way to tell from the
 * canvas alone. Auto now shrinks the block to fit its box instead, and only
 * an explicit size (the seller taking control) is still allowed to overflow —
 * that is now the deliberate way to ask for a crop.
 *
 * ONE account, ONE page, shared (sign-ups are rate limited); serial because
 * the page is shared.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

const canvasText = () => page.getByRole("textbox", { name: "Block text" });
const tileText = () => page.locator("[data-block-tile] p").first();

async function fontSize() {
  return tileText().evaluate((node) => getComputedStyle(node).fontSize);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("text-auto-fit"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();

  // One 2x1 heading block for every test below: short words first, so the
  // very first assertion pins the un-shrunk ceiling.
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(canvasText()).toBeFocused();
  await page.keyboard.type("Short");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Short", { exact: true })).toBeVisible();
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("text block auto-fit", () => {
  test("short words render at the heading's own base size", async () => {
    await expect.poll(fontSize).toBe("24px");
    await expect(page.getByText(/^Auto \(24 px\)$/)).toBeVisible();
  });

  test("typing past the box shrinks the words to fit it, live", async () => {
    await tileText().click();
    await tileText().click(); // click-to-select, click-to-type
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(
      "This is a lot more words than a two by one heading block was ever " +
        "going to hold at its full size, on purpose.",
    );
    await page.keyboard.press("Escape");

    // Shrunk well below the ceiling — not just clamped to some fixed
    // second size — and the panel's own number agrees with the canvas.
    await expect
      .poll(async () => Number((await fontSize()).replace("px", "")))
      .toBeLessThan(24);
    const shrunk = await fontSize();
    await expect(page.getByText(new RegExp(`^Auto \\(${shrunk.replace("px", "")} px\\)$`))).toBeVisible();

    // Never clipped: the box actually holds what it now renders.
    const overflow = await page.locator("[data-block-tile]").first().evaluate((tile) => {
      const box = tile.querySelector("p")!.parentElement as HTMLElement;
      return box.scrollHeight - box.clientHeight;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("shrinking back down to short words grows the size back", async () => {
    await tileText().click();
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Short again");
    await page.keyboard.press("Escape");
    await expect.poll(fontSize).toBe("24px");
  });

  test("an explicit size opts back into overflowing, on purpose", async () => {
    await page.getByLabel("Size", { exact: true }).fill("60");
    await expect.poll(fontSize).toBe("60px");

    await tileText().click();
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Long enough to overflow a sixty pixel line inside a two cell box");
    await page.keyboard.press("Escape");

    // The chosen size is never taken back, even though it no longer fits.
    await expect.poll(fontSize).toBe("60px");
    const overflow = await page.locator("[data-block-tile]").first().evaluate((tile) => {
      const box = tile.querySelector("p")!.parentElement as HTMLElement;
      return box.scrollHeight - box.clientHeight;
    });
    expect(overflow).toBeGreaterThan(0);

    // Back to Auto: the shrink takes over again with no stale panel number.
    await page.getByRole("button", { name: "Auto" }).click();
    await expect
      .poll(async () => Number((await fontSize()).replace("px", "")))
      .toBeLessThan(24);
  });
});
