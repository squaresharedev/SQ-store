import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  expectToast,
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
 * THE SHOPPING CART, end to end, with the development TEST provider.
 *
 * A buyer fills a cart from the seller's board (cards that add in one press)
 * and from a product page (a version chosen there), changes a quantity in the
 * cart, and pays once for a parcel, a second parcel and a download together.
 * The order holds every line, each one's stock came off, the cart is closed,
 * and the seller's "Added to cart" figure counted the adds. Then the seller
 * refunds ONE line and the rest of the order stands; the buyer's page says
 * which line went back. Then what the cart routes must refuse, however a
 * request is built, and the seller's switch that turns card adds off.
 *
 * Runs under `pnpm test:e2e:checkout` (CHECKOUT_TEST_PAYMENTS=1); skips without it.
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
  // The card's buy button: where a card's "Add to cart" lives.
  buyButton: "solid",
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
};

const SET_GROUP = "7c000000-0000-4000-8000-000000000001";
const SET_TWO = "7c000000-0000-4000-8000-000000000002";
const SET_FOUR = "7c000000-0000-4000-8000-000000000003";

type Seeded = {
  sellerId: string;
  storefrontId: string;
  vase: string;
  mug: string;
  coasters: string;
  zine: string;
};

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: `Clay House ${tag}` });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    { title: "Stoneware vase", price_cents: 2400, track_stock: true, stock_quantity: 9 },
    { title: "Mug", price_cents: 1200, track_stock: true, stock_quantity: 5 },
    {
      title: "Oak coasters",
      price_cents: 1800,
      option_groups: [
        {
          id: SET_GROUP,
          name: "Set",
          display: "chip",
          options: [
            { id: SET_TWO, name: "Two", available: true },
            { id: SET_FOUR, name: "Four", available: true },
          ],
        },
      ],
    },
    {
      title: "Glaze zine",
      price_cents: 800,
      digital_file_key: `files/${sellerId}/${sellerId.slice(0, 8)}-0000-4000-8000-000000000009-glaze-zine.pdf`,
    },
  ]);
  const rows = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const id = (title: string) => rows.find((row) => row.title === title)!.id;
  const products = { vase: id("Stoneware vase"), mug: id("Mug"), coasters: id("Oak coasters"), zine: id("Glaze zine") };

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [
          { type: "product", productId: products.mug, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: products.coasters, x: 2, y: 0, w: 2, h: 2 },
          { type: "product", productId: products.zine, x: 4, y: 0, w: 2, h: 2 },
          { type: "product", productId: products.vase, x: 0, y: 2, w: 2, h: 2 },
        ],
      },
    },
  });
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "IE",
        ratesCurrency: "EUR",
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return { sellerId, storefrontId, ...products };
}

/**
 * Whether this run can check out at all. Skipped only when the switch is off
 * (a plain `playwright test`). With it on, a storefront without a cart is a
 * FAILURE: a skip there would report a stack that cannot sell as green.
 */
async function cartOffered(page: Page, s: Seeded): Promise<boolean> {
  if (process.env.CHECKOUT_TEST_PAYMENTS !== "1") return false;
  await page.goto(`/s/${s.storefrontId}`);
  await expect(page.locator("[data-cart-button]"), "the cart should be offered with the switch on").toBeVisible();
  return true;
}

const drawer = (page: Page) => page.getByRole("dialog", { name: "Your cart" });

async function closeDrawer(page: Page) {
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
}

async function fillAddress(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Aoife Byrne");
  await page.getByLabel("Address", { exact: true }).fill("12 Harbour Road");
  await page.getByLabel("Town or city").fill("Galway");
  await page.getByLabel("Postcode").fill("H91 X2Y3");
}

const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

test.describe("the shopping cart", () => {
  test("a buyer fills a cart from the board and a product page, pays once, and the seller refunds one line", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const s = await seed(page, "cart-flow");
    test.skip(!(await cartOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // 1. The board: a card whose product needs no choice adds in one press; the
    //    coasters (a set to choose) keep the page's words and open the page.
    await expect(page.locator("[data-tile-quick-add-tile]")).toHaveCount(3);
    const coastersCard = page.locator(`a[data-storefront-tile='${s.coasters}']`);
    await expect(coastersCard).toContainText("Buy now");
    await expect(coastersCard.locator("button")).toHaveCount(0);

    await page.getByRole("button", { name: "Add Mug to your cart" }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator("[data-cart-line]")).toHaveCount(1);
    await closeDrawer(page);
    await expect(page.locator("[data-cart-count]")).toHaveAttribute("data-cart-count", "1");

    await page.getByRole("button", { name: "Add Glaze zine to your cart" }).click();
    await expect(drawer(page).locator("[data-cart-line]")).toHaveCount(2);
    await closeDrawer(page);

    // 2. The coasters as a set of four, from their own page. The cart came along.
    await page.goto(`/s/${s.storefrontId}/p/${s.coasters}?o=${SET_FOUR}`);
    await expect(page.locator("[data-cart-count]")).toHaveAttribute("data-cart-count", "2");
    await page.getByRole("button", { name: "Add to cart" }).first().click();
    await expect(drawer(page).locator("[data-cart-line]")).toHaveCount(3);
    await expect(drawer(page)).toContainText("Four");

    // 3. One more mug, in the cart: 2 x €12 + €18 + €8.
    await drawer(page).getByRole("button", { name: "One more Mug" }).click();
    await expect(drawer(page).locator("[data-cart-items]")).toHaveAttribute("data-cart-items", "5000");
    await expect(page.locator("[data-cart-count]")).toHaveAttribute("data-cart-count", "4");

    // 4. One checkout for everything, one delivery: €50 + €4.50.
    await drawer(page).locator("[data-cart-checkout]").click();
    await expect(page).toHaveURL(new RegExp(`/s/${s.storefrontId}/checkout\\?cart=`));
    await expect(page.locator("[data-checkout-cart-lines]")).toHaveAttribute("data-checkout-cart-lines", "3");
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "5450");
    await fillAddress(page, "aoife.cart@example.test");
    // A download is in it: the buyer consents to its immediate supply.
    await page.locator("[data-checkout-consent] input").check();
    const pay = page.locator("form [data-checkout-pay]");
    await expect(pay).toBeEnabled({ timeout: 20_000 });
    await pay.click();
    await expect(page).toHaveURL(/\/order\//, { timeout: 30_000 });
    const orderUrl = page.url().replace(/\?placed=1$/, "");

    // 5. The buyer's order page: every line, the total paid.
    await expect(page.locator("[data-order-total]")).toHaveAttribute("data-order-total", "5450");
    await expect(page.locator("[data-order-add-ons]")).toHaveAttribute("data-order-add-ons", "2");

    // 6. The database: one order of three lines from the cart, stock taken
    //    for both mugs, the cart closed, the adds counted.
    const [order] = (await serviceRest(
      `/orders?seller_id=eq.${s.sellerId}&select=id,amount_cents,product_id,status,cart_id`,
    )) as { id: string; amount_cents: number; product_id: string; status: string; cart_id: string | null }[];
    expect(order).toMatchObject({ amount_cents: 5450, product_id: s.mug, status: "paid" });
    expect(order.cart_id).not.toBeNull();
    const lines = (await serviceRest(
      `/order_add_ons?order_id=eq.${order.id}&select=id,product_id,source,selected_options&order=position`,
    )) as { id: string; product_id: string; source: string; selected_options: unknown }[];
    expect(lines.map((line) => [line.product_id, line.source])).toEqual([
      [s.zine, "cart"],
      [s.coasters, "cart"],
    ]);
    expect(lines[1]?.selected_options).toEqual([{ label: "Set", value: "Four" }]);
    const [mug] = (await serviceRest(`/products?id=eq.${s.mug}&select=stock_quantity`)) as { stock_quantity: number }[];
    expect(mug.stock_quantity).toBe(3);
    const [cart] = (await serviceRest(`/carts?id=eq.${order.cart_id}&select=ordered_at`)) as { ordered_at: string | null }[];
    expect(cart?.ordered_at).not.toBeNull();
    await expect
      .poll(
        async () =>
          ((await serviceRest(`/storefront_signals?account_id=eq.${s.sellerId}&kind=eq.cart_add&select=id`)) as unknown[])
            .length,
        { timeout: 20_000 },
      )
      .toBe(3);

    // 7. The seller gives back the coasters alone; the order stands.
    await gotoApp(page, `/orders?order=${order.id}`);
    const panel = page.getByRole("dialog", { name: /order details/i });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Refund or cancel" }).click();
    await panel.getByRole("combobox", { name: "What to refund" }).click();
    await page.getByRole("option", { name: "Oak coasters" }).click();
    await panel.getByRole("button", { name: "Refund this item" }).click();
    await expect
      .poll(
        async () =>
          ((await serviceRest(`/order_line_refunds?order_id=eq.${order.id}&select=line_id`)) as { line_id: string }[]).map(
            (row) => row.line_id,
          ),
        { timeout: 20_000 },
      )
      .toEqual([lines[1]!.id]);
    const [after] = (await serviceRest(`/orders?id=eq.${order.id}&select=status`)) as { status: string }[];
    expect(after.status).toBe("paid");

    // 8. The buyer's page says which line went back.
    await page.goto(orderUrl);
    await expect(page.locator(`[data-order-add-on='${lines[1]!.id}'] [data-order-line-refunded]`)).toBeVisible();
    await expect(page.locator("[data-order-line-refunded]")).toHaveCount(1);
  });

  test("the cart routes refuse what a cart must not hold", async ({ page, browser }) => {
    const s = await seed(page, "cart-guard");
    test.skip(!(await cartOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const otherPage = await browser.newPage();
    const other = await seed(otherPage, "cart-other");
    await otherPage.close();

    const api = `/api/cart/${s.storefrontId}`;
    const add = (productId: string, quantity = 1, optionIds: string[] = []) => ({
      cartId: null,
      change: { kind: "add", productId, optionIds, quantity, source: "cart" },
    });
    const post = (data: object, headers: Record<string, string> = sameOrigin, path = api) =>
      page.request.post(path, { headers, data });
    const refused = async (data: object, status: number, error: string) => {
      const response = await post(data);
      expect(response.status(), JSON.stringify(data)).toBe(status);
      expect(await response.json()).toMatchObject({ ok: false, error });
    };

    // Another site's page riding the buyer's browser.
    expect((await post(add(s.mug), { ...sameOrigin, "sec-fetch-site": "cross-site" })).status()).toBe(403);
    // A request that names a price, or an unknown key, is not a cart change.
    expect((await post({ ...add(s.mug), priceCents: 1 })).status()).toBe(400);
    expect((await post({ cartId: null, change: { kind: "add", productId: s.mug } })).status()).toBe(400);
    // Another store's product, a set not chosen, more than the shelf holds.
    await refused(add(other.mug), 409, "not_found");
    await refused(add(s.coasters), 409, "options");
    await refused(add(s.mug, 6), 409, "insufficient_stock");
    // A storefront that is not one, and a cart that does not exist.
    expect((await post(add(s.mug), sameOrigin, `/api/cart/${randomUUID()}`)).status()).toBe(404);
    const gone = await post({ cartId: randomUUID() }, sameOrigin, `${api}/view`);
    expect(gone.status()).toBe(404);
    expect(await gone.json()).toMatchObject({ ok: false, error: "gone" });

    // What does go in is shown priced by the server, never by the request.
    const added = await post(add(s.coasters, 2, [SET_TWO]));
    expect(added.status()).toBe(201);
    const body = (await added.json()) as { ok: true; cart: { itemsCents: number; lines: { quantity: number }[] } };
    expect(body.cart.itemsCents).toBe(3600);
    expect(body.cart.lines).toHaveLength(1);
    // Nothing of the other store's was touched.
    expect(((await serviceRest(`/carts?storefront_id=eq.${other.storefrontId}&select=id`)) as unknown[]).length).toBe(0);
  });

  test("the seller's switch turns card adds off, and the settings round-trip", async ({ page }) => {
    const s = await seed(page, "cart-switch");
    test.skip(!(await cartOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await expect(page.locator("[data-tile-quick-add-tile]")).toHaveCount(3);

    const route = `/api/storefronts/${s.storefrontId}/cart-page`;
    const read = await page.request.get(route);
    expect(read.status()).toBe(200);
    expect(await read.json()).toMatchObject({ cartPage: {}, live: true });
    const patched = await page.request.patch(route, { headers: sameOrigin, data: { quickAdd: false } });
    expect(patched.status()).toBe(200);
    expect(await patched.json()).toMatchObject({ cartPage: { quickAdd: false } });
    // Words with a link in them are refused.
    expect(
      (await page.request.patch(route, { headers: sameOrigin, data: { note: "Pay at https://example.test" } })).status(),
    ).toBe(400);

    // Every card opens its page again, in the page's words.
    await page.goto(`/s/${s.storefrontId}`);
    await expect(page.locator("[data-cart-button]")).toBeVisible();
    await expect(page.locator("[data-tile-quick-add-tile]")).toHaveCount(0);
    await expect(page.locator(`a[data-storefront-tile='${s.mug}']`)).toContainText("Buy now");
  });

  test("the seller designs the cart where it opens, full of their own products, and buyers get what was saved", async ({
    page,
  }) => {
    const s = await seed(page, "cart-design");
    test.skip(!(await cartOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    const panel = page.locator("[data-design-panel]").first();
    await panel.locator("[data-panel-menu]").getByRole("button", { name: /^Cart/ }).click();

    // The Cart settings put a product page out with its cart open, full: the
    // page's own product, then the board's others a card adds (the coasters
    // need a choice, so they stay out).
    const onPage = page.locator(`[data-artboard-id="${s.mug}"]`);
    const cart = onPage.locator("[data-cart-drawer-inline]");
    await expect(cart).toBeVisible();
    await expect(cart.locator("[data-cart-lines] > li")).toHaveCount(3);

    // Three products a card adds: "Add to cart" leading is one tap away.
    await panel.getByRole("button", { name: "Lead with Add to cart" }).click();
    await expect(onPage.locator("[data-add-to-cart] button").first()).toHaveAttribute("data-cta-fill", /.+/);

    // The heading is typed straight onto the cart...
    await cart.locator("[data-editable-text='cartTitle']").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Your bag");
    await page.keyboard.press("Enter");
    await expect(cart.locator("h2[data-editable-text='cartTitle']")).toHaveText("Your bag");
    // ...and a click on the cart opens the rest of its settings, holding the same words.
    await cart.locator("[data-cart-summary] dl").click();
    await expect(panel.getByRole("textbox", { name: "Cart heading" })).toHaveValue("Your bag");
    // Steps on the sample play on the page and are never saved.
    await cart.locator("[data-cart-lines] > li").first().getByRole("button", { name: /^One more/ }).click();

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    const [row] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
      config: { cartPage?: Record<string, unknown> };
    }[];
    expect(row.config.cartPage).toEqual({ mainButton: "addToCart", title: "Your bag" });

    // A buyer gets the cart as it was designed.
    await page.goto(`/s/${s.storefrontId}/p/${s.mug}`);
    const add = page.locator("[data-add-to-cart] button").first();
    await expect(add).toHaveAttribute("data-cta-fill", /.+/);
    await add.click();
    await expect(page.getByRole("dialog", { name: "Your bag" })).toBeVisible();
  });
});
