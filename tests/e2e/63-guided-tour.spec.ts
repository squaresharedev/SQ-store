import { expect, test } from "@playwright/test";
import {
  expectSpotlightOn,
  expectTourStep,
  freshUser,
  gotoApp,
  openSellerStep,
  seedStorefronts,
  serviceRest,
  signUp,
  TOUR_LAYER,
  tourButton,
  userIdByEmail,
  WELCOME_DIALOG,
} from "./helpers";

/**
 * THE GUIDED TOUR, end to end on desktop: one real control at a time, across
 * the pages, for a brand-new seller.
 *
 * Every stop is checked against the page it claims to be on and the control it
 * claims to spotlight (the cut-out is measured against that control's box), so
 * a renamed label or a moved button fails here rather than turning a stop into
 * its unspotlit fallback without anyone noticing. Also: the Orders toolbar that
 * only appears for the tour, how the tour ends (Esc, Back, the last card's
 * offer), a refresh mid-way, and the embed stop once a storefront exists.
 */

type Stop = {
  id: string;
  path: RegExp;
  state?: "anchored" | "fallback";
  /** The control the stop must spotlight; omitted for a fallback. */
  target?: string;
};

/** A new seller's tour: no storefront of their own (so the sample stop points
 *  at the sample's link, and the embed stop, with no card to point at, falls
 *  back to its snippet), no orders. */
const NEW_SELLER_STOPS: Stop[] = [
  { id: "overview-nav", path: /\/dashboard$/, target: 'nav[aria-label="Dashboard"]' },
  { id: "search", path: /\/dashboard$/, target: '[data-testid="top-bar"] button[aria-keyshortcuts]' },
  { id: "products-add", path: /\/products$/, target: 'main a[href="/products/new"] >> nth=0' },
  { id: "products-import", path: /\/products$/, target: 'main a[href="/products/import"]' },
  { id: "storefront-create", path: /\/storefront$/, target: '[data-tour="storefront-create"] >> nth=0' },
  { id: "storefront-sample", path: /\/storefront$/, target: "main [data-storefront-sample]" },
  { id: "storefront-embed", path: /\/storefront$/, state: "fallback" },
  { id: "orders-search", path: /\/orders$/, target: '[data-tour="orders-search"]' },
  { id: "orders-filters", path: /\/orders$/, target: '[role="search"][aria-label="order filters"]' },
  { id: "analytics", path: /\/analytics$/, target: "[data-analytics-first-run] > div" },
  { id: "payments", path: /\/payments$/, target: 'section[aria-label="Stripe connection"]' },
  { id: "finish", path: /\/settings\/account$/, target: "#tour" },
];

/** Dev compiles each page on first visit; walking a cold stack would spend the
 *  tour's patience on the compiler instead of on the tour. */
async function warm(page: import("@playwright/test").Page) {
  for (const path of ["/products", "/storefront", "/orders", "/analytics", "/payments", "/settings/account"]) {
    await gotoApp(page, path);
  }
}

test.describe("guided tour", () => {
  test("a new seller is walked through every page, one control at a time", async ({ page }) => {
    test.setTimeout(240_000);
    await signUp(page, freshUser("tour-walk"), { welcome: "keep" });
    await warm(page);

    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toBeVisible({
      timeout: 20_000,
    });
    await openSellerStep(page);
    await page.getByRole("dialog").getByRole("button", { name: "Skip for now" }).click();

    for (const [index, stop] of NEW_SELLER_STOPS.entries()) {
      await expectTourStep(page, stop.id, stop.state ?? "anchored");
      await expect(page, stop.id).toHaveURL(stop.path);
      const layer = page.locator(TOUR_LAYER);
      await expect(layer).toHaveAttribute("data-tour-index", String(index + 1));
      await expect(layer).toHaveAttribute("data-tour-total", String(NEW_SELLER_STOPS.length));
      if (stop.target) await expectSpotlightOn(page, page.locator(stop.target));

      if (stop.id === "storefront-sample") {
        await expect(layer).toContainText("Nothing you change there is saved");
      }
      if (stop.id === "storefront-embed") {
        // No storefront of their own and no card to point at: the fallback,
        // still with the snippet.
        await expect(layer).toContainText("Once you have a storefront");
        await expect(layer).toContainText("data-squareshare-storefront");
      }
      if (stop.id === "orders-search") {
        // A new seller has no orders, and the toolbar is shown just for the tour.
        await expect(page.locator('[role="search"][aria-label="order filters"]')).toHaveCount(1);
      }
      if (stop.id === "payments") {
        await expect(layer).toContainText("coming soon");
      }
      if (index < NEW_SELLER_STOPS.length - 1) await tourButton(page, "Next");
    }

    // The last card offers the next setup step: the details they skipped.
    await tourButton(page, "Add your seller details");
    await page.waitForURL(/\/settings\/tax/, { timeout: 30_000 });
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    // With the tour gone, an account with no orders shows no toolbar again.
    await gotoApp(page, "/orders");
    await expect(page.getByText("No orders yet")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[role="search"][aria-label="order filters"]')).toHaveCount(0);
  });

  test("Esc leaves the tour where it is, for good", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, freshUser("tour-esc"));
    await warm(page);
    await gotoApp(page, "/dashboard?tour=1");

    await expectTourStep(page, "overview-nav");
    await tourButton(page, "Next");
    await expectTourStep(page, "search");
    await tourButton(page, "Next");
    await expectTourStep(page, "products-add");

    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
    await expect(page).toHaveURL(/\/products$/);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });

  test("a refresh picks the tour up where it was, and going Back ends it", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, freshUser("tour-refresh"));
    await warm(page);
    await gotoApp(page, "/dashboard?tour=1");

    await expectTourStep(page, "overview-nav");
    await tourButton(page, "Next");
    await expectTourStep(page, "search");
    await tourButton(page, "Next");
    await expectTourStep(page, "products-add");
    await tourButton(page, "Next");
    await expectTourStep(page, "products-import");

    await page.reload();
    await expectTourStep(page, "products-import");
    await expectSpotlightOn(page, page.locator('main a[href="/products/import"]'));

    // Back is the person choosing to leave the page the tour put them on.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });

  test("with a storefront of their own, the embed stop points at its card, not the sample's", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const user = freshUser("tour-embed");
    await signUp(page, user);
    await seedStorefronts(await userIdByEmail(user.email), [{ name: "Tour studio" }]);
    await warm(page);
    await gotoApp(page, "/dashboard?tour=1");

    for (const id of [
      "overview-nav",
      "search",
      "products-add",
      "products-import",
      "storefront-create",
      "storefront-sample",
    ]) {
      await expectTourStep(page, id);
      await tourButton(page, "Next");
    }
    await expectTourStep(page, "storefront-embed", "anchored");
    await expectSpotlightOn(page, page.locator('main button[aria-label="Embed Tour studio"]'));
    const layer = page.locator(TOUR_LAYER);
    await expect(layer).toContainText("This button gives you a snippet");
    await expect(layer).toContainText("still in development");

    // Back walks the same page without a navigation, to the sample's link
    // after their own card.
    await tourButton(page, "Back");
    await expectTourStep(page, "storefront-sample");
    await expectSpotlightOn(page, page.locator("main [data-storefront-sample]"));
    await expect(page).toHaveURL(/\/storefront$/);
  });

  test("with the sample hidden, its stop falls back to what the page is for", async ({ page }) => {
    test.setTimeout(150_000);
    const user = freshUser("tour-sample-hidden");
    await signUp(page, user);
    await serviceRest(`/profiles?id=eq.${await userIdByEmail(user.email)}`, {
      method: "PATCH",
      body: { sample_storefront_hidden_at: new Date().toISOString() },
    });
    await warm(page);
    await gotoApp(page, "/dashboard?tour=1");

    for (const id of ["overview-nav", "search", "products-add", "products-import", "storefront-create"]) {
      await expectTourStep(page, id);
      await tourButton(page, "Next");
    }
    await expectTourStep(page, "storefront-sample", "fallback");
    await expect(page.locator(TOUR_LAYER)).toContainText("Open a storefront to design it.");
    await tourButton(page, "Next");
    // Nothing of their own and no sample: the embed stop falls back too.
    await expectTourStep(page, "storefront-embed", "fallback");
    await expect(page.locator(TOUR_LAYER)).toContainText("Once you have a storefront");
  });
});
