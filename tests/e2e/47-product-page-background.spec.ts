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
 * THE PRODUCT PAGE'S OWN BACKDROP.
 *
 * The page has always sat on the storefront's background, and for most stores
 * that is still right. What this covers is the seller who needs it not to be:
 * a shop on a deep green board whose specification table has to be read on
 * white. Three things have to hold for that to be safe to offer:
 *
 *   1. following the storefront is still the default, and reachable again;
 *   2. the page's INK follows the backdrop it ends up on, so a dark colour
 *      cannot leave dark words on it;
 *   3. what the seller sees on the artboard is what a buyer with no session
 *      gets on the hosted page.
 *
 * The storefront here is deliberately DARK, so "the page followed the store"
 * and "the page took its own colour" cannot look the same.
 */

const STORE_BG = "#0b3d2e";

const THEME = {
  background: { kind: "solid", color: STORE_BG },
  accent: "#1d4ed8",
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

async function openPage(page: Page, storefrontId: string, lamp: string) {
  await gotoApp(page, `/storefront/${storefrontId}`);
  await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();
  await page.getByLabel(/^oak lamp\. press enter/i).click();
  await canvasStill(page);
  await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
  const artboard = page.locator(`[data-artboard-id="${lamp}"]`);
  await expect(artboard).toBeVisible();
  return artboard;
}

test.describe("the product page's background", () => {
  test("follows the storefront, takes a colour of its own, and goes back", async ({ page }) => {
    const s = await seed(page, "pdp-bg");
    const artboard = await openPage(page, s.storefrontId, s.lamp);
    const surface = artboard.locator("[data-product-page]");

    // ---- FOLLOWING THE STOREFRONT ---------------------------------------
    // The shipped state, and the one every existing storefront is in: no
    // colour of its own, and light words because the store is dark.
    await expect(surface).toHaveAttribute("data-page-background", "storefront");
    await expect(surface).toHaveAttribute("data-page-ink", "#ffffff");

    // ---- A COLOUR OF ITS OWN --------------------------------------------
    const swatches = page.getByRole("group", { name: "Page color swatches" });
    await expect(swatches).toBeVisible();
    await swatches.getByRole("button", { name: "White (#ffffff)" }).click();
    await expect(surface).toHaveAttribute("data-page-background", "#ffffff");
    // THE INK FOLLOWED IT. This is what makes the control safe to offer: the
    // seller picked a backdrop, and the words turned dark on their own.
    await expect(surface).toHaveAttribute("data-page-ink", "#171717");

    // ---- SAVED, AND WHAT THE BUYER GETS ---------------------------------
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);

    const read = await page.request.get(`/api/storefronts/${s.storefrontId}/product-page`);
    expect(read.status()).toBe(200);
    const body = (await read.json()) as {
      productPage: { backgroundColor?: string };
      background: { color: string | null; followsStorefront: boolean; ink: string };
    };
    expect(body.productPage.backgroundColor).toBe("#ffffff");
    expect(body.background).toEqual({
      color: "#ffffff",
      followsStorefront: false,
      ink: "#171717",
    });

    await page.context().clearCookies();
    await page.goto(`/s/${s.storefrontId}/p/${s.lamp}`);
    const live = page.locator("[data-product-page]");
    await expect(live).toHaveAttribute("data-page-background", "#ffffff");
    await expect(live).toHaveAttribute("data-page-ink", "#171717");
    // The colour REPLACES the store's background rather than tinting it, so
    // nothing of the dark store shows through the page the seller chose.
    await expect(live).toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("hands the backdrop back to the storefront, and is findable by name", async ({ page }) => {
    const s = await seed(page, "pdp-bg-back");
    const artboard = await openPage(page, s.storefrontId, s.lamp);
    const surface = artboard.locator("[data-product-page]");

    // Search finds the control by what a seller would call it, not by the
    // panel section it happens to live in.
    await page.getByRole("button", { name: /^back to all settings/i }).first().click();
    await canvasStill(page);
    const field = page.getByRole("combobox", { name: "Find a setting or object" });
    await field.fill("page background");
    const rows = page.getByRole("option");
    await expect(async () => {
      expect(await rows.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 5_000 });
    expect((await rows.allInnerTexts()).join(" | ")).toContain("Product page background");
    await rows.first().click();

    // Take a colour, then hand it straight back: the inherit dot is the way
    // out, and it drops the stored value rather than writing the store's
    // colour into the page (which would freeze the page if the store changed).
    const swatches = page.getByRole("group", { name: "Page color swatches" });
    await swatches.getByRole("button", { name: "White (#ffffff)" }).click();
    await expect(surface).toHaveAttribute("data-page-background", "#ffffff");

    await page.getByRole("button", { name: "Use Storefront background" }).click();
    await expect(surface).toHaveAttribute("data-page-background", "storefront");
    await expect(surface).toHaveAttribute("data-page-ink", "#ffffff");

    // Nothing was stored, so a save writes no product page member at all and
    // the hosted page is back on the store's own dark background.
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    const read = await page.request.get(`/api/storefronts/${s.storefrontId}/product-page`);
    const body = (await read.json()) as {
      background: { color: string | null; followsStorefront: boolean };
    };
    expect(body.background).toMatchObject({ color: null, followsStorefront: true });

    await page.context().clearCookies();
    await page.goto(`/s/${s.storefrontId}/p/${s.lamp}`);
    await expect(page.locator("[data-product-page]")).toHaveCSS(
      "background-color",
      "rgb(11, 61, 46)",
    );
  });
});
