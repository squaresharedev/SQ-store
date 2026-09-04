import { test, expect } from "@playwright/test";
import { freshUser, gotoApp, serviceRest, signUp } from "./helpers";

/**
 * Product options in the seller's hands: naming the axes a product varies
 * along, filling their values fast, and having both survive a save.
 *
 * NO OBJECT STORAGE NEEDED, unlike 31-product-page-fields: options are text,
 * so this runs on the hermetic stack and guards the part of the feature every
 * seller touches. Photos tied to an option are covered there, where R2 is real.
 *
 * The claim under test is the EASE one. A seller with six sizes should not
 * perform six add-a-row interactions, so the two paths that avoid it — a
 * preset that arrives filled in, and pasting a list into one box — are what
 * this drives, rather than a synthetic one-at-a-time path no seller would use.
 */

test.describe("product options", () => {
  test("a seller names two axes, fills them in two gestures, and they persist", async ({
    page,
  }) => {
    await signUp(page, freshUser("product-options"));
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Workshop Lamp");
    await page.getByLabel(/price/i).fill("129.00");

    // Nothing until the seller says the product varies: a product sold in one
    // version must not be made to think about options at all.
    await expect(page.locator("[data-option-group]")).toHaveCount(0);

    // GESTURE ONE: a preset names the axis and picks its display.
    await page.getByRole("button", { name: "Colour", exact: true }).click();
    const colour = page.locator("[data-option-group]").first();
    await expect(colour.getByLabel("What varies")).toHaveValue("Colour");
    await expect(colour.getByRole("button", { name: "Swatches" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // GESTURE TWO: the values, pasted as one line, become three options.
    await colour.getByLabel("Add options").fill("Midnight blue, Bone, Clay");
    await page.keyboard.press("Enter");
    await expect(colour.locator("[data-option-row]")).toHaveCount(3);
    await expect(colour.getByLabel("Add options")).toHaveValue("");

    // A second axis, whose values are WORDS. This is the case the colour-only
    // field could not express: the display defaults to chips, not swatches.
    await page.getByRole("button", { name: "Power output", exact: true }).click();
    const power = page.locator("[data-option-group]").nth(1);
    await expect(power.getByRole("button", { name: "Chips" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A REAL multi-line paste, the way a spreadsheet column arrives. A
    // single-line input silently strips the newlines out of pasted text, so
    // this only works because the field reads the clipboard itself — without
    // that, "500 W\n750 W" lands as one run-on option and nothing says so.
    await power.getByLabel("Add options").focus();
    await power.getByLabel("Add options").evaluate((input) => {
      const data = new DataTransfer();
      data.setData("text", "500 W\n750 W");
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect(power.locator("[data-option-row]")).toHaveCount(2);
    await expect(power.locator("[data-option-row] input").first()).toHaveValue("500 W");

    // A repeat is dropped rather than duplicated: two "500 W" chips would be
    // indistinguishable to a buyer.
    await power.getByLabel("Add options").fill("500 w");
    await page.keyboard.press("Enter");
    await expect(power.locator("[data-option-row]")).toHaveCount(2);

    // One option marked unavailable, which is what the buy button reads.
    await colour.getByRole("switch").first().click();

    // The Photos section grew a bucket per option, across BOTH axes, without
    // the seller going anywhere: that is why Options sits above Photos.
    await expect(page.locator("[data-gallery-bucket]")).toHaveCount(6); // 5 options + shared
    await expect(page.locator("[data-gallery-bucket]", { hasText: "750 W" })).toBeVisible();

    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });

    // Stored as the seller authored them: order, display and availability.
    const rows = (await serviceRest(
      "/products?title=eq.Workshop%20Lamp&select=option_groups",
    )) as {
      option_groups: {
        name: string;
        display: string;
        options: { name: string; available: boolean }[];
      }[];
    }[];
    const groups = rows[0]!.option_groups;
    expect(groups.map((group) => `${group.name}:${group.display}`)).toEqual([
      "Colour:swatch",
      "Power output:chip",
    ]);
    expect(groups[0]!.options.map((option) => option.name)).toEqual([
      "Midnight blue",
      "Bone",
      "Clay",
    ]);
    expect(groups[0]!.options[0]!.available).toBe(false);
    expect(groups[1]!.options.map((option) => option.name)).toEqual(["500 W", "750 W"]);

    // And they come back into the form the same way.
    await page.getByRole("link", { name: "Edit Workshop Lamp" }).click();
    await page.waitForURL(/\/products\/.+\/edit$/);
    await expect(page.locator("[data-option-group]")).toHaveCount(2);
    await expect(page.locator("[data-option-row]")).toHaveCount(5);
    await expect(page.locator("[data-option-group]").first().getByLabel("What varies")).toHaveValue(
      "Colour",
    );
  });

  test("an option group with nothing to pick is refused, naming what to fix", async ({ page }) => {
    await signUp(page, freshUser("product-options-empty"));
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Half-filled Lamp");
    await page.getByLabel(/price/i).fill("10.00");

    // An axis with no values would print an empty picker on the page. The
    // schema refuses it; the form has to say which one and why, because
    // "didn't pass validation" is not something a seller can act on.
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await page.getByRole("button", { name: /save product/i }).click();

    await expect(page.getByText(/add at least one material option/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/products\/new$/);

    // Fixing exactly what it named lets the save through.
    await page.getByLabel("Add options").fill("Solid oak");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });
  });
});
