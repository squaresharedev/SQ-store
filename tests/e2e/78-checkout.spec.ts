import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  canvasStill,
  devEmails,
  expectToast,
  gotoApp,
  freshUser,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * HOSTED CHECKOUT, end to end, with the development TEST provider.
 *
 * A buyer goes from the product page's button to the checkout, fills in the
 * short form, pays (no money moves: CHECKOUT_TEST_PAYMENTS=1 under next dev,
 * see lib/checkout/availability.ts), and lands on their order page. The order
 * is written by the real order writer, so the seller's order, the stock, the
 * mail and the thank-you are all the real ones. Then the parts that must hold
 * however a request is built: the price is the server's, not the body's; the
 * route answers only its own origin; a product that is not for sale is a 404;
 * an order link that proves nothing is a 404.
 *
 * NEEDS the stack started with CHECKOUT_TEST_PAYMENTS=1 (and ideally
 * NEXT_PUBLIC_APP_URL=http://localhost:3100 so mailed links point at it):
 *   CHECKOUT_TEST_PAYMENTS=1 NEXT_PUBLIC_APP_URL=http://localhost:3100 \
 *     node tests/e2e/stack/server.mjs
 * Without it checkout is (correctly) not offered, and the spec skips.
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

const SIZE_GROUP = "7a000000-0000-4000-8000-000000000001";
const SMALL = "7a000000-0000-4000-8000-000000000002";
const LARGE = "7a000000-0000-4000-8000-000000000003";
const SOLD_OUT_SIZE = "7a000000-0000-4000-8000-000000000004";

type Seeded = {
  sellerId: string;
  storefrontId: string;
  store: string;
  /** Physical, two sizes, €24 each, delivery €4.50 to Ireland. */
  vase: string;
  /** A download. */
  zine: string;
  /** Active and owned, but NOT placed on the storefront. */
  unplaced: string;
};

async function seed(page: Page, tag: string, checkoutPage?: Record<string, unknown>): Promise<Seeded> {
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
    {
      title: "Stoneware vase",
      price_cents: 2400,
      max_per_order: 5,
      track_stock: true,
      stock_quantity: 9,
      low_stock_threshold: 2,
      option_groups: [
        {
          id: SIZE_GROUP,
          name: "Size",
          display: "chip",
          options: [
            { id: SMALL, name: "Small", available: true },
            { id: LARGE, name: "Large", available: true },
            { id: SOLD_OUT_SIZE, name: "Giant", available: false },
          ],
        },
      ],
    },
    {
      title: "Glaze zine",
      price_cents: 800,
      digital_file_key: `files/${sellerId}/${sellerId.slice(0, 8)}-0000-4000-8000-000000000009-glaze-zine.pdf`,
    },
    { title: "Hidden bowl", price_cents: 1500 },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const byTitle = (title: string) => products.find((product) => product.title === title)!.id;
  const seeded: Seeded = {
    sellerId,
    storefrontId,
    store,
    vase: byTitle("Stoneware vase"),
    zine: byTitle("Glaze zine"),
    unplaced: byTitle("Hidden bowl"),
  };

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        ...(checkoutPage ? { checkoutPage } : {}),
        blocks: [
          { type: "product", productId: seeded.vase, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.zine, x: 2, y: 0, w: 2, h: 2 },
        ],
      },
    },
  });

  // Delivery PRICED, which is what lets a physical product use checkout: a
  // rate for Ireland and one for the rest of the EU list, in euro.
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "IE",
        dispatch: "Packed and posted within 2 days",
        ratesCurrency: "EUR",
        destinations: [
          { area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 },
          { area: "Rest of Europe", time: "3-5 days", countries: ["DE", "FR", "NL"], rateCents: 1200 },
        ],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return seeded;
}

const productUrl = (s: Seeded, id: string) => `/s/${s.storefrontId}/p/${id}`;

/**
 * Press Pay. It stays disabled until the bot check (when this deployment has
 * one) has answered, which is the point of it, so wait for it to be pressable
 * rather than clicking a disabled button and waiting for nothing.
 */
async function pay(page: Page) {
  const button = page.locator("form [data-checkout-pay]");
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
}

/** Skip the whole file when the stack was started without test payments. */
async function checkoutOffered(page: Page, s: Seeded): Promise<boolean> {
  const response = await page.request.get(`${productUrl(s, s.vase)}/checkout?o=${SMALL}`, { maxRedirects: 0 });
  return response.status() === 200;
}

/**
 * Every place a page connector runs through words or over a page: points
 * along each line, in screen space, that fall inside a page's label row (its
 * title, device switch and close button) or well inside any card. A line may
 * TOUCH a card, where it arrives, so cards are shrunk before the test.
 */
async function connectorCrossings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const inside = (x: number, y: number, r: DOMRect, inset: number) =>
      x > r.left + inset && x < r.right - inset && y > r.top + inset && y < r.bottom - inset;
    const labels = [...document.querySelectorAll("[data-artboard-label]")].map((el) => el.getBoundingClientRect());
    const cards = [...document.querySelectorAll("[data-canvas-board], [data-artboard-card]")].map((el) =>
      el.getBoundingClientRect(),
    );
    const found: string[] = [];
    for (const group of document.querySelectorAll<SVGGElement>("[data-connector]")) {
      const path = group.querySelector("path");
      const matrix = path?.getScreenCTM();
      if (!path || !matrix) continue;
      const length = path.getTotalLength();
      for (let at = 0; at <= length; at += 4) {
        const p = new DOMPoint(path.getPointAtLength(at).x, path.getPointAtLength(at).y).matrixTransform(matrix);
        if (labels.some((r) => inside(p.x, p.y, r, -2)) || cards.some((r) => inside(p.x, p.y, r, 8))) {
          found.push(`${group.dataset.connector} at ${Math.round(p.x)},${Math.round(p.y)}`);
          break;
        }
      }
    }
    return found;
  });
}

test.describe("hosted checkout", () => {
  test("a buyer checks out a physical product and lands on their order page", async ({ page }) => {
    const s = await seed(page, "co-buy", {
      layout: "showcase",
      giftMessage: true,
      celebrate: "confetti",
      note: "Every vase is thrown by hand in our Galway studio.",
      thanksMessage: "It will be wrapped in paper from our own press.",
    });
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // The product page's button now leads to checkout, carrying the version.
    await page.goto(`${productUrl(s, s.vase)}?o=${LARGE}&q=2`);
    const cta = page.locator("[data-product-cta='checkout']").first();
    await expect(cta).toBeVisible();
    const href = await cta.locator("a").getAttribute("href");
    expect(href).toContain(`/checkout?o=${LARGE}`);
    expect(href).toContain("q=2");
    await cta.locator("a").click();

    await expect(page.locator("[data-checkout-page='public']")).toBeVisible();
    await expect(page.locator("[data-checkout-layout]")).toHaveAttribute("data-checkout-layout", "showcase");
    await expect(page.locator("[data-checkout-version]")).toContainText("Large");
    await expect(page.locator("[data-checkout-note]")).toContainText("thrown by hand");
    // Two vases at €24 plus €4.50 to Ireland (the seller ships from IE, so the
    // picker starts there).
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "5250");

    await page.getByLabel("Email").fill("aoife.byrne@example.test");
    await page.getByLabel("Full name").fill("Aoife Byrne");
    await page.getByLabel("Address", { exact: true }).fill("12 Harbour Road");
    await page.getByLabel("Town or city").fill("Galway");
    await page.getByLabel("Postcode").fill("H91 X2Y3");
    await page.getByLabel("Add a gift message").check();
    await page.getByLabel("Gift message", { exact: true }).fill("Happy birthday, Mam!");

    await pay(page);
    await expect(page).toHaveURL(new RegExp(`/s/${s.storefrontId}/order/[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}\\?placed=1$`), {
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank you, Aoife!");
    await expect(page.locator("[data-celebration='confetti']")).toBeAttached();
    await expect(page.locator("[data-order-total]")).toHaveAttribute("data-order-total", "5250");
    await expect(page.locator("[data-order-step='preparing']")).toContainText("Packed and posted within 2 days");
    await expect(page.locator("[data-order-summary]")).toContainText("Galway");
    await expect(page.locator("[data-order-summary]")).not.toContainText("12 Harbour Road");

    // The order is the writer's: channel direct, the server's price, the gift
    // message kept, the stock taken.
    const [order] = (await serviceRest(
      `/orders?seller_id=eq.${s.sellerId}&select=channel,amount_cents,quantity,gift_message,selected_options,storefront_id,checkout_session_id`,
    )) as {
      channel: string;
      amount_cents: number;
      quantity: number;
      gift_message: string;
      selected_options: { label: string; value: string }[];
      storefront_id: string;
      checkout_session_id: string;
    }[];
    expect(order).toMatchObject({
      channel: "direct",
      amount_cents: 5250,
      quantity: 2,
      gift_message: "Happy birthday, Mam!",
      storefront_id: s.storefrontId,
    });
    expect(order.selected_options).toEqual([{ label: "Size", value: "Large" }]);
    expect(order.checkout_session_id).toMatch(/^cs_sstest_[0-9a-f]{32}$/);
    const [product] = (await serviceRest(`/products?id=eq.${s.vase}&select=stock_quantity`)) as {
      stock_quantity: number;
    }[];
    expect(product.stock_quantity).toBe(7);

    // The buyer's confirmation: the contract, on a durable medium.
    await expect
      .poll(async () => (await devEmails("aoife.byrne@example.test")).find((m) => m.subject.includes(s.store))?.text ?? "")
      .toContain("Total paid: €52.50");
    const confirmation = (await devEmails("aoife.byrne@example.test")).find((m) => m.subject.includes(s.store))!;
    expect(confirmation.text).toContain("Delivery: €4.50");
    expect(confirmation.text).toContain(PUBLISHABLE_SELLER.address.split("\n")[0]);
    expect(confirmation.text).toContain("withdraw");
    expect(confirmation.fromName).toBe(`${s.store} via Square Share`);
  });

  test("a download needs the buyer's consent, and its order page hands out the file", async ({ page }) => {
    const s = await seed(page, "co-digital");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    await page.goto(`${productUrl(s, s.zine)}/checkout`);
    await expect(page.getByLabel("Full name")).toHaveCount(0);
    await page.getByLabel("Email").fill("reader@example.test");
    await pay(page);
    await expect(page.locator("[data-checkout-error]")).toContainText("Tick the box");

    await page.locator("[data-checkout-consent] input").check();
    await pay(page);
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 });
    await expect(page.locator("[data-order-download]")).toBeVisible();
    // Consented to immediate supply: no withdrawal function to offer.
    await expect(page.locator("[data-order-withdrawal]")).toHaveCount(0);
    const [order] = (await serviceRest(
      `/orders?seller_id=eq.${s.sellerId}&select=supply_consent_at,digital_file_key,fulfilment_status`,
    )) as { supply_consent_at: string | null; digital_file_key: string | null; fulfilment_status: string }[];
    expect(order.supply_consent_at).not.toBeNull();
    expect(order.digital_file_key).toContain("glaze-zine.pdf");
    expect(order.fulfilment_status).toBe("not_required");
  });

  test("the withdrawal function takes the buyer's word, once, and tells both sides", async ({ page }) => {
    const s = await seed(page, "co-withdraw");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    await page.goto(`${productUrl(s, s.vase)}/checkout?o=${SMALL}`);
    await page.getByLabel("Email").fill("changed.mind@example.test");
    await page.getByLabel("Full name").fill("Sam Doyle");
    await page.getByLabel("Address", { exact: true }).fill("3 Quay Street");
    await page.getByLabel("Town or city").fill("Cork");
    await page.getByLabel("Postcode").fill("T12 AB34");
    await pay(page);
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 });

    await page.getByRole("button", { name: "Withdraw from contract here" }).click();
    await page.getByLabel("Your name").fill("Sam Doyle");
    await page.getByLabel("Your email").fill("someone.else@example.test");
    await page.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(page.locator("[data-order-withdraw-form] [role=alert]")).toContainText("doesn't match");

    await page.getByLabel("Your email").fill("changed.mind@example.test");
    await page.getByRole("button", { name: "Confirm withdrawal" }).click();
    await expect(page.locator("[data-order-withdrawal='done']")).toBeVisible();

    const [order] = (await serviceRest(
      `/orders?seller_id=eq.${s.sellerId}&select=withdrawal_requested_at`,
    )) as { withdrawal_requested_at: string | null }[];
    expect(order.withdrawal_requested_at).not.toBeNull();
    await expect
      .poll(async () => (await devEmails("changed.mind@example.test")).some((m) => m.subject.includes("withdrawal")))
      .toBe(true);

    // Reloading shows the record, not the button.
    await page.reload();
    await expect(page.locator("[data-order-withdrawal='done']")).toBeVisible();
  });

  test("the price is the server's, the route is same-origin, and nothing unsold is reachable", async ({ page }) => {
    const s = await seed(page, "co-guard");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const api = `/api/checkout/${s.storefrontId}/${s.vase}`;
    const body = {
      // Fresh per run: an attempt id that already paid for someone else's
      // order is refused, never answered with that order (provider.ts).
      attemptId: crypto.randomUUID(),
      optionIds: [SMALL],
      quantity: 1,
      email: "tester@example.test",
      locale: "en",
      shipTo: { name: "T Ester", line1: "1 Main St", city: "Galway", postalCode: "H91", country: "IE" },
      // Cloudflare's documented dummy token, which its always-pass TEST secret
      // accepts. Harmless when this deployment has no Turnstile configured.
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    };
    const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

    // A body that names a price is refused outright (strict schema).
    const priced = await page.request.post(api, { headers: sameOrigin, data: { ...body, amountCents: 1 } });
    expect(priced.status()).toBe(400);

    // Another site's page cannot place an order through a buyer's browser.
    const crossSite = await page.request.post(api, {
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      data: body,
    });
    expect(crossSite.status()).toBe(403);

    // An unavailable version is refused, never swapped for an available one.
    const soldOutVersion = await page.request.post(api, {
      headers: sameOrigin,
      data: { ...body, optionIds: [SOLD_OUT_SIZE] },
    });
    expect(soldOutVersion.status()).toBe(409);
    expect(await soldOutVersion.json()).toMatchObject({ ok: false, error: "options" });

    // A country the seller does not deliver to.
    const farAway = await page.request.post(api, {
      headers: sameOrigin,
      data: { ...body, shipTo: { ...body.shipTo, country: "US" } },
    });
    expect(await farAway.json()).toMatchObject({ ok: false, error: "not_shipped_here" });

    // A good order is charged what the SERVER says: €24 + €4.50.
    const placed = await page.request.post(api, { headers: sameOrigin, data: body });
    expect(placed.status()).toBe(201);
    const [order] = (await serviceRest(`/orders?seller_id=eq.${s.sellerId}&select=amount_cents`)) as {
      amount_cents: number;
    }[];
    expect(order.amount_cents).toBe(2850);

    // Pressing Pay twice records one order.
    const again = await page.request.post(api, { headers: sameOrigin, data: body });
    expect(again.status()).toBe(201);
    expect((await serviceRest(`/orders?seller_id=eq.${s.sellerId}&select=id`)) as unknown[]).toHaveLength(1);

    // A product that is not on the storefront has no checkout.
    expect((await page.request.get(`${productUrl(s, s.unplaced)}/checkout`)).status()).toBe(404);
    // An order link that proves nothing is a 404.
    const forged = `/s/${s.storefrontId}/order/00000000-0000-4000-8000-000000000000.${"A".repeat(43)}`;
    expect((await page.request.get(forged)).status()).toBe(404);
  });
  test("the seller designs the checkout on the canvas, chained on from the product page", async ({ page }) => {
    // The editor works whether or not buyers can reach checkout yet, so this
    // one does not skip: it is how a seller designs it before connecting.
    const s = await seed(page, "co-editor");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByLabel(/^stoneware vase. press enter/i).click();
    await canvasStill(page);
    // Straight from the tile: its quick bar opens the checkout, and with it
    // the product page the checkout hangs off.
    await page.getByRole("button", { name: /^show the checkout for stoneware vase$/i }).click();
    const productPage = page.locator(`[data-artboard-id="${s.vase}"]`);
    const checkout = page.locator(`[data-artboard-id="checkout:${s.vase}"]`);
    const thanks = page.locator(`[data-artboard-id="thanks:${s.vase}"]`);
    await expect(productPage).toBeVisible();
    await expect(checkout.locator("[data-checkout-page='preview']")).toBeVisible();
    await expect(thanks.locator("[data-order-page='preview']")).toBeVisible();
    // Three lines: board to page, page to checkout, checkout to thank-you.
    await expect(page.locator("[data-page-connectors]")).toHaveAttribute("data-page-connectors", "3");
    // None of them runs through a page's label row, or across a page.
    await canvasStill(page);
    expect(await connectorCrossings(page)).toEqual([]);
    // The panel arrived on the checkout's own settings.
    const arrangement = page.getByRole("group", { name: "Arrangement" });
    await expect(arrangement).toBeVisible();

    // The bottom toolbar's Checkout puts it away; the product page's own frame
    // brings it back.
    const toolbarCheckout = page.locator("[data-toolbar-checkout]");
    await expect(toolbarCheckout).toHaveAttribute("aria-pressed", "true");
    await toolbarCheckout.click();
    await expect(checkout).toHaveCount(0);
    await expect(productPage).toBeVisible();
    await page.getByRole("button", { name: /^open the checkout for stoneware vase$/i }).click();
    await expect(checkout.locator("[data-checkout-page='preview']")).toBeVisible();

    // The arrangement changes the artboard at once.
    await expect(checkout.locator("[data-checkout-layout]")).toHaveAttribute("data-checkout-layout", "showcase");
    await arrangement.getByRole("button", { name: "Compact" }).click();
    await expect(checkout.locator("[data-checkout-layout]")).toHaveAttribute("data-checkout-layout", "compact");

    // Clicking the pay button leads to the PRODUCT page's button settings:
    // it is the same button.
    await checkout.locator("form [data-checkout-pay]").click({ force: true });
    await expect(page.getByLabel("Button text")).toBeVisible();

    // The words are typed straight onto the page: the headline...
    await checkout.locator("[data-editable-text='headline']").click();
    await page.keyboard.type("Nearly there");
    await page.keyboard.press("Enter");
    await expect(checkout.locator("h1[data-editable-text='headline']")).toHaveText("Nearly there");

    // ...and the note, where a link is refused as it is typed, before any save.
    await checkout.locator("[data-editable-text='note']").click();
    await page.keyboard.type("Pay me at clayhouse.shop instead");
    await expect(checkout.getByText(/links, email addresses and bank details/i)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Every vase is thrown by hand.");
    await page.keyboard.press("Escape");
    await expect(checkout.locator("[data-checkout-note]")).toContainText("thrown by hand");
    // The panel holds the same words: one config, two ways in.
    await checkout.locator("[data-checkout-note] figcaption").click();
    await expect(page.getByRole("textbox", { name: "Note to buyers" })).toHaveValue("Every vase is thrown by hand.");

    // The thank-you page's celebration, from the thank-you artboard's hero.
    await thanks.locator("[data-order-hero]").click({ position: { x: 4, y: 4 } });
    await page.getByRole("group", { name: "Celebration" }).getByRole("button", { name: "Light" }).click();
    await expect(thanks.locator("[data-celebration='rays']")).toBeAttached();

    // A second product's page lands past the whole chain, so its line has to
    // get over three pages: it climbs above their labels rather than through.
    await page.getByLabel(/^glaze zine. press enter/i).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for glaze zine$/i }).click();
    await expect(page.locator(`[data-artboard-id="${s.zine}"]`)).toBeVisible();
    await expect(page.locator("[data-page-connectors]")).toHaveAttribute("data-page-connectors", "4");
    await canvasStill(page);
    expect(await connectorCrossings(page)).toEqual([]);

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    const [row] = (await serviceRest(`/storefronts?id=eq.${s.storefrontId}&select=config`)) as {
      config: { checkoutPage?: Record<string, unknown> };
    }[];
    expect(row.config.checkoutPage).toMatchObject({
      layout: "compact",
      headline: "Nearly there",
      note: "Every vase is thrown by hand.",
      celebrate: "rays",
    });
  });
  test("the checkout and the order page pass an accessibility scan", async ({ page }) => {
    const s = await seed(page, "co-a11y", {
      layout: "showcase",
      giftMessage: true,
      celebrate: "none",
      note: "Every vase is thrown by hand.",
    });
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    /** WCAG 2 A and AA, on the page as a buyer has it once it has settled.
     *  The bot check's own iframe is Cloudflare's, not ours to audit. */
    const scan = async () =>
      (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa"]).analyze()).violations;

    await page.goto(`${productUrl(s, s.vase)}/checkout?o=${SMALL}`);
    await expect(page.locator("[data-checkout-page='public']")).toBeVisible();
    await page.getByLabel("Add a gift message").check();
    expect(await scan()).toEqual([]);

    await page.getByLabel("Email").fill("scan@example.test");
    await page.getByLabel("Full name").fill("Rosa Byrne");
    await page.getByLabel("Address", { exact: true }).fill("1 Quay Street");
    await page.getByLabel("Town or city").fill("Galway");
    await page.getByLabel("Postcode").fill("H91 AB12");
    await page.getByLabel("Gift message", { exact: true }).fill("For you");
    await pay(page);
    await expect(page).toHaveURL(/\/order\//, { timeout: 20_000 });
    await expect(page.locator("[data-order-page='public']")).toBeVisible();
    expect(await scan()).toEqual([]);
  });
  test("delivery priced in Settings is what checkout charges", async ({ page }) => {
    // The seller prices delivery through the real Settings form (not seeded),
    // and the checkout's total follows it.
    const s = await seed(page, "co-rates");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    // Start from terms with no rates at all, so checkout depends on the form.
    await serviceRest(`/profiles?id=eq.${s.sellerId}`, {
      method: "PATCH",
      body: { shipping_policy: { shipsFrom: "IE", dispatch: "Packed and posted within 2 days" } },
    });

    await gotoApp(page, "/settings/shipping");
    await page.getByRole("button", { name: "Add a destination" }).click();
    await page.getByLabel("Destination 1", { exact: true }).fill("Ireland");
    await page.getByLabel("Delivery time 1", { exact: true }).fill("1-2 days");
    await page.getByLabel("Rate 1", { exact: true }).fill("3.95");
    await page.getByRole("button", { name: "No countries" }).click();
    await page.getByRole("checkbox", { name: "Ireland" }).check();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(`/profiles?id=eq.${s.sellerId}&select=shipping_policy`)) as {
          shipping_policy: { destinations?: { countries?: string[]; rateCents?: number }[] };
        }[];
        return row.shipping_policy.destinations?.[0];
      })
      .toMatchObject({ countries: ["IE"], rateCents: 395 });

    await page.goto(`${productUrl(s, s.vase)}/checkout?o=${SMALL}`);
    await expect(page.locator("[data-checkout-line='delivery']")).toHaveAttribute("data-cents", "395");
    await expect(page.locator("[data-checkout-total]")).toHaveAttribute("data-checkout-total", "2795");
  });
  test("purchase pages carry no-referrer and no-store, and email guessing is capped per order", async ({ page }) => {
    const s = await seed(page, "co-headers");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

    // A real order for a download, so there is a real order link to inspect.
    const placed = await page.request.post(`/api/checkout/${s.storefrontId}/${s.zine}`, {
      headers: sameOrigin,
      data: {
        attemptId: crypto.randomUUID(),
        optionIds: [],
        quantity: 1,
        email: "guessme@example.test",
        locale: "en",
        supplyConsent: true,
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      },
    });
    expect(placed.status()).toBe(201);
    const { orderUrl } = (await placed.json()) as { orderUrl: string };
    const ref = decodeURIComponent(orderUrl.split("/order/")[1]!.split("?")[0]!);

    // The order page is a credential: it must not travel in a Referer or sit
    // in any cache, and search engines must not keep it.
    for (const url of [
      orderUrl,
      `/s/${s.storefrontId}/orders`,
      `${productUrl(s, s.vase)}/checkout?o=${SMALL}`,
    ]) {
      const response = await page.request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()["referrer-policy"], url).toBe("no-referrer");
      // Next serves dynamic pages as no-store in production and only
      // no-cache under `next dev` (base-server.js overrides it there); both
      // forbid a shared cache from serving a stored copy without asking.
      expect(response.headers()["cache-control"], url).toMatch(/no-store|no-cache/);
      expect(response.headers()["x-robots-tag"], url).toContain("noindex");
    }
    // The API answers carry the same, and a 302 to storage still hides the page.
    const denied = await page.request.post("/api/orders/withdraw", {
      headers: sameOrigin,
      data: { orderRef: ref, name: "X Y", email: "wrong0@example.test", locale: "en" },
    });
    expect(denied.headers()["referrer-policy"]).toBe("no-referrer");
    expect(denied.headers()["cache-control"]).toContain("no-store");

    // Guessing the second factor is bounded PER ORDER: the wrong email gets 403
    // until the order's budget is spent, then 429, and the right one never
    // gets a look-in once it is.
    const statuses: number[] = [denied.status()];
    for (let guess = 1; guess < 10; guess += 1) {
      const response = await page.request.post("/api/orders/withdraw", {
        headers: sameOrigin,
        data: { orderRef: ref, name: "X Y", email: `wrong${guess}@example.test`, locale: "en" },
      });
      statuses.push(response.status());
    }
    expect(statuses[0]).toBe(403);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 403).length).toBeLessThanOrEqual(8);
  });
});
