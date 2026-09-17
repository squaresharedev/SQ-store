import { devices, expect, test, type Page } from "@playwright/test";
import {
  expectTourStep,
  freshUser,
  gotoApp,
  seedStorefronts,
  signUp,
  TOUR_LAYER,
  tourButton,
  userIdByEmail,
} from "./helpers";

/**
 * The guided tour on a phone.
 *
 * The card is a full-width bottom card (or moves to the top when its control
 * is stuck at the bottom of a page), and the tour scrolls each control into the
 * band between the header and the card. What goes wrong on a phone is geometry,
 * so every stop checks it: the card on screen, the spotlit control visible and
 * not under the card, Next reachable, and no sideways scroll. Its own file
 * because `test.use(devices[...])` has to be top level.
 */

test.use({ ...devices["iPhone 13"] });

const STOPS = [
  "overview-nav",
  "search",
  "products-add",
  "products-import",
  "storefront-create",
  "storefront-sample",
  "storefront-embed",
  "orders-search",
  "orders-filters",
  "analytics",
  "payments",
  "finish",
];

async function geometry(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector("[data-tour-step]");
    const card = layer?.querySelector('[role="dialog"]');
    const spot = layer?.querySelector("[data-tour-spotlight]");
    const next = [...(card?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Next" || button.textContent?.trim() === "Done",
    );
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      card: box(card),
      edge: card?.getAttribute("data-edge"),
      next: box(next),
      ring: spot && {
        top: spot.getBoundingClientRect().top,
        height: spot.getBoundingClientRect().height,
        visible: spot.getAttribute("data-empty") !== "true",
      },
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

test.describe("guided tour on a phone", () => {
  test("every stop fits the screen, with its control in view and clear of the card", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = freshUser("tour-phone");
    await signUp(page, user);
    // A storefront, so the embed stop has a real card button to scroll to.
    await seedStorefronts(await userIdByEmail(user.email), [{ name: "Phone studio" }]);
    for (const path of ["/products", "/storefront", "/orders", "/analytics", "/payments", "/settings/account"]) {
      await gotoApp(page, path);
    }
    await gotoApp(page, "/dashboard?tour=1");

    for (const [index, id] of STOPS.entries()) {
      await expectTourStep(page, id, "anchored");
      // Let a smooth scroll and the card's placement land.
      await expect
        .poll(async () => {
          const first = await page.evaluate(() => scrollY);
          await page.waitForTimeout(250);
          return first === (await page.evaluate(() => scrollY));
        })
        .toBe(true);
      const g = await geometry(page);
      const { width, height } = g.viewport;

      expect(g.card, `${id}: card rendered`).not.toBeNull();
      expect(g.card!.left, `${id}: card left`).toBeGreaterThanOrEqual(-1);
      expect(g.card!.right, `${id}: card right`).toBeLessThanOrEqual(width + 1);
      expect(g.card!.top, `${id}: card top`).toBeGreaterThanOrEqual(-1);
      expect(g.card!.bottom, `${id}: card bottom`).toBeLessThanOrEqual(height + 1);
      expect(g.next, `${id}: Next or Done is there`).not.toBeNull();
      expect(g.next!.bottom, `${id}: Next reachable`).toBeLessThanOrEqual(height);
      expect(g.overflow, `${id}: no sideways scroll`).toBeLessThanOrEqual(0);

      expect(g.ring?.visible, `${id}: something is spotlit`).toBe(true);
      const holeTop = g.ring!.top;
      const holeBottom = g.ring!.top + g.ring!.height;
      if (g.edge === "top") {
        expect(holeTop, `${id}: control below a top card`).toBeGreaterThanOrEqual(g.card!.bottom - 2);
      } else if (id !== "overview-nav" && id !== "search") {
        // The header's own buttons sit above the card by construction.
        expect(holeBottom, `${id}: control above the card`).toBeLessThanOrEqual(g.card!.top + 8);
      }
      expect(holeTop, `${id}: control on screen`).toBeGreaterThanOrEqual(0);

      await expect(page.locator(TOUR_LAYER)).toHaveAttribute("data-tour-index", String(index + 1));
      if (index < STOPS.length - 1) await tourButton(page, "Next");
    }
    await tourButton(page, "Done");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });

  test("the sample storefront's designer tour fits a phone, clear of the toolbar", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signUp(page, freshUser("sample-phone"));
    await gotoApp(page, "/storefront/sample");

    const stops = ["editor-add", "editor-design", "editor-page", "editor-finish"];
    for (const [index, id] of stops.entries()) {
      await expectTourStep(page, id, "anchored");
      // The phone card's edge is decided once it has been placed.
      await expect(page.locator(`${TOUR_LAYER} [role="dialog"][data-placed="true"]`)).toHaveCount(1);
      const g = await geometry(page);
      const { width, height } = g.viewport;
      expect(g.card!.left, `${id}: card left`).toBeGreaterThanOrEqual(-1);
      expect(g.card!.right, `${id}: card right`).toBeLessThanOrEqual(width + 1);
      expect(g.card!.bottom, `${id}: card bottom`).toBeLessThanOrEqual(height + 1);
      expect(g.next!.bottom, `${id}: Next reachable`).toBeLessThanOrEqual(height);
      expect(g.overflow, `${id}: no sideways scroll`).toBeLessThanOrEqual(0);
      expect(g.ring?.visible, `${id}: something is spotlit`).toBe(true);
      const holeTop = g.ring!.top;
      const holeBottom = g.ring!.top + g.ring!.height;
      // The first three stops are on the bottom toolbar, so their card moves
      // to the top; the last is the header's button, above a bottom card.
      if (id === "editor-finish") {
        expect(g.edge, `${id}: card at the bottom`).toBe("bottom");
        expect(holeBottom, `${id}: control above the card`).toBeLessThanOrEqual(g.card!.top + 8);
      } else {
        expect(g.edge, `${id}: card at the top`).toBe("top");
        expect(holeTop, `${id}: control below the card`).toBeGreaterThanOrEqual(g.card!.bottom - 2);
      }
      await expect(page.locator(TOUR_LAYER)).toHaveAttribute("data-tour-index", String(index + 1));
      if (index < stops.length - 1) await tourButton(page, "Next");
    }
    await tourButton(page, "Done");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });
});
