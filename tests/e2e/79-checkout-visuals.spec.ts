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
 * THE CHECKOUT'S VISUAL PASS, end to end: a texture set through the settings
 * API (the route a future agent will call) reaches the buyer's checkout, and
 * the checkout shows the version and the facts as pictures rather than
 * sentences, with the words a buyer may want one tap away.
 *
 * The API half runs on any stack. The buyer half NEEDS the stack started with
 * CHECKOUT_TEST_PAYMENTS=1 (see 78-checkout.spec.ts) and skips without it.
 */

const COLOUR_GROUP = "7b000000-0000-4000-8000-000000000001";
const SAGE = "7b000000-0000-4000-8000-000000000002";
const SIZE_GROUP = "7b000000-0000-4000-8000-000000000003";
const SMALL = "7b000000-0000-4000-8000-000000000004";

type Seeded = { storefrontId: string; vase: string };

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
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: {
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
        },
        blocks: [{ type: "product", productId: vase, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });
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
  return { storefrontId, vase };
}

const api = (s: Seeded) => `/api/storefronts/${s.storefrontId}/checkout-page`;

test.describe("checkout visuals", () => {
  test("a texture set through the API is stored, reported, cleared, and refused when it is not a preset", async ({
    page,
  }) => {
    const s = await seed(page, "texture-api");

    const before = await (await page.request.get(api(s))).json();
    expect(before.surface.texture).toBeNull();
    expect(before.options.textures).toEqual(["paper", "dots", "grid", "lines", "linen"]);
    expect(before.options.layouts).toContain("compact");
    expect(before.options.celebrations).toContain("confetti");

    const set = await page.request.patch(api(s), { data: { texture: "linen" } });
    expect(set.status()).toBe(200);
    expect((await set.json()).surface.texture).toBe("linen");
    const [row] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
      config: { checkoutPage?: { texture?: string } };
    }[];
    expect(row.config.checkoutPage?.texture).toBe("linen");

    // Not a preset name, CSS least of all: refused, and nothing changes.
    for (const texture of ["none", "url(https://example.org/x.png)", "linear-gradient(red, blue)"]) {
      const refused = await page.request.patch(api(s), { data: { texture } });
      expect(refused.status(), texture).toBe(400);
      // The ActionError envelope: a machine code plus a readable next step.
      const { error } = await refused.json();
      expect(error.code).toBe("invalid_input");
      expect(error.fix).toBeTruthy();
    }
    expect((await (await page.request.get(api(s))).json()).surface.texture).toBe("linen");

    // null goes back to plain, and a checkout back at the defaults stores no
    // member at all.
    const cleared = await page.request.patch(api(s), { data: { texture: null } });
    expect((await cleared.json()).surface.texture).toBeNull();
    const [after] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
      config: { checkoutPage?: unknown };
    }[];
    expect(after.config.checkoutPage).toBeUndefined();
  });

  test("the buyer sees the texture, the version as swatches, and the words one tap away", async ({ page }) => {
    const s = await seed(page, "texture-buyer");
    await page.request.patch(api(s), { data: { texture: "dots" } });

    const url = `/s/${s.storefrontId}/p/${s.vase}/checkout?o=${SAGE},${SMALL}&q=2`;
    const probe = await page.request.get(url, { maxRedirects: 0 });
    test.skip(probe.status() !== 200, "checkout not offered: start the stack with CHECKOUT_TEST_PAYMENTS=1");

    await page.goto(url);
    const root = page.locator("[data-checkout-page='public']");
    await expect(root).toHaveAttribute("data-checkout-texture", "dots");
    expect(await root.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("radial-gradient");
    // The fields are filled, so the dots never run through what is typed.
    expect(await page.getByLabel("Email").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(246, 241, 231)",
    );

    // The version: a sage dot beside "Sage", a pill for the size, and the
    // group names still there for a screen reader.
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
    await page.getByRole("button", { name: "Why we ask" }).click();
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
