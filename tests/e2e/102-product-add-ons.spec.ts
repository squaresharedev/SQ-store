import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  canvasStill,
  freshUser,
  gotoApp,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * "ADD TO YOUR ORDER", end to end, with the development TEST provider.
 *
 * A seller picks two of their other products in the vase's form. A buyer sees
 * them beside Buy now, takes both (one in a chosen version), pays once, and
 * the order holds every line: the buyer's order page lists them, the seller's
 * packing list names them, and each line's stock came off. Then what must hold
 * however a request is built: only the vase's own add-ons are priced, never
 * another store's product, and never at a total the buyer was not shown.
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
};

// Saved before the add-ons section existed: it is not named, so it shows.
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

const SET_GROUP = "7b000000-0000-4000-8000-000000000001";
const SET_TWO = "7b000000-0000-4000-8000-000000000002";
const SET_FOUR = "7b000000-0000-4000-8000-000000000003";

type Seeded = {
  sellerId: string;
  storefrontId: string;
  vase: string;
  mug: string;
  coasters: string;
  zine: string;
};

async function seed(page: Page, tag: string, addOnIds?: (s: Omit<Seeded, "sellerId" | "storefrontId">) => string[]) {
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
    {
      title: "Mug",
      price_cents: 1200,
      track_stock: true,
      stock_quantity: 5,
      low_stock_threshold: 1,
      description: "Thrown by hand and glazed in our Galway studio.",
    },
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

  // Only the vase is a tile: an add-on needs none.
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [{ type: "product", productId: products.vase, x: 0, y: 0, w: 2, h: 2 }],
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
  if (addOnIds) {
    await serviceRest(`/products?id=eq.${products.vase}`, {
      method: "PATCH",
      body: { add_on_ids: addOnIds(products) },
    });
  }
  return { sellerId, storefrontId, ...products } satisfies Seeded;
}

const productUrl = (s: Seeded) => `/s/${s.storefrontId}/p/${s.vase}`;

/**
 * Whether this run can check out at all. Skipped only when the switch is off
 * (a plain `playwright test`, not `pnpm test:e2e:checkout`). With it on, a
 * checkout that is not offered is a FAILURE: a skip there reported a stack that
 * could not sell anything as green.
 */
async function checkoutOffered(page: Page, s: Seeded): Promise<boolean> {
  if (process.env.CHECKOUT_TEST_PAYMENTS !== "1") return false;
  const response = await page.request.get(`${productUrl(s)}/checkout`, { maxRedirects: 0 });
  expect(response.status(), "checkout should be offered with the switch on").toBe(200);
  return true;
}

async function pay(page: Page) {
  const button = page.locator("form [data-checkout-pay]");
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
}

async function fillAddress(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Aoife Byrne");
  await page.getByLabel("Address", { exact: true }).fill("12 Harbour Road");
  await page.getByLabel("Town or city").fill("Galway");
  await page.getByLabel("Postcode").fill("H91 X2Y3");
}

test.describe("add to your order", () => {
  test("the seller picks add-ons, a buyer takes them, and one order holds them all", async ({ page }) => {
    const s = await seed(page, "addon-flow");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // 1. The seller offers the mug and the coasters with the vase.
    await gotoApp(page, `/products/${s.vase}/edit`);
    const field = page.locator("[data-product-field='addOns']");
    await expect(field).toBeVisible();
    // Only posted products are offered beside a posted one: no zine.
    await expect(field.getByRole("listitem").filter({ hasText: "Glaze zine" })).toHaveCount(0);
    await field.getByRole("button", { name: /^Add .*Mug/ }).click();
    await field.getByRole("button", { name: /^Add .*Oak coasters/ }).click();
    await expect(field).toHaveAttribute("data-product-value", "2");
    // What was pressed is already in the preview, as a buyer will meet it.
    await expect(page.locator("[data-add-ons-preview] [data-product-add-on]")).toHaveCount(2);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect
      .poll(async () => ((await serviceRest(`/products?id=eq.${s.vase}&select=add_on_ids`)) as { add_on_ids: string[] }[])[0]?.add_on_ids)
      .toEqual([s.mug, s.coasters]);

    // 2. A buyer takes both, the coasters as a set of four.
    await page.goto(productUrl(s));
    const section = page.locator("[data-product-add-ons]");
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "Add Mug to your order" }).click();
    await section.getByRole("button", { name: "Add Oak coasters to your order" }).click();
    await section.getByRole("combobox", { name: "Set for Oak coasters" }).click();
    await page.getByRole("option", { name: "Four" }).click();
    await expect(section).toHaveAttribute("data-product-add-ons", "2");
    const cta = page.locator("[data-product-cta='checkout']").first().locator("a");
    await expect(cta).toHaveAttribute("href", new RegExp(`a=${s.mug}%2C${s.coasters}\\.${SET_FOUR}`));
    await cta.click();

    // 3. One checkout, one delivery: €24 + €12 + €18 + €4.50.
    await expect(page.locator("[data-checkout-page='public']")).toBeVisible();
    await expect(page.locator("[data-checkout-add-on]")).toHaveCount(2);
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "5850");
    // Taking one out takes it off the total.
    await page.locator(`[data-checkout-add-on-remove='${s.mug}']`).click();
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "4650");
    await page.goto(`${productUrl(s)}/checkout?a=${s.mug},${s.coasters}.${SET_FOUR}`);
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "5850");
    await fillAddress(page, "aoife.addons@example.test");
    await pay(page);
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 });

    // 4. The buyer's order page lists every line.
    await expect(page.locator("[data-order-total]")).toHaveAttribute("data-order-total", "5850");
    await expect(page.locator("[data-order-add-ons]")).toHaveAttribute("data-order-add-ons", "2");
    await expect(page.locator("[data-order-summary]")).toContainText("Mug");
    await expect(page.locator("[data-order-summary]")).toContainText("Four");

    // 5. The database: one order, two lines, each one's stock taken.
    const [order] = (await serviceRest(`/orders?seller_id=eq.${s.sellerId}&select=id,amount_cents,product_id`)) as {
      id: string;
      amount_cents: number;
      product_id: string;
    }[];
    expect(order).toMatchObject({ amount_cents: 5850, product_id: s.vase });
    const lines = (await serviceRest(
      `/order_add_ons?order_id=eq.${order.id}&select=product_id,amount_cents,selected_options,position&order=position`,
    )) as { product_id: string; amount_cents: number; selected_options: unknown }[];
    expect(lines.map((line) => [line.product_id, line.amount_cents])).toEqual([
      [s.mug, 1200],
      [s.coasters, 1800],
    ]);
    expect(lines[1]?.selected_options).toEqual([{ label: "Set", value: "Four" }]);
    const stock = (await serviceRest(`/products?id=in.(${s.vase},${s.mug})&select=id,stock_quantity`)) as {
      id: string;
      stock_quantity: number;
    }[];
    expect(Object.fromEntries(stock.map((row) => [row.id, row.stock_quantity]))).toEqual({ [s.vase]: 8, [s.mug]: 4 });

    // 6. The seller's packing list names everything that goes in the box.
    await gotoApp(page, `/orders?order=${order.id}`);
    await expect(page.locator("[data-order-pack]")).toBeVisible();
    await expect(page.locator("[data-order-pack-add-on]")).toHaveCount(2);
    await expect(page.locator("[data-order-pack-add-on='1']")).toContainText("Oak coasters");
  });

  test("only the product's own add-ons are priced, at the total the buyer saw", async ({ page, browser }) => {
    const s = await seed(page, "addon-guard", (p) => [p.mug, p.coasters, p.zine]);
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    // Another store, signed up in a browser of its own.
    const otherPage = await browser.newPage();
    const other = await seed(otherPage, "addon-other");
    await otherPage.close();
    const api = `/api/checkout/${s.storefrontId}/${s.vase}`;
    const body = {
      attemptId: crypto.randomUUID(),
      optionIds: [],
      quantity: 1,
      email: "tester@example.test",
      locale: "en",
      shipTo: { name: "T Ester", line1: "1 Main St", city: "Galway", postalCode: "H91", country: "IE" },
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    };
    const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const post = (data: object) => page.request.post(api, { headers: sameOrigin, data: { ...body, ...data } });
    const refused = async (data: object, error: string) => {
      const response = await post(data);
      expect(response.status(), JSON.stringify(data)).toBe(409);
      expect(await response.json()).toMatchObject({ ok: false, error });
    };

    // Another store's product, a download beside a parcel, a version not given.
    await refused({ addOns: [{ productId: other.mug, optionIds: [] }] }, "add_on_unavailable");
    await refused({ addOns: [{ productId: s.zine, optionIds: [] }] }, "add_on_unavailable");
    await refused({ addOns: [{ productId: s.coasters, optionIds: [] }] }, "add_on_unavailable");
    // A price in the body is refused outright.
    expect((await post({ addOns: [{ productId: s.mug, optionIds: [], amountCents: 1 }] })).status()).toBe(400);
    // A total the buyer was not shown.
    await refused({ addOns: [{ productId: s.mug, optionIds: [] }], expectedTotalCents: 2850 }, "price_changed");
    // The one they were: €24 + €12 + €4.50.
    const placed = await post({ addOns: [{ productId: s.mug, optionIds: [] }], expectedTotalCents: 4050 });
    expect(placed.status()).toBe(201);
    expect(((await serviceRest(`/order_add_ons?seller_id=eq.${s.sellerId}&select=id`)) as unknown[]).length).toBe(1);
    // Nothing of the other store's was touched.
    expect(((await serviceRest(`/order_add_ons?seller_id=eq.${other.sellerId}&select=id`)) as unknown[]).length).toBe(0);
  });

  test("the form's preview holds what a buyer would be offered, at this store's prices", async ({ page }) => {
    const s = await seed(page, "addon-preview");
    // The mug is on sale and the coasters have run out.
    await serviceRest(`/discounts`, {
      method: "POST",
      body: {
        owner_id: s.sellerId,
        kind: "automatic",
        value_type: "percent",
        percent_off: 25,
        applies_to: "products",
        product_ids: [s.mug],
        starts_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    await serviceRest(`/products?id=eq.${s.coasters}`, {
      method: "PATCH",
      body: { track_stock: true, stock_quantity: 0 },
    });

    await gotoApp(page, `/products/${s.vase}/edit`);
    const field = page.locator("[data-product-field='addOns']");
    const preview = page.locator("[data-add-ons-preview]");
    await expect(preview).toHaveAttribute("data-add-ons-preview", "empty");

    await field.getByRole("button", { name: /^Add .*Mug/ }).click();
    await field.getByRole("button", { name: /^Add .*Oak coasters/ }).click();
    await expect(field.locator("[data-product-add-on-sold-out]")).toHaveCount(1);

    // Only the mug can be sold, and it shows its sale. The coasters are drawn
    // faded after it, with why.
    await expect(preview.locator("[data-product-add-on]")).toHaveCount(1);
    await expect(preview.locator(`[data-product-add-on='${s.mug}']`)).toBeVisible();
    await expect(preview.locator("[data-product-sale-was='1200']")).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-add-ons-preview-hidden", "1");
    await expect(preview.locator(`[data-product-add-on-hidden='${s.coasters}']`)).toHaveAttribute(
      "data-product-add-on-hidden-reason",
      "soldOut",
    );

    // It is a picture: pressing where its Add button is takes nothing.
    await preview.locator("[data-product-add-on-toggle]").click({ force: true });
    await expect(preview.locator("[data-product-add-ons]")).toHaveAttribute("data-product-add-ons", "0");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(preview.getByRole("button")).toHaveCount(0);

    // A buy link of the seller's own means no add-ons on the page, and taking it
    // off brings the preview back at its size, with the choices kept.
    await page.locator("[data-product-reveal='purchaseUrl']").click();
    const link = page.locator("[data-product-field='purchaseUrl']");
    await link.fill("https://example.com/buy");
    await expect(preview).toHaveAttribute("data-add-ons-preview", "off");
    await link.fill("");
    await expect(preview).toHaveAttribute("data-add-ons-preview", "chosen");
    await expect(preview.locator("[data-product-add-on-toggle]")).toBeVisible();
    await expect(field).toHaveAttribute("data-product-value", "2");

    const drawn = await preview.locator("[data-product-add-on]").boundingBox();
    expect(drawn?.height ?? 0).toBeGreaterThan(0);
  });

  test("a buyer looks at an add-on's details, sees its stars, and can go to its own page and back", async ({
    page,
  }) => {
    const s = await seed(page, "addon-details", (p) => [p.mug, p.coasters]);
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    // The mug has three reviews (5, 5, 4): the summary row the database keeps.
    await serviceRest(`/product_rating_summaries`, {
      method: "POST",
      body: {
        product_id: s.mug,
        seller_id: s.sellerId,
        review_count: 3,
        rating_sum: 14,
        rating_4: 1,
        rating_5: 2,
      },
    });

    await page.goto(productUrl(s));
    const section = page.locator("[data-product-add-ons]");
    await section.getByRole("button", { name: "Add Oak coasters to your order" }).click();

    // No reviews: no stars. Neither add-on is a tile here, and each still has
    // a page of its own, because the vase offers it.
    await section.getByRole("button", { name: "See details of Oak coasters" }).click();
    let dialog = page.getByRole("dialog", { name: "Oak coasters" });
    await expect(dialog.getByRole("button", { name: "Remove from your order" })).toBeVisible();
    await expect(dialog.locator("[data-add-on-details-rating]")).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "See full page" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    // Reviewed: its stars, in the page's star colour. Looking adds nothing.
    await section.getByRole("button", { name: "See details of Mug" }).click();
    dialog = page.getByRole("dialog", { name: "Mug" });
    await expect(dialog).toContainText("Thrown by hand");
    await expect(dialog.getByRole("img", { name: "4.7 out of 5 stars, 3 reviews" })).toBeVisible();
    await expect(dialog.locator("[data-add-on-details-rating]")).toHaveText("4.7(3)");
    await expect(section).toHaveAttribute("data-product-add-ons", "1");
    await page.waitForTimeout(400); // Past the dialog's fade, for the picture.
    await page.screenshot({ path: test.info().outputPath("details-stars.png") });

    // The button goes to its page, which a buyer can buy from too.
    await dialog.getByRole("link", { name: "See full page" }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${s.mug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mug");
    await expect(page.locator("[data-product-cta='checkout']").first()).toBeVisible();

    // Back keeps what the buyer had taken.
    await page.goBack();
    await expect(page.getByRole("button", { name: "Add Oak coasters to your order" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Only what a tile offers has a page: the zine is offered by nothing here,
    // and the coasters lose theirs once the vase stops offering them.
    expect((await page.request.get(`/s/${s.storefrontId}/p/${s.zine}`)).status()).toBe(404);
    expect((await page.request.get(`/s/${s.storefrontId}/p/${s.coasters}`)).status()).toBe(200);
    await serviceRest(`/products?id=eq.${s.vase}`, { method: "PATCH", body: { add_on_ids: [s.mug] } });
    expect((await page.request.get(`/s/${s.storefrontId}/p/${s.coasters}`)).status()).toBe(404);
  });

  test("the seller's heading, look and place reach the buyer", async ({ page }) => {
    const s = await seed(page, "addon-design", (p) => [p.mug, p.coasters]);
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // In the designer: the section's heading on the page opens its own settings.
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByLabel(/^stoneware vase. press enter/i).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for stoneware vase$/i }).click();
    const artboard = page.locator(`[data-artboard-id="${s.vase}"]`);
    const onCanvas = artboard.locator("[data-product-add-ons]");
    await expect(onCanvas.getByRole("heading")).toHaveText("Add to your order");
    await onCanvas.getByRole("heading").click();
    const design = page.locator("[data-add-ons-design]");
    await expect(design).toBeVisible();

    // Each change shows on the page at once.
    await design.getByLabel("Heading").fill("Goes well with");
    await expect(onCanvas.getByRole("heading")).toHaveText("Goes well with");
    await design.getByRole("group", { name: "Look" }).getByRole("button", { name: "Tiles" }).click();
    await expect(onCanvas).toHaveAttribute("data-product-add-ons-layout", "tiles");
    await design.getByRole("button", { name: "Below the button" }).click();
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
          config: { productPage?: Record<string, unknown> };
        }[];
        return [row?.config.productPage?.addOnsTitle, row?.config.productPage?.addOnsLayout, row?.config.productPage?.addOnsPlacement];
      })
      .toEqual(["Goes well with", "tiles", "afterButton"]);

    // On the buyer's page.
    await page.goto(productUrl(s));
    const section = page.locator("[data-product-add-ons]");
    await expect(section.getByRole("heading")).toHaveText("Goes well with");
    await expect(section).toHaveAttribute("data-product-add-ons-layout", "tiles");
    const after = await section.evaluate((node) => {
      const cta = document.querySelector("[data-product-cta='checkout']")!;
      return Boolean(cta.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(after).toBe(true);

    // The heading is the seller's words on the page a buyer pays from: no links.
    const refused = await page.request.patch(`/api/storefronts/${s.storefrontId}/product-page`, {
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      data: { addOnsTitle: "Cheaper at my-other-site.shop" },
    });
    expect(refused.ok()).toBe(false);
  });

  test("the seller chooses what a page offers in the storefront editor, without saving the storefront", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const s = await seed(page, "addon-panel");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const stored = async () => {
      const [row] = (await serviceRest(`/products?id=eq.${s.vase}&select=add_on_ids,moderation_status`)) as {
        add_on_ids: string[];
        moderation_status: string;
      }[];
      return row;
    };

    const artboard = page.locator(`[data-artboard-id="${s.vase}"]`);
    const field = page.locator("[data-add-ons-products='ready']");
    const press = (id: string) => field.locator(`[data-product-add-on='${id}'] [data-product-add-on-toggle]`);
    const onPage = (id: string) => artboard.locator(`[data-product-add-on='${id}']`);
    async function openDesigner() {
      await gotoApp(page, `/storefront/${s.storefrontId}`);
      await page.getByLabel(/^stoneware vase. press enter/i).click();
      await canvasStill(page);
      await page.getByRole("button", { name: /^open the product page for stoneware vase$/i }).click();
      await expect(artboard).toBeVisible();
    }

    // Nothing chosen yet: the dashed section is the way to the list.
    await openDesigner();
    const before = (await stored())!.moderation_status;
    await artboard.locator("[data-product-add-ons='unset']").click();
    await expect(field).toBeVisible();
    await expect(field.getByRole("list", { name: "Offered with Stoneware vase" })).toBeVisible();
    await expect(field.locator(`[data-add-ons-products-for='${s.vase}']`)).toHaveText("Stoneware vase");
    await expect(field.locator("[data-product-add-ons-count]")).toHaveText(/0\/4/);
    // Never itself, and never another kind of product.
    await expect(field.locator(`[data-product-add-on='${s.vase}']`)).toHaveCount(0);
    await expect(field.locator(`[data-product-add-on='${s.zine}']`)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("panel-empty.png") });

    // Each press shows on the page beside it and is stored, with Save untouched.
    await press(s.mug).click();
    await expect(onPage(s.mug)).toBeVisible();
    await press(s.coasters).click();
    await expect(onPage(s.coasters)).toBeVisible();
    await expect.poll(async () => (await stored())!.add_on_ids).toEqual([s.mug, s.coasters]);
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    // What the server answered replaces the first draw: the coasters' versions
    // are there to choose from once a buyer takes them.
    await onPage(s.coasters).locator("[data-product-add-on-toggle]").click();
    await expect(onPage(s.coasters).getByRole("combobox")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("panel-chosen.png") });
    // Choosing products is not an edit of the listing, so it stays as it was.
    expect((await stored())!.moderation_status).toBe(before);

    // A reload reads it back, and pressing takes one off again.
    await openDesigner();
    await expect(onPage(s.mug)).toBeVisible();
    await artboard.locator("[data-product-add-ons]").getByRole("heading").click();
    await expect(field).toBeVisible();
    await expect(field.locator(`[data-product-add-on='${s.mug}']`)).toHaveAttribute(
      "data-product-add-on-state",
      "added",
    );
    await press(s.mug).click();
    await expect(onPage(s.mug)).toHaveCount(0);
    await expect.poll(async () => (await stored())!.add_on_ids).toEqual([s.coasters]);
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    // The buyer's page offers what was chosen.
    await page.goto(productUrl(s));
    const section = page.locator("[data-product-add-ons]");
    await expect(section.locator(`[data-product-add-on='${s.coasters}']`)).toBeVisible();
    await expect(section.locator(`[data-product-add-on='${s.mug}']`)).toHaveCount(0);
  });

  test("four chosen in the editor are all drawn, the two a buyer would not get faded, and tiles stay small", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const s = await seed(page, "addon-four");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await seedProducts(s.sellerId, [
      { title: "Floor lamp", price_cents: 38000, status: "draft" },
      { title: "Bookshelf", price_cents: 112000, track_stock: true, stock_quantity: 0 },
    ]);
    const rows = (await serviceRest(`/products?owner_id=eq.${s.sellerId}&select=id,title`)) as {
      id: string;
      title: string;
    }[];
    const lamp = rows.find((row) => row.title === "Floor lamp")!.id;
    const shelf = rows.find((row) => row.title === "Bookshelf")!.id;

    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByLabel(/^stoneware vase. press enter/i).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for stoneware vase$/i }).click();
    const artboard = page.locator(`[data-artboard-id="${s.vase}"]`);
    await artboard.locator("[data-product-add-ons='unset']").click();
    const field = page.locator("[data-add-ons-products='ready']");
    const press = (id: string) => field.locator(`[data-product-add-on='${id}'] [data-product-add-on-toggle]`);
    for (const id of [s.mug, lamp, s.coasters, shelf]) await press(id).click();
    await expect(field.locator("[data-product-add-ons-count]")).toHaveText(/4\/4/);
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(`/products?id=eq.${s.vase}&select=add_on_ids`)) as {
          add_on_ids: string[];
        }[];
        return row?.add_on_ids;
      })
      .toEqual([s.mug, lamp, s.coasters, shelf]);

    // All four on the page: the two a buyer gets, then the two they do not,
    // faded, each with why. The panel says no more than it must.
    const section = artboard.locator("[data-product-add-ons]");
    await expect(section.locator("[data-product-add-on]")).toHaveCount(2);
    await expect(section.locator(`[data-product-add-on-hidden='${lamp}']`)).toContainText("Draft");
    await expect(section.locator(`[data-product-add-on-hidden='${shelf}']`)).toContainText("Sold out");
    await expect(page.getByText("Saved as you press")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("four-rows.png") });

    // Small tiles: four across one row, each at most a quarter of the list,
    // none taller than twice its width.
    await page
      .locator("[data-add-ons-design]")
      .getByRole("group", { name: "Look" })
      .getByRole("button", { name: "Tiles" })
      .click();
    await expect(section).toHaveAttribute("data-product-add-ons-layout", "tiles");
    const boxes = await section.locator("li").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { top: Math.round(box.top), width: box.width, height: box.height };
      }),
    );
    const list = await section.locator("ul").evaluate((node) => node.getBoundingClientRect().width);
    expect(boxes).toHaveLength(4);
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
    for (const box of boxes) {
      expect(box.width).toBeLessThanOrEqual(list / 4 + 1);
      expect(box.height).toBeLessThan(box.width * 2);
    }
    await section.screenshot({ path: test.info().outputPath("four-tiles.png") });

    // A faded one is the way back to the list.
    await section.locator(`[data-product-add-on-hidden='${lamp}']`).click();
    await expect(field).toBeVisible();

    // The buyer's page offers the two, and nothing faded.
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
          config: { productPage?: Record<string, unknown> };
        }[];
        return row?.config.productPage?.addOnsLayout;
      })
      .toBe("tiles");
    await page.goto(productUrl(s));
    const buyer = page.locator("[data-product-add-ons]");
    await expect(buyer.locator("[data-product-add-on]")).toHaveCount(2);
    await expect(buyer.locator("[data-product-add-on-hidden]")).toHaveCount(0);
  });

  test("the list suggests what buyers bought together, in the form and the editor, and a new product the usual one", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // The vase offers the coasters already, and so does the mug: a habit.
    const s = await seed(page, "addon-guess", (p) => [p.coasters]);
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await serviceRest(`/products?id=eq.${s.mug}`, { method: "PATCH", body: { add_on_ids: [s.coasters] } });
    // Two buyers took a mug with the vase, one of them a week later and in
    // capitals. Both bought the zine too, but a download never goes with a
    // posted vase. A refund is not a purchase.
    const bought = (buyer: string, id: string, status: "paid" | "refunded" = "paid") => ({
      amount_cents: 1200,
      buyer_email: buyer,
      product_id: id,
      status,
    });
    await seedOrders(s.sellerId, [
      bought("ana@example.com", s.vase),
      bought("ana@example.com", s.mug),
      bought("ana@example.com", s.zine),
      bought("ben@example.com", s.vase),
      bought("BEN@example.com", s.mug),
      bought("ben@example.com", s.zine),
      bought("cat@example.com", s.vase, "refunded"),
      bought("cat@example.com", s.mug, "refunded"),
    ]);
    const stored = async (id: string) =>
      ((await serviceRest(`/products?id=eq.${id}&select=add_on_ids`)) as { add_on_ids: string[] }[])[0]?.add_on_ids;

    // 1. The product form: one tap adds it, the arrow takes it back, and
    // nothing is stored before Save.
    await gotoApp(page, `/products/${s.vase}/edit`);
    const field = page.locator("[data-product-field='addOns']");
    const guess = field.locator("[data-product-add-ons-suggestion='boughtWith'] [data-suggestion]");
    await expect(guess).toHaveText("Often bought together: Mug");
    await expect(guess).toHaveAccessibleDescription(
      "Buyers who bought this product also bought Mug. A tap adds it to this list.",
    );
    await guess.hover();
    await page.screenshot({ path: test.info().outputPath("form-guess.png") });
    await guess.click();
    await expect(field).toHaveAttribute("data-product-value", "2");
    await expect(field.locator(`[data-product-add-on='${s.mug}']`)).toHaveAttribute("data-product-add-on-state", "added");
    await expect(page.locator(`[data-add-ons-preview] [data-product-add-on='${s.mug}']`)).toBeVisible();
    expect(await stored(s.vase)).toEqual([s.coasters]);
    await field.locator("[data-suggestion-undo]").click();
    await expect(field).toHaveAttribute("data-product-value", "1");
    await guess.click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => stored(s.vase)).toEqual([s.coasters, s.mug]);

    // 2. A new product has no buyers yet: it gets what the seller offers with
    // two of their others.
    await gotoApp(page, "/products/new");
    const fresh = page.locator("[data-product-field='addOns']");
    await expect(fresh.locator("[data-product-add-ons-suggestion='offeredWith'] [data-suggestion]")).toHaveText(
      "You often add: Oak coasters",
    );

    // 3. The storefront editor: the same guess, saved at once like a press.
    await serviceRest(`/products?id=eq.${s.vase}`, { method: "PATCH", body: { add_on_ids: [] } });
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByLabel(/^stoneware vase. press enter/i).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for stoneware vase$/i }).click();
    const artboard = page.locator(`[data-artboard-id="${s.vase}"]`);
    await artboard.locator("[data-product-add-ons='unset']").click();
    const panel = page.locator("[data-add-ons-products='ready']");
    const panelGuess = panel.locator("[data-product-add-ons-suggestion='boughtWith'] [data-suggestion]");
    await expect(panelGuess).toHaveText("Often bought together: Mug");
    await panelGuess.click();
    await expect(artboard.locator(`[data-product-add-on='${s.mug}']`)).toBeVisible();
    await expect.poll(() => stored(s.vase)).toEqual([s.mug]);
    await expect(panel.locator("[data-suggestion-undo]")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("panel-guess.png") });
    await panel.locator("[data-suggestion-undo]").click();
    await expect.poll(() => stored(s.vase)).toEqual([]);
    await expect(panelGuess).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  });

  test("on a phone the storefront editor's list fits its sheet, and still chooses", async ({ page }) => {
    test.setTimeout(180_000);
    const s = await seed(page, "addon-panel-phone");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await page.setViewportSize({ width: 390, height: 780 });
    await gotoApp(page, `/storefront/${s.storefrontId}`);

    // Opening the group puts the page out on the canvas, which is what the list
    // chooses for.
    await page.getByRole("button", { name: "Storefront style" }).click();
    await page.getByRole("button", { name: /^Product page/ }).click();
    await expect(page.locator(`[data-artboard-id="${s.vase}"]`)).toBeAttached();
    await page.getByRole("button", { name: "Add to your order", exact: true }).click();
    const field = page.locator("[data-add-ons-products='ready']");
    await expect(field).toBeVisible();

    const box = await field.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await field.locator(`[data-product-add-on='${s.mug}'] [data-product-add-on-toggle]`).click();
    await expect(field.locator(`[data-product-add-on='${s.mug}']`)).toHaveAttribute(
      "data-product-add-on-state",
      "added",
    );
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(`/products?id=eq.${s.vase}&select=add_on_ids`)) as { add_on_ids: string[] }[];
        return row?.add_on_ids;
      })
      .toEqual([s.mug]);
    await page.screenshot({ path: test.info().outputPath("panel-phone.png") });
  });

  test("on a phone the section and the checkout read and pass an accessibility scan", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const s = await seed(page, "addon-a11y", (p) => [p.mug, p.coasters]);
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const scan = async () =>
      (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa"]).analyze()).violations;

    await page.goto(productUrl(s));
    const section = page.locator("[data-product-add-ons]");
    await section.getByRole("button", { name: "Add Oak coasters to your order" }).click();
    await expect(section.getByRole("combobox", { name: "Set for Oak coasters" })).toBeVisible();
    // Nothing spills sideways at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await scan()).toEqual([]);

    // The details dialog, and in the tiles look too.
    await section.getByRole("button", { name: "See details of Mug" }).click();
    const dialog = page.getByRole("dialog", { name: "Mug" });
    await expect(dialog).toContainText("Thrown by hand");
    await page.waitForTimeout(400); // Past the dialog's fade: axe mid-fade invents contrast failures.
    expect(await scan()).toEqual([]);
    await dialog.getByRole("button", { name: "Close" }).click();

    await page.locator("[data-product-cta='checkout']").first().locator("a").click();
    await expect(page.locator("[data-checkout-add-on]")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await scan()).toEqual([]);
  });
});
