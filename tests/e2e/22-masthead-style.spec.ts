import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * The masthead's store name and bio carry the same styling a text block does:
 * font, size, colour, bold/italic/underline and alignment.
 *
 * Neither line has a tile or an inspector card, so clicking it on the canvas
 * aims the LEFT-hand panel at it and that panel is the whole of its styling.
 * What these cover is that the two lines stay independent, that the controls
 * write to the thing the panel says they are on, and that "off" is stored as
 * nothing rather than as a value (the storage side is unit-tested in
 * tests/unit/header-style.test.ts).
 *
 * ONE account, ONE page, shared across the file (sign-ups are rate limited);
 * serial because the page is shared. Every test reloads to a clean masthead.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let storefrontUrl: string;

const name = () => page.getByRole("button", { name: "Edit the store name" });
const bio = () => page.getByRole("button", { name: "Edit the store bio" });

/** One rendered CSS property of a masthead line. */
function css(line: Locator, property: string) {
  return line.evaluate(
    (node, key) => getComputedStyle(node).getPropertyValue(key as string),
    property,
  );
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("masthead"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  storefrontUrl = page.url();
});

test.beforeEach(async () => {
  // Back to an unstyled masthead: these tests never save, so a reload is a
  // clean slate without any per-test teardown to keep in step.
  await gotoApp(page, storefrontUrl);
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("masthead line styling", () => {
  test("the store name takes format, alignment, font and size", async () => {
    await name().click();
    // The panel is on the line, and carries type controls as well as colour.
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();

    // The masthead's own semibold (600) gives way to a real bold.
    expect(await css(name(), "font-weight")).toBe("600");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect.poll(() => css(name(), "font-weight")).toBe("700");
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Italic" }).click();
    await expect.poll(() => css(name(), "font-style")).toBe("italic");
    await page.getByRole("button", { name: "Underline" }).click();
    await expect
      .poll(() => css(name(), "text-decoration-line"))
      .toBe("underline");

    await page.getByRole("button", { name: "Align center" }).click();
    await expect.poll(() => css(name(), "text-align")).toBe("center");

    // Size was already here and has to keep working beside the rest.
    await page.getByRole("spinbutton", { name: "Size" }).fill("48");
    await expect.poll(() => css(name(), "font-size")).toBe("48px");

    // The typeface is per line, from the same allowlist as everything else.
    const before = await css(name(), "font-family");
    await page.getByRole("combobox", { name: "Font" }).click();
    await page.getByRole("option", { name: /mono/i }).click();
    await expect.poll(() => css(name(), "font-family")).not.toBe(before);
  });

  test("left alignment goes back to inheriting, not to a stored left", async () => {
    await name().click();
    await page.getByRole("button", { name: "Align center" }).click();
    await expect.poll(() => css(name(), "text-align")).toBe("center");
    await page.getByRole("button", { name: "Align left" }).click();
    // No alignment of its own: the line inherits, exactly as an untouched
    // masthead always has.
    await expect.poll(() => css(name(), "text-align")).toBe("start");
  });

  test("the two lines style independently", async () => {
    await name().click();
    await page.getByRole("button", { name: "Bold" }).click();
    await expect.poll(() => css(name(), "font-weight")).toBe("700");

    await bio().click();
    // A fresh line, carrying none of the name's styling.
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByRole("button", { name: "Italic" }).click();
    await expect.poll(() => css(bio(), "font-style")).toBe("italic");

    // ...and the name kept its own.
    expect(await css(name(), "font-style")).toBe("normal");
    expect(await css(name(), "font-weight")).toBe("700");
  });

  test("Ctrl+B formats the line the panel is on", async () => {
    await name().click();
    await page.keyboard.press("ControlOrMeta+b");
    await expect.poll(() => css(name(), "font-weight")).toBe("700");
    await page.keyboard.press("ControlOrMeta+b");
    await expect.poll(() => css(name(), "font-weight")).toBe("600");
  });

  test("masthead styling goes through undo, and survives a save", async () => {
    await name().click();
    await page.getByRole("button", { name: "Bold" }).click();
    await expect.poll(() => css(name(), "font-weight")).toBe("700");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => css(name(), "font-weight")).toBe("600");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(() => css(name(), "font-weight")).toBe("700");

    await page.getByRole("button", { name: "Align center" }).click();
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.reload();
    await expect(name()).toBeVisible({ timeout: 20_000 });
    expect(await css(name(), "font-weight")).toBe("700");
    expect(await css(name(), "text-align")).toBe("center");
  });
});
