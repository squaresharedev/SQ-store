import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  gotoApp,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * THE HOSTED STOREFRONT, /s/[storefrontId]: the board a seller designed, on a
 * page of its own.
 *
 *   - A buyer gets the board: live products as tiles that lead to their pages,
 *     the seller's words, and nothing that is not for sale (a draft has no
 *     tile). The product page's shop bar leads back.
 *   - Nothing seller-private rides along: no stock count reaches the browser.
 *   - It exists exactly when the storefront's product pages do: off, or with
 *     the seller's trader details incomplete, it is the buyer's 404.
 *   - A report from it is about the storefront.
 *   - The seller is handed the link where they share the storefront, and told
 *     what is in the way when there is none to hand.
 */

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

const PRODUCT_PAGE = {
  enabled: true,
  imageFit: "contain",
  ctaLabel: "Buy now",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: true,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map((id) => ({
    id,
    show: true,
  })),
};

/** A stock count that appears nowhere else in the fixture, so finding it in
 *  the page would mean the page was sent it. */
const SECRET_STOCK = 7391;

type Shop = { sellerId: string; storefrontId: string; store: string; vase: string; draft: string };

async function saveConfig(storefrontId: string, productPage: typeof PRODUCT_PAGE, vase: string, draft: string) {
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage,
        header: { show: true, name: "Clay House", bio: "Thrown by hand in Galway." },
        blocks: [
          { type: "product", productId: vase, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: draft, x: 2, y: 0, w: 2, h: 2 },
          {
            type: "text",
            id: "11111111-1111-4111-8111-111111111111",
            text: "New pieces every Friday",
            variant: "heading",
            align: "left",
            x: 0,
            y: 2,
            w: 4,
            h: 1,
          },
        ],
      },
    },
  });
}

/** A signed-in owner with a storefront holding a live vase, a draft bowl and
 *  a line of text, product pages on, trader details complete. */
async function seedShop(page: Page, tag: string): Promise<Shop> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const store = `Clay House ${user.email.split("@")[0]}`;
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: store });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    { title: "Stoneware vase", price_cents: 2400, track_stock: true, stock_quantity: SECRET_STOCK },
    { title: "Unfinished bowl", price_cents: 1800, status: "draft" },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const vase = products.find((product) => product.title === "Stoneware vase")!.id;
  const draft = products.find((product) => product.title === "Unfinished bowl")!.id;
  await saveConfig(storefrontId, PRODUCT_PAGE, vase, draft);
  return { sellerId, storefrontId, store, vase, draft };
}

const shopPath = (shop: Shop) => `/s/${shop.storefrontId}`;

test.describe("the hosted storefront", () => {
  test("a buyer gets the board: live tiles that lead to their pages, and the way back", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const shop = await seedShop(page, "shop-page");

    // As a stranger: no session, nothing of the seller's own view.
    const context = await browser.newContext();
    const buyer = await context.newPage();
    const response = await buyer.goto(shopPath(shop));
    expect(response?.status()).toBe(200);

    const board = buyer.locator(`[data-storefront-page='${shop.storefrontId}']`);
    await expect(board).toBeVisible();
    await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(shop.store);
    await expect(board).toContainText("Thrown by hand in Galway.");
    await expect(board).toContainText("New pieces every Friday");

    // One tile: the draft is not for sale, so it is not on show.
    const tiles = board.locator("[data-storefront-tile]");
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toContainText("Stoneware vase");
    await expect(board).not.toContainText("Unfinished bowl");
    await expect(tiles.first()).toHaveAttribute("href", `${shopPath(shop)}/p/${shop.vase}`);

    // Nothing seller-private was sent: not in the markup, not in the data the
    // page hydrates from.
    const html = await buyer.content();
    expect(html).not.toContain(String(SECRET_STOCK));
    expect(html).not.toContain(shop.draft);

    // A report from here is about the storefront, and the footer names the trader.
    await expect(buyer.locator("[data-report-trigger='storefront']")).toHaveText("Report this storefront");
    await expect(buyer.locator("[data-product-sale-disclosure]")).toContainText(shop.store);

    // The tile leads to the product, and the product's shop bar leads back.
    await tiles.first().click();
    await buyer.waitForURL((url) => url.pathname === `${shopPath(shop)}/p/${shop.vase}`);
    await expect(buyer.locator("[data-shop-link]")).toHaveAttribute("href", shopPath(shop));
    await buyer.locator("[data-shop-link]").click();
    await buyer.waitForURL((url) => url.pathname === shopPath(shop));

    // On a phone nothing runs off the side of the screen.
    await buyer.setViewportSize({ width: 390, height: 844 });
    await buyer.reload();
    await expect(board).toBeVisible();
    expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  });

  test("it exists exactly when the storefront's product pages do", async ({ page }) => {
    test.setTimeout(180_000);
    const shop = await seedShop(page, "shop-gate");
    const status = async () => (await page.request.get(shopPath(shop), { maxRedirects: 0 })).status();
    expect(await status()).toBe(200);

    // Product pages off: no shop page, and it says nothing about why.
    await saveConfig(shop.storefrontId, { ...PRODUCT_PAGE, enabled: false }, shop.vase, shop.draft);
    expect(await status()).toBe(404);
    await gotoApp(page, `/storefront/${shop.storefrontId}/embed`);
    await expect(page.locator("[data-storefront-link='pages-off']")).toContainText("Turn on product pages");
    await expect(page.locator("[data-storefront-link-url]")).toHaveCount(0);

    // Back on: the seller is handed the link, and it is the one that works.
    await saveConfig(shop.storefrontId, PRODUCT_PAGE, shop.vase, shop.draft);
    await page.reload();
    const link = page.locator("[data-storefront-link='live'] [data-storefront-link-url]");
    // Absolute, on whatever origin this deployment calls its own.
    const shown = (await link.textContent()) ?? "";
    expect(new URL(shown).pathname).toBe(shopPath(shop));
    expect(await status()).toBe(200);

    // A seller who no longer says who they are has no shop to show.
    await serviceRest(`/profiles?id=eq.${shop.sellerId}`, { method: "PATCH", body: { seller_address: null } });
    expect(await status()).toBe(404);
    await page.reload();
    await expect(page.locator("[data-storefront-link='details-missing']")).toBeVisible();

    // And an address that is not a storefront at all is the same 404.
    expect((await page.request.get("/s/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 })).status()).toBe(404);
  });
});
