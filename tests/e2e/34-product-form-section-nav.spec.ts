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

  /**
   * Regression for the highlight tracking a band near the TOP of the
   * viewport rather than its vertical CENTRE. The old `rootMargin`
   * ("-80px 0px -70% 0px") lit up whichever section had just reached the
   * top, which for a short section (Stock: three fields) meant it stayed
   * "current" long after it had scrolled mostly off-screen and a taller
   * section already occupied the middle of the reader's view.
   *
   * Scrolls Stock's own top edge to the viewport's top edge — reproducing
   * "the section at the top of the screen" exactly — and asserts the
   * highlighted item is whichever section the viewport's vertical centre
   * actually falls in, computed from the live layout rather than assumed,
   * so the test stays correct if a section's height changes later.
   */
  test("the highlight follows the section at the viewport's vertical centre, not its top", async ({
    page,
  }) => {
    const user = freshUser("sectioncentre");
    await signUp(page, user);
    await gotoApp(page, "/products/new");

    const nav = page.getByRole("navigation", { name: "Form sections" });
    await expect(nav).toBeVisible();

    await page.locator('[data-product-section="stock"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      document
        .querySelector('[data-product-section="stock"]')
        ?.scrollIntoView({ block: "start" });
    });

    const expectedId = await page.evaluate(() => {
      const centre = window.innerHeight / 2;
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>("[data-product-section]"),
      );
      const hit = sections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= centre && rect.bottom >= centre;
      });
      return hit?.dataset.productSection ?? null;
    });
    expect(expectedId, "a section spans the viewport's centre").not.toBeNull();

    // Stock itself is not the section the test is confirming (a form field
    // group is far shorter than half a 720px-tall viewport), which is what
    // makes this exercise the bug: the OLD logic would have shown Stock as
    // current here regardless of what the computed answer says.
    expect(expectedId).not.toBe("stock");

    await expect(nav.locator(`[data-product-form-nav-item="${expectedId}"]`)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(nav.locator('[data-product-form-nav-item="stock"]')).not.toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
