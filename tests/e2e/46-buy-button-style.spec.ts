import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  expectToast,
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * THE BUY BUTTON, styled from the design panel and read back over its route.
 *
 * Three things are being checked, and they are the same three facts told
 * three ways — which is the point, because the button is the page's one
 * action and a seller, a buyer and an assistant must never be shown a
 * different one:
 *
 *   1. the panel's controls paint the artboard beside them, live;
 *   2. what was painted survives a save and a reload;
 *   3. GET/PATCH /api/storefronts/[id]/product-page answers with the same
 *      resolved values, and a `null` hands a field back to the storefront.
 *
 * The accent here is a colour NOTHING else in the fixture uses, so an
 * assertion that the button is filled with it cannot pass by accident.
 */

const ACCENT = "#1d4ed8";

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: ACCENT,
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 4,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

async function seed(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  // A purchase link, so the button has somewhere to go and paints for real.
  // With no destination the editor deliberately draws a ghost outline in the
  // PAGE's ink instead (ProductCta), which is a different thing being tested.
  await seedProducts(sellerId, [
    { title: "Oak lamp", price_cents: 12900, purchase_url: "https://example.com/oak-lamp" },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const lamp = products.find((p) => p.title === "Oak lamp")!.id;

  // The trader details the publish gate requires: without them the hosted
  // product page this spec opens would 404 rather than render.
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [{ type: "product", productId: lamp, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });

  return { storefrontId, lamp };
}

/** Open the product page artboard for the seeded lamp. */
async function openPage(page: Page, storefrontId: string, lamp: string) {
  await gotoApp(page, `/storefront/${storefrontId}`);
  await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();
  // Selecting the tile is what brings its page node within reach. The tile is
  // a focusable container rather than a button (nested controls hang off it),
  // so it answers to its label, not to a role.
  await page.getByLabel(/^oak lamp\. press enter/i).click();
  await canvasStill(page);
  await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
  const artboard = page.locator(`[data-artboard-id="${lamp}"]`);
  await expect(artboard).toBeVisible();
  return artboard;
}

test.describe("styling the buy button", () => {
  test("paints the artboard, survives a save, and reads back over the route", async ({ page }) => {
    const s = await seed(page, "cta-style");
    const artboard = await openPage(page, s.storefrontId, s.lamp);
    const cta = artboard.locator("[data-product-cta]").first();

    // ---- FOLLOWING THE STOREFRONT ---------------------------------------
    // Nothing stored, so the button is the theme's accent, the tiles' own
    // roundness, and no border. This is the state every storefront starts in
    // and the one a seller can always get back to.
    await expect(cta).toHaveAttribute("data-cta-fill", ACCENT);
    await expect(cta).toHaveAttribute("data-cta-radius", "4");
    await expect(cta).toHaveAttribute("data-cta-border-width", "0");

    // ---- STYLING IT ------------------------------------------------------
    await page.getByRole("button", { name: /^buy button$/i }).click();
    const swatches = page.getByRole("group", { name: "Button color swatches" });
    await expect(swatches).toBeVisible();
    // A fill of its own: the accent runs through the whole storefront, and the
    // button that closes the sale is allowed not to be it. Scoped to this
    // field's row: the page's own background offers the same preset dots.
    await swatches.getByRole("button", { name: "Ink (#171717)" }).click();
    await expect(cta).toHaveAttribute("data-cta-fill", "#171717");

    // Roundness and a border, both by keyboard so the value is exact.
    const roundness = page.getByRole("slider", { name: "Buy button corner roundness" });
    await roundness.focus();
    await page.keyboard.press("ArrowRight");
    await expect(cta).toHaveAttribute("data-cta-radius", "5");

    const thickness = page.getByRole("slider", { name: "Buy button border thickness" });
    await thickness.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(cta).toHaveAttribute("data-cta-border-width", "2");
    // The border's colour only appears once there is a border to colour, and
    // starts as the label's own ink rather than as a second unmade decision.
    await expect(cta).toHaveAttribute("data-cta-border-color", "#ffffff");
    await expect(page.getByRole("button", { name: "Use Button text color" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // ---- SAVED, NOT JUST PAINTED ----------------------------------------
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();
    await page.getByRole("button", { name: /^show the product page$/i }).click();
    const saved = page.locator(`[data-artboard-id="${s.lamp}"] [data-product-cta]`).first();
    await expect(saved).toHaveAttribute("data-cta-fill", "#171717");
    await expect(saved).toHaveAttribute("data-cta-radius", "5");
    await expect(saved).toHaveAttribute("data-cta-border-width", "2");

    // ---- THE ROUTE TELLS THE SAME STORY ---------------------------------
    // Same session, same account scoping, no Server Action id in sight: this
    // is the shape an agent will hold once the token layer lands (B1/B2).
    const url = `/api/storefronts/${s.storefrontId}/product-page`;
    const read = await page.request.get(url);
    expect(read.status()).toBe(200);
    const body = (await read.json()) as {
      productPage: { ctaColor?: string; ctaRadius?: number };
      buyButton: { fill: string; text: string; radius: number; borderWidth: number };
      limits: { ctaRadiusMax: number };
    };
    expect(body.productPage.ctaColor).toBe("#171717");
    expect(body.buyButton).toMatchObject({
      fill: "#171717",
      // Derived from the fill, never stored: dark button, light words.
      text: "#ffffff",
      radius: 5,
      borderWidth: 2,
    });

    // A write through the route, and `null` is how a field goes back to
    // following the storefront — the one thing a plain merge cannot say.
    const patched = await page.request.patch(url, {
      data: { ctaColor: null, ctaLabel: "Order now" },
    });
    expect(patched.status()).toBe(200);
    const after = (await patched.json()) as {
      productPage: { ctaLabel: string; ctaColor?: string };
      buyButton: { fill: string };
    };
    expect(after.productPage.ctaLabel).toBe("Order now");
    expect(after.productPage.ctaColor).toBeUndefined();
    expect(after.buyButton.fill).toBe(ACCENT);

    // Out of bounds is refused by the same schema the designer saves through,
    // and the refusal names a next step rather than just failing.
    const refused = await page.request.patch(url, { data: { ctaRadius: 999 } });
    expect(refused.status()).toBe(400);
    const error = (await refused.json()) as { error: { code: string; fix: string } };
    expect(error.error.code).toBe("invalid_input");
    expect(error.error.fix).toBeTruthy();

    // And the seller's own editor shows what the route wrote.
    await page.reload();
    await page.getByRole("button", { name: /^show the product page$/i }).click();
    const reread = page.locator(`[data-artboard-id="${s.lamp}"] [data-product-cta]`).first();
    await expect(reread).toHaveAttribute("data-cta-fill", ACCENT);
    await expect(reread.getByText("Order now")).toBeVisible();

    // ---- AND SO DOES THE BUYER ------------------------------------------
    // The whole point of the artboard is that it is the buyer's page. With no
    // session at all, the hosted page paints the same button, down to the
    // border the route never touched.
    await page.context().clearCookies();
    await page.goto(`/s/${s.storefrontId}/p/${s.lamp}`);
    const live = page.locator("[data-product-cta]").first();
    await expect(live).toHaveAttribute("data-cta-fill", ACCENT);
    await expect(live).toHaveAttribute("data-cta-radius", "5");
    await expect(live).toHaveAttribute("data-cta-border-width", "2");
    await expect(page.getByRole("link", { name: /order now/i }).first()).toBeVisible();
  });

  test("each part of the button answers to its own name in the panel's search", async ({
    page,
  }) => {
    const s = await seed(page, "cta-search");
    await openPage(page, s.storefrontId, s.lamp);

    // Back to the root menu, where the search field lives.
    await page.getByRole("button", { name: /^back to all settings/i }).first().click();
    await canvasStill(page);
    const field = page.getByRole("combobox", { name: "Find a setting or object" });

    // A seller does not search for the panel section a control happens to sit
    // in; they search for the thing they want to change. Each of these is a
    // row of its own, exactly as the four Card style controls are.
    for (const [query, expected] of [
      ["button colour", "Buy button colour"],
      ["rounded button", "Buy button roundness"],
      ["button outline", "Buy button border"],
    ] as const) {
      await field.fill("");
      await field.fill(query);
      const rows = page.getByRole("option");
      await expect(async () => {
        expect(await rows.count()).toBeGreaterThan(0);
      }).toPass({ timeout: 5_000 });
      expect((await rows.allInnerTexts()).join(" | "), query).toContain(expected);
    }

    // And picking one opens the controls it named. (The border's COLOUR is
    // not among them yet: it only appears once there is a border to colour.)
    await page.getByRole("option").first().click();
    await expect(
      page.getByRole("slider", { name: "Buy button border thickness" }),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "Border color swatches" })).toHaveCount(0);
  });
});
