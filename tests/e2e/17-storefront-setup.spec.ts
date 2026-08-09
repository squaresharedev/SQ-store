import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

/**
 * The four questions asked before a seller reaches the designer.
 *
 * The invariants worth guarding are not the copy, which will move around, but
 * the three promises the flow makes:
 *
 *   1. Answering it changes what you see. The look you pick is the theme the
 *      storefront starts on, not a survey answer filed away for later.
 *   2. Skipping is a real option, at any point, and still gets you a
 *      storefront.
 *   3. Backing out creates nothing. An abandoned dialog must not leave an
 *      "Untitled storefront" behind, which is why the row is inserted at the
 *      very end rather than before the first question.
 *
 * Everything is scoped to the dialog rather than the page: "Next" also matches
 * the Next.js dev-tools button that dev mode injects into every page.
 */

function wizard(page: Page): Locator {
  return page.getByRole("dialog");
}

function step(page: Page, name: string | RegExp): Locator {
  return wizard(page).getByRole("button", { name });
}

async function openWizard(page: Page) {
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await expect(wizard(page)).toBeVisible();
}

test.describe("storefront setup flow", () => {
  test("answers every step, and the look picked is the look you land on", async ({
    page,
  }) => {
    await signUp(page, freshUser("setup"));
    await gotoApp(page, "/storefront");
    await openWizard(page);

    // 1 of 4: what you sell.
    await expect(wizard(page)).toContainText("Step 1 of 4");
    await step(page, "Art & prints").click();
    await step(page, "Next").click();

    // 2 of 4: how buyers get it.
    await expect(wizard(page)).toContainText("Step 2 of 4");
    await step(page, /I ship it/).click();
    await step(page, "Next").click();

    // 3 of 4: the look. "Luxe" is the one preset on a dark canvas, so it is
    // the cheapest to verify actually reached the designer.
    await expect(wizard(page)).toContainText("Step 3 of 4");
    await step(page, "Luxe").click();
    await step(page, "Next").click();

    // 4 of 4: the name.
    await expect(wizard(page)).toContainText("Step 4 of 4");
    await wizard(page).getByLabel("Storefront name").fill("Gilt & Grain");
    await step(page, "Create storefront").click();

    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();

    // The name went in.
    await expect(page.locator("#storefront-name")).toHaveValue("Gilt & Grain");

    // And so did the look: the luxe preset paints the canvas #111111, where
    // every other preset (and the plain default) is light.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from(document.querySelectorAll<HTMLElement>("[style]")).some(
              (element) => element.style.backgroundColor === "rgb(17, 17, 17)",
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("skipping at the first question still creates a storefront", async ({
    page,
  }) => {
    await signUp(page, freshUser("setupskip"));
    await gotoApp(page, "/storefront");
    await openWizard(page);

    await step(page, /skip setup/i).click();

    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
    // No answers means no preset: the default name is what lands.
    await expect(page.locator("#storefront-name")).toHaveValue(
      "Untitled storefront",
    );
  });

  test("dismissing the dialog creates nothing", async ({ page }) => {
    await signUp(page, freshUser("setupcancel"));
    await gotoApp(page, "/storefront");
    await openWizard(page);

    // Get an answer in first: abandoning partway is the case that would
    // otherwise leave an orphan row behind.
    await step(page, "Clothing").click();
    await step(page, "Next").click();
    await expect(wizard(page)).toContainText("Step 2 of 4");
    await page.keyboard.press("Escape");

    await expect(wizard(page)).toBeHidden();
    await expect(page).toHaveURL(/\/storefront$/);
    await expect(page.getByText(/no storefronts yet/i)).toBeVisible();
  });

  test("a second storefront opens with the first one's answers already in", async ({
    page,
  }) => {
    await signUp(page, freshUser("setupagain"));
    await gotoApp(page, "/storefront");

    await openWizard(page);
    await step(page, "Food & drink").click();
    await step(page, "Next").click();
    await step(page, /They download it/).click();
    await step(page, /^Skip$/).click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await gotoApp(page, "/storefront");
    await openWizard(page);

    // What they sell has not changed since five minutes ago, so the flow
    // confirms rather than re-asks.
    await expect(step(page, "Food & drink")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await step(page, "Next").click();
    await expect(step(page, /They download it/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
