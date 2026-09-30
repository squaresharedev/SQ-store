import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { scrollAndProbe } from "./action-coverage";

/**
 * THE BUYER'S PAGES ON A PHONE NEVER HIDE THEIR ONE ACTION: the product page's
 * Buy and the checkout's Pay, on the real routes, with the bar pinned to the
 * foot of the screen (`fixed`, the window scrolling). Each page is scrolled
 * top to bottom in small steps at several phone widths, and every Buy or Pay
 * button on screen is probed at every stop (see action-coverage.ts): nothing
 * may be painted over it, and a pinned button may never be cut by the edge of
 * the screen. Its twin for the editor's phone view is 80-phone-action-harness.
 *
 * The checkout half NEEDS the stack started with CHECKOUT_TEST_PAYMENTS=1
 * (see 78-checkout.spec.ts) and skips without it; the product page half runs
 * on any stack.
 */

const SIZE_GROUP = "7c000000-0000-4000-8000-000000000001";
const SMALL = "7c000000-0000-4000-8000-000000000002";
const LARGE = "7c000000-0000-4000-8000-000000000003";

/** Long enough that every page scrolls well past a phone's height. */
const DESCRIPTION = Array.from(
  { length: 6 },
  () => "Thrown on the wheel in small batches and glazed by hand, so no two are quite alike.",
).join("\n\n");

type Seeded = { storefrontId: string; vase: string };

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: "Home living" });
  await seedStorefronts(sellerId, [{ name: "Home living" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    {
      title: "Handmade oak dining table with a very long name",
      description: DESCRIPTION,
      price_cents: 74500,
      max_per_order: 3,
      option_groups: [
        {
          id: SIZE_GROUP,
          name: "Size",
          display: "chip",
          options: [
            { id: SMALL, name: "Four seater", available: true },
            { id: LARGE, name: "Six seater", available: true },
          ],
        },
      ],
    },
  ]);
  const [{ id: vase }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: {
          background: { kind: "solid", color: "#ffffff" },
          accent: "#171717",
          font: "sans",
          columns: 6,
          rows: 6,
          cornerRadius: 0,
          titleStyle: "bar",
          titleDisplay: "always",
          priceDisplay: "always",
          priceTagPosition: "below",
          showTitle: true,
          gridGap: 8,
          soldOutBadge: true,
          hideSoldOut: false,
        },
        blocks: [{ type: "product", productId: vase, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "CZ",
        ratesCurrency: "EUR",
        destinations: [{ area: "Czechia", time: "2-4 days", countries: ["CZ"], rateCents: 0 }],
        returnsWindowDays: 0,
        returnsNotes: "Custom pieces can not be returned unless they have a defect.",
      },
    },
  });
  return { storefrontId, vase };
}

for (const width of [360, 390, 430]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test("the product page's Buy button is never covered", async ({ page }) => {
      const s = await seed(page, `phone-buy-${width}`);
      await page.goto(`/s/${s.storefrontId}/p/${s.vase}`);
      await expect(page.locator("[data-product-page='public']")).toBeVisible();
      expect(await scrollAndProbe(page)).toEqual([]);
    });

    test("the checkout's Pay button is never covered", async ({ page }) => {
      const s = await seed(page, `phone-pay-${width}`);
      const url = `/s/${s.storefrontId}/p/${s.vase}/checkout?o=${LARGE}&q=2`;
      const probe = await page.request.get(url, { maxRedirects: 0 });
      test.skip(probe.status() !== 200, "checkout not offered: start the stack with CHECKOUT_TEST_PAYMENTS=1");

      await page.goto(url);
      await expect(page.locator("[data-checkout-page='public']")).toBeVisible();
      expect(await scrollAndProbe(page)).toEqual([]);

      // The pinned bar is there while Pay is still below, and out of the way
      // (and out of the tab order) once Pay is on screen.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect(page.locator("[data-checkout-sticky]")).toHaveAttribute("data-sticky-bar", "shown");
      await page.locator("form [data-checkout-pay]").scrollIntoViewIfNeeded();
      await expect(page.locator("[data-checkout-sticky]")).toHaveAttribute("data-sticky-bar", "away");
      await expect(page.locator("[data-checkout-sticky] [data-checkout-pay]")).not.toBeFocused();
      await expect(page.locator("form [data-checkout-pay]")).toBeInViewport({ ratio: 1 });
    });
  });
}
