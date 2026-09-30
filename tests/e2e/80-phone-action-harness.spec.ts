import { expect, test } from "@playwright/test";
import { scrollAndProbe } from "./action-coverage";

/**
 * THE PAY BUTTON IS NEVER HIDDEN ON A PHONE: the checkout as the EDITOR draws
 * it at phone width, inside a phone-height window it scrolls in, which is
 * where a bar pinned to the bottom used to float over the form's own Pay
 * button (the page kept both, and the bar won). Scrolled top to bottom in
 * small steps at three phone widths, for a parcel and for a download, with
 * every Pay button on screen probed at every stop (see action-coverage.ts).
 *
 * HARNESS ONLY, no sign-up: /dev/checkout needs no account and no database, so
 * this file is safe to run against a plain `next dev` as well as the stack.
 * The buyer's page (the real route, fixed bar, window scroll) is covered by
 * 81-phone-action-pages.spec.ts.
 */

const FRAME = "[data-dev-checkout-frame='scroll']";

for (const width of [360, 390, 430]) {
  for (const kind of ["parcel", "digital"] as const) {
    test(`the editor's phone checkout never hides Pay (${width}px, ${kind})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`/dev/checkout?w=${width}&scroll=1&q=2${kind === "digital" ? "&kind=digital" : ""}`);
      await expect(page.locator(`${FRAME} [data-checkout-page='preview']`)).toBeVisible();
      // The frame really does scroll: the page is taller than the phone.
      expect(
        await page.locator(FRAME).evaluate((el) => el.scrollHeight > el.clientHeight + 200),
      ).toBe(true);

      expect(await scrollAndProbe(page, { scroller: FRAME })).toEqual([]);

      // And the one action is reachable at all: at the bottom, Pay is on
      // screen, uncovered (the probe above), and it is the page's own button.
      await expect(page.locator(`${FRAME} form [data-checkout-pay]`)).toBeInViewport();
    });
  }
}
