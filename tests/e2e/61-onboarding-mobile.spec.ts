import { devices, expect, test } from "@playwright/test";
import {
  expectSpotlightOn,
  expectTourStep,
  freshUser,
  openSellerStep,
  signUp,
  TOUR_LAYER,
  WELCOME_DIALOG,
} from "./helpers";

/**
 * The welcome flow on a phone, and its hand-over to the guided tour.
 *
 * Below `sm` the dialog is a bottom sheet, and its way out of everything ("Skip
 * onboarding") sits at the top of it. What can go wrong there is geometry: a
 * control pushed off the screen, a sheet wider than the phone. After the sheet,
 * the tour's first stop is the menu button, because on a phone the sidebar is
 * the same element slid off screen. Its own file because
 * `test.use(devices[...])` has to be top level, the same reason
 * 14-universal-search-mobile.spec.ts is separate.
 */

test.use({ ...devices["iPhone 13"] });

test.describe("onboarding on a phone", () => {
  test("the welcome sheet fits the screen, and hands over to the tour at the menu button", async ({
    page,
  }) => {
    await signUp(page, freshUser("welcome-phone"), { welcome: "keep" });
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toBeVisible({
      timeout: 20_000,
    });
    const dialog = page.getByRole("dialog");
    const viewport = page.viewportSize()!;

    async function expectOnScreen(name: string) {
      const box = await dialog.getByRole("button", { name }).boundingBox();
      expect(box, `${name} is laid out`).not.toBeNull();
      expect(box!.y, `${name} top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${name} bottom edge`).toBeLessThanOrEqual(
        viewport.height,
      );
      expect(box!.x + box!.width, `${name} right edge`).toBeLessThanOrEqual(
        viewport.width,
      );
    }

    await expectOnScreen("Next");
    await expectOnScreen("Skip onboarding");

    await openSellerStep(page);
    await expectOnScreen("Save and continue");
    await expectOnScreen("Skip for now");
    await expectOnScreen("Skip onboarding");

    await dialog.getByRole("button", { name: "Skip for now" }).click();

    // The tour's first stop on a phone is the menu button, not the off-screen rail.
    await expectTourStep(page, "overview-nav");
    await expectSpotlightOn(page, page.locator('header button[aria-label="Open menu"]'));
    const card = page.locator(TOUR_LAYER).getByRole("dialog");
    await expect(card).toContainText("Everything in your store is behind this menu.");
    const cardBox = (await card.boundingBox())!;
    // Against the tour's OWN full-viewport fixed layer, not window.innerWidth
    // or documentElement.clientWidth: this app styles its scrollbars into a
    // classic (non-overlay) one, which Chromium excludes from a `position:
    // fixed` element's containing block without either DOM metric reflecting
    // it, so neither is a trustworthy "full width" to compare against. The
    // catcher is `position: fixed` too, so it renders exactly as narrow.
    const catcherBox = (await page.locator("[data-tour-catcher]").boundingBox())!;
    expect(cardBox.x).toBeLessThanOrEqual(1);
    expect(cardBox.width).toBeGreaterThanOrEqual(catcherBox.width - 2);
    expect(Math.abs(cardBox.y + cardBox.height - viewport.height)).toBeLessThanOrEqual(2);
    const next = await card.getByRole("button", { name: "Next" }).boundingBox();
    expect(next!.y + next!.height).toBeLessThanOrEqual(viewport.height);

    // Nothing in the sheet or the card pushes the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
