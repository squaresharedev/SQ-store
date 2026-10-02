import AxeBuilder from "@axe-core/playwright";
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

/**
 * THE CHECKOUT'S VISUAL PASS, end to end:
 *   - the checkout settings API offers confetti or nothing, and still loads a
 *     checkout saved with the settings that were retired (a surface texture,
 *     the light burst);
 *   - the buyer's checkout shows the version and the facts as pictures rather
 *     than sentences, with the words a buyer may want one tap away.
 *
 * The API half runs on any stack. The pages a buyer reaches NEED the stack
 * started with CHECKOUT_TEST_PAYMENTS=1 (see 78-checkout.spec.ts) and skip
 * without it.
 */

const COLOUR_GROUP = "7b000000-0000-4000-8000-000000000001";
const SAGE = "7b000000-0000-4000-8000-000000000002";
const SIZE_GROUP = "7b000000-0000-4000-8000-000000000003";
const SMALL = "7b000000-0000-4000-8000-000000000004";

const THEME = {
  background: { kind: "solid", color: "#f6f1e7" },
  accent: "#1f4d3a",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 12,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

type Seeded = { sellerId: string; storefrontId: string; vase: string };

/** Put these products on the seller's storefront, with an optional checkout
 *  design (stored as-is, so it can carry what an older version saved). */
async function placeOnStorefront(s: Seeded, productIds: string[], checkoutPage?: Record<string, unknown>) {
  await serviceRest(`/storefronts?id=eq.${s.storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        ...(checkoutPage ? { checkoutPage } : {}),
        blocks: productIds.map((productId, index) => ({ type: "product", productId, x: index * 2, y: 0, w: 2, h: 2 })),
      },
    },
  });
}

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: "Clay House" });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    {
      title: "Stoneware vase",
      price_cents: 2400,
      max_per_order: 5,
      option_groups: [
        {
          id: COLOUR_GROUP,
          name: "Colour",
          display: "swatch",
          options: [{ id: SAGE, name: "Sage", swatch: "#9caf88", available: true }],
        },
        {
          id: SIZE_GROUP,
          name: "Size",
          display: "chip",
          options: [{ id: SMALL, name: "Small", available: true }],
        },
      ],
    },
  ]);
  const [{ id: vase }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  const seeded = { sellerId, storefrontId, vase };
  await placeOnStorefront(seeded, [vase]);
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "IE",
        dispatch: "Packed and posted within 2 days",
        ratesCurrency: "EUR",
        freeOverCents: 8000,
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return seeded;
}

const api = (s: Seeded) => `/api/storefronts/${s.storefrontId}/checkout-page`;

test.describe("checkout visuals", () => {
  test("the checkout settings offer confetti or nothing, and a checkout saved with retired settings still loads", async ({
    page,
  }) => {
    const s = await seed(page, "retired-checkout");
    // As an earlier version saved it: a surface texture, and the light burst.
    await placeOnStorefront(s, [s.vase], {
      layout: "compact",
      giftMessage: true,
      texture: "dots",
      celebrate: "rays",
    });

    const read = await (await page.request.get(api(s))).json();
    // The seller's own choices survive; the retired ones read as today's.
    expect(read.checkoutPage).toEqual({
      layout: "compact",
      giftMessage: true,
      celebrate: "confetti",
      hasBackgroundImage: false,
    });
    expect(read.options).toEqual({ layouts: ["showcase", "compact"], celebrations: ["confetti", "none"] });
    expect(read.surface).not.toHaveProperty("texture");

    // Off is a real choice, and it saves.
    const off = await page.request.patch(api(s), { data: { celebrate: "none" } });
    expect(off.status()).toBe(200);
    expect((await off.json()).checkoutPage.celebrate).toBe("none");

    // Anything else is refused with the error envelope's machine code and fix.
    const refused = await page.request.patch(api(s), { data: { celebrate: "fireworks" } });
    expect(refused.status()).toBe(400);
    const { error } = await refused.json();
    expect(error.code).toBe("invalid_input");
    expect(error.fix).toBeTruthy();
  });

  test("the page photo is never reported as a key, can be cleared, and cannot be pointed at someone else's upload", async ({
    page,
  }) => {
    const s = await seed(page, "page-photo");
    const ownKey = `images/${s.sellerId}/00000000-0000-4000-8000-0000000000aa-bg.webp`;
    await placeOnStorefront(s, [s.vase], {
      layout: "showcase",
      giftMessage: false,
      celebrate: "confetti",
      backgroundImage: { key: ownKey },
    });

    const read = await (await page.request.get(api(s))).json();
    // The key stays on the server: a caller is told only that a photo is set.
    expect(read.checkoutPage).toEqual({ layout: "showcase", giftMessage: false, celebrate: "confetti", hasBackgroundImage: true });
    expect(JSON.stringify(read)).not.toContain(ownKey);

    // Pointing the page at an object some OTHER user uploaded is refused, and
    // the photo the seller already has is untouched.
    const foreign = "images/11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-0000000000bb-bg.webp";
    const refused = await page.request.patch(api(s), { data: { backgroundImage: { key: foreign } } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error.fix).toBeTruthy();
    expect((await (await page.request.get(api(s))).json()).checkoutPage.hasBackgroundImage).toBe(true);

    // A URL is not a photo.
    const url = await page.request.patch(api(s), { data: { backgroundImage: { key: "https://evil.example/x.png" } } });
    expect(url.status()).toBe(400);

    // Null is the way back to no photo.
    const cleared = await page.request.patch(api(s), { data: { backgroundImage: null } });
    expect(cleared.status()).toBe(200);
    expect((await cleared.json()).checkoutPage.hasBackgroundImage).toBe(false);
  });

  test("the buyer sees the version as swatches and the words one tap away", async ({ page }) => {
    const s = await seed(page, "checkout-buyer");
    const url = `/s/${s.storefrontId}/p/${s.vase}/checkout?o=${SAGE},${SMALL}&q=2`;
    const probe = await page.request.get(url, { maxRedirects: 0 });
    test.skip(probe.status() !== 200, "checkout not offered: start the stack with CHECKOUT_TEST_PAYMENTS=1");

    await page.goto(url);
    await expect(page.locator("[data-checkout-page='public']")).toBeVisible();

    // The version: a sage dot beside its name, a pill for the size,
    // and the group names still there for a screen reader.
    const version = page.locator("[data-checkout-version]");
    await expect(version.locator("[data-version-chip='swatch']")).toHaveCount(1);
    await expect(version.locator("[data-version-chip='text']")).toHaveCount(1);
    await expect(version).toContainText("Colour: Sage");
    // Two of it: the quantity sits on one row in the summary, with no second
    // "2 x €24 = €48" sum above the subtotal that already says it. (The photo
    // badge needs a photo, which this stack has no R2 to serve; the harness at
    // /dev/checkout?q=2 shows it.)
    const quantity = page.locator("[data-checkout-totals] [data-product-quantity]");
    await expect(quantity).toHaveAttribute("data-product-quantity", "2");
    await expect(page.locator("[data-checkout-totals] [data-product-line-total]")).toHaveCount(0);

    // €48 of €80: the nudge says how far free delivery is.
    await expect(page.locator("[data-checkout-free-gap]")).toHaveAttribute("data-checkout-free-gap", "3200");
    await expect(page.locator("[data-checkout-free-gap]")).toContainText("€32.00 away from free delivery");

    // The email's reason is folded behind an (i), described either way.
    const hint = page.getByText("For your receipt and updates about this order.");
    await expect(hint).toHaveClass(/sr-only/);
    await page.getByRole("button", { name: "Why we ask" }).first().click();
    await expect(hint).not.toHaveClass(/sr-only/);

    // Who is selling is in plain sight; the rights and the privacy notice open.
    const legal = page.locator("[data-checkout-legal]");
    await expect(legal.getByText("Sold by Clay House, Ireland")).toBeVisible();
    const privacy = legal.locator("[data-checkout-legal-row='privacy']");
    await expect(privacy.getByText(/uses your name, delivery address and email/)).toBeHidden();
    await privacy.locator("summary").click();
    await expect(privacy.getByText(/uses your name, delivery address and email/)).toBeVisible();

    // The facts under the pay button, as badges.
    await expect(page.locator("form [data-product-trust='badges']")).toContainText("Packed and posted within 2 days");

    const violations = (
      await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations;
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
});
