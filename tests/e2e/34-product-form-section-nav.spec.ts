import { expect, test } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

/**
 * The right-side "On this page" index used bare `href="#section-id"`
 * anchors. Chrome, Safari and Firefox all fire a `popstate` event for that
 * kind of same-document navigation (not just `hashchange`), and the product
 * form's unsaved-changes guard listens for `popstate` to catch the browser
 * Back button — so every click on the index while the form was dirty was
 * misread as a Back press and popped "Discard your changes?" over a click
 * that never intended to leave. See FormSectionNav.tsx's `handleNavClick`.
 */
test.describe("product form section nav vs. the unsaved-changes guard", () => {
  test("jumping to a section via the index does not trigger the discard prompt", async ({
    page,
  }) => {
    const user = freshUser("sectionnav");
    await signUp(page, user);
    await gotoApp(page, "/products/new");

    // Dirty the form.
    await page.getByLabel("Title").fill("Section nav regression");

    // The index rail only renders at `lg` — Desktop Chrome's default
    // viewport (1280x720) clears that.
    const nav = page.getByRole("navigation", { name: "Form sections" });
    await expect(nav).toBeVisible();

    await nav.locator('[data-product-form-nav-item="photos"]').click();

    // The bug showed up as this dialog; it must never appear from this click.
    await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeHidden();
    // And the click still did its one job: the section is on screen.
    await expect(page.locator('[data-product-section="photos"]')).toBeInViewport();

    // The title, typed before the click, must have survived — a false
    // "leave" navigation would have unmounted the form and lost it.
    await expect(page.getByLabel("Title")).toHaveValue("Section nav regression");
  });

  test("the discard-changes prompt still appears for a real leave, with single-line, iconed buttons", async ({
    page,
  }) => {
    const user = freshUser("discardui");
    await signUp(page, user);
    await gotoApp(page, "/products/new");

    await page.getByLabel("Title").fill("Discard UI regression");
    await page.getByRole("button", { name: "Cancel" }).click();

    const dialog = page.getByRole("dialog", { name: "Discard your changes?" });
    await expect(dialog).toBeVisible();

    const keepEditing = dialog.getByRole("button", { name: "Keep editing" });
    const discard = dialog.getByRole("button", { name: "Discard changes" });
    const saveAndLeave = dialog.getByRole("button", { name: "Save and leave" });
    await expect(keepEditing).toBeVisible();
    await expect(discard).toBeVisible();
    await expect(saveAndLeave).toBeVisible();

    // Icons on the two consequential actions.
    await expect(discard.locator("svg")).toBeVisible();
    await expect(saveAndLeave.locator("svg")).toBeVisible();

    // No button's label wraps to a second line: a single line of text plus
    // the button's own padding lands around 40-42px; a wrapped label would
    // add a whole second line height on top of that (roughly 60px+).
    for (const button of [keepEditing, discard, saveAndLeave]) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeLessThan(50);
    }

    await keepEditing.click();
    await expect(dialog).toBeHidden();
  });
});
