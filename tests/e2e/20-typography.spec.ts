import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * Typography and masthead colour, end to end.
 *
 * The three things a seller can now do that they could not before: size text to
 * any value rather than picking one of five, colour the store name and bio
 * independently of the theme, and choose a typeface for the whole storefront,
 * including one of their own.
 *
 * Each is asserted on what the BROWSER computed, not on what the control says,
 * because every one of them is a config value that has to survive a save, a
 * reload, and a re-parse before it means anything.
 */

/** Open one of the design panel's collapsed sections by its heading. */
async function openSection(page: Page, name: string) {
  const toggle = page.getByRole("button", { name, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}

const canvas = (page: Page) => page.locator('div[class*="rounded-md"]').first();

test.describe("storefront typography", () => {
  test("free-form text size survives a save and a reload", async ({ page }) => {
    await signUp(page, freshUser("textsize"));
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    const text = page.getByText("Your text here").first();
    await expect(text).toBeVisible();

    // A size that is deliberately NOT one of the five old presets (14/16/20/
    // 30/36): if the enum were still in the way, this could not be stored.
    await page.getByLabel("Size", { exact: true }).fill("53");
    await expect
      .poll(async () =>
        text.evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("53px");

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();

    const reloaded = page.getByText("Your text here").first();
    await expect(reloaded).toBeVisible({ timeout: 20_000 });
    expect(
      await reloaded.evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe("53px");

    // The slider is the same control: nudging it moves off 53 rather than
    // snapping to a preset.
    await reloaded.click();
    const slider = page.getByRole("slider", { name: "Font size" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "54");
  });

  test("the masthead is on by default and is styled from the canvas", async ({
    page,
  }) => {
    await signUp(page, freshUser("headerstyle"));
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    // A new storefront starts with the header shown and filled in: no toggle
    // to find, and something on the canvas to click.
    const name = page.getByRole("button", { name: /style the store name/i });
    await expect(name).toBeVisible();

    await openSection(page, "Header");
    await page.getByLabel("Store name").fill("Colour Shop");
    await page.getByLabel("Bio", { exact: true }).fill("We sell colour");

    // Clicking the bio on the canvas aims the LEFT panel at it. Colour and
    // size are both there; nothing about the line is styled from the right.
    await page.getByRole("button", { name: /style the store bio/i }).click();
    const panel = page.getByRole("heading", { name: "Bio" });
    await expect(panel).toBeVisible();

    await page.getByLabel("Size", { exact: true }).fill("29");
    await page
      .getByRole("group", { name: /standard colors/i })
      .getByRole("button", { name: /^white/i })
      .click();

    const bio = page.getByText("We sell colour");
    await expect
      .poll(async () =>
        bio.evaluate((node) => {
          const style = getComputedStyle(node);
          return `${style.color} ${style.fontSize}`;
        }),
      )
      .toBe("rgb(255, 255, 255) 29px");

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();

    const saved = page.getByText("We sell colour");
    await expect(saved).toBeVisible({ timeout: 20_000 });
    expect(
      await saved.evaluate((node) => {
        const style = getComputedStyle(node);
        return `${style.color} ${style.fontSize}`;
      }),
    ).toBe("rgb(255, 255, 255) 29px");

    // Back to the theme: the override is dropped, not stored as a colour that
    // happens to match.
    await page.getByRole("button", { name: /style the store bio/i }).click();
    await page.getByRole("button", { name: /use theme color/i }).click();
    await expect
      .poll(async () => saved.evaluate((node) => getComputedStyle(node).color))
      .not.toBe("rgb(255, 255, 255)");
  });

  test("Montserrat is offered as a preset and applies to the canvas", async ({
    page,
  }) => {
    await signUp(page, freshUser("presetfont"));
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    await openSection(page, "Typography");
    await page.getByRole("combobox", { name: "Font" }).click();
    await page.getByRole("option", { name: /montserrat/i }).click();

    // next/font hashes the family name, so assert on the family it resolved to
    // rather than the literal word.
    await expect
      .poll(async () =>
        canvas(page).evaluate((node) => getComputedStyle(node).fontFamily),
      )
      .toMatch(/montserrat/i);

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();
    await expect
      .poll(
        async () =>
          canvas(page).evaluate((node) => getComputedStyle(node).fontFamily),
        { timeout: 20_000 },
      )
      .toMatch(/montserrat/i);
  });

  test("an uploaded font applies to the canvas", async ({ page }) => {
    // Needs real object storage, like the product-image spec: without R2 the
    // upload route correctly answers 503 and there is nothing to assert.
    test.skip(
      process.env.E2E_REAL_R2 !== "1",
      "needs real R2: run with E2E_REAL_R2=1",
    );

    await signUp(page, freshUser("customfont"));
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    await openSection(page, "Typography");
    await page.locator('input[type="file"][accept*="woff2"]').setInputFiles({
      name: "Seller.woff2",
      mimeType: "font/woff2",
      // A real face, so the sniffer sees genuine wOF2 magic bytes.
      buffer: readFileSync(
        join(process.cwd(), "src", "app", "fonts", "Montserrat.woff2"),
      ),
    });

    // Uploading IS choosing: the canvas picks up the face without a second step.
    await expect(page.getByText("Seller.woff2")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          canvas(page).evaluate((node) => getComputedStyle(node).fontFamily),
        { timeout: 15_000 },
      )
      .toMatch(/ss-font-[0-9a-f-]+/);

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 20_000);
    await page.reload();

    await openSection(page, "Typography");
    await expect(page.getByText("Seller.woff2")).toBeVisible({ timeout: 20_000 });
    // The face is registered from a SIGNED url, never one the config carried.
    expect(
      await canvas(page).evaluate((node) => getComputedStyle(node).fontFamily),
    ).toMatch(/ss-font-[0-9a-f-]+/);

    // Removing it puts the storefront back on a built-in face.
    await page.getByRole("button", { name: /^remove$/i }).click();
    await expect
      .poll(async () =>
        canvas(page).evaluate((node) => getComputedStyle(node).fontFamily),
      )
      .not.toMatch(/ss-font-/);
  });
});
