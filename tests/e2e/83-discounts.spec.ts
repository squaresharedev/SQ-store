import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  anonRest,
  devEmails,
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
 * DISCOUNTS, end to end, with the development TEST payment provider.
 *
 * A seller creates a code and a sale in the Discounts tab. A buyer sees the
 * sale on the product page (with the struck-through price only where 30 days
 * of price history prove it), types codes at checkout and pays whichever price
 * is lower. The order records what was taken off and which code the buyer came
 * with, and the Discounts tab credits it to the channel the code was shared
 * on. Then the parts that must hold however a request is built: the code check
 * gives nothing away, a total the buyer did not see is refused, and no client
 * role can read a store's codes.
 *
 * NEEDS the stack started with CHECKOUT_TEST_PAYMENTS=1, like 78-checkout:
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

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

type Seeded = {
  sellerEmail: string;
  sellerId: string;
  storefrontId: string;
  store: string;
  /** €24, and it has cost €24 for 40 days: a sale may strike that through. */
  vase: string;
  /** €38, listed 90 days ago with its first price on record only today: a
   *  sale lowers it and crosses €38 out, but can claim no percentage. */
  apron: string;
};

async function seed(page: Page, tag: string): Promise<Seeded> {
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
    { title: "Stoneware vase", price_cents: 2400 },
    { title: "Linen apron", price_cents: 3800 },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const byTitle = (title: string) => products.find((product) => product.title === title)!.id;
  const seeded: Seeded = {
    sellerEmail: user.email,
    sellerId,
    storefrontId,
    store,
    vase: byTitle("Stoneware vase"),
    apron: byTitle("Linen apron"),
  };

  // The price trigger wrote each product's first price just now. The vase's is
  // moved back, as if it had been on sale at €24 for 40 days.
  await serviceRest(`/product_price_history?product_id=eq.${seeded.vase}`, {
    method: "PATCH",
    body: { valid_from: ago(40) },
  });
  // The apron is older than its records: listed 90 days ago, with nothing on
  // file about what it cost until today.
  await serviceRest(`/products?id=eq.${seeded.apron}`, { method: "PATCH", body: { created_at: ago(90) } });

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [
          { type: "product", productId: seeded.vase, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.apron, x: 2, y: 0, w: 2, h: 2 },
        ],
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
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return seeded;
}

const productUrl = (s: Seeded, id: string) => `/s/${s.storefrontId}/p/${id}`;
const checkoutApi = (s: Seeded, id: string) => `/api/checkout/${s.storefrontId}/${id}`;
const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

/** Skip when the stack was started without test payments. */
async function checkoutOffered(page: Page, s: Seeded): Promise<boolean> {
  const response = await page.request.get(`${productUrl(s, s.vase)}/checkout`, { maxRedirects: 0 });
  return response.status() === 200;
}

/** A discount written straight to the table, as the seller's own row. */
async function seedDiscount(s: Seeded, columns: Record<string, unknown>) {
  const [row] = (await serviceRest(`/discounts`, {
    method: "POST",
    body: { owner_id: s.sellerId, value_type: "percent", ...columns },
  })) as { id: string }[];
  return row.id;
}

const seedCode = (s: Seeded, code: string, percentOff: number, channel: string | null = null) =>
  seedDiscount(s, { kind: "code", code, share_channel: channel, percent_off: percentOff });

type DiscountRow = {
  id: string;
  kind: string;
  code: string | null;
  percent_off: number | null;
  starts_at: string;
  ends_at: string | null;
};
const discountsOf = async (s: Seeded) =>
  (await serviceRest(
    `/discounts?owner_id=eq.${s.sellerId}&select=id,kind,code,percent_off,starts_at,ends_at`,
  )) as DiscountRow[];

type OrderRow = {
  amount_cents: number;
  product_price_cents: number;
  quantity: number;
  discount_cents: number;
  discount_id: string | null;
  discount_code_id: string | null;
  discount_code: string | null;
  buyer_email: string;
};
const ordersOf = async (s: Seeded) =>
  (await serviceRest(
    `/orders?seller_id=eq.${s.sellerId}&select=amount_cents,product_price_cents,quantity,discount_cents,discount_id,discount_code_id,discount_code,buyer_email&order=created_at.asc`,
  )) as OrderRow[];

/** Open the code field (client state, so retried past hydration), type and apply. */
async function applyCode(page: Page, code: string) {
  const field = page.getByLabel("Discount code");
  await expect(async () => {
    const closed = page.locator("[data-checkout-discount='closed']");
    if (await closed.isVisible()) await closed.click();
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await field.fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
}

async function fillAddress(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Aoife Byrne");
  await page.getByLabel("Address", { exact: true }).fill("12 Harbour Road");
  await page.getByLabel("Town or city").fill("Galway");
  await page.getByLabel("Postcode").fill("H91 X2Y3");
}

async function pay(page: Page) {
  const button = page.locator("form [data-checkout-pay]");
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page).toHaveURL(/\/order\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}\?placed=1$/, { timeout: 20_000 });
}

const total = (page: Page) => page.locator("[data-checkout-total]");
const discountLine = (page: Page) => page.locator("[data-checkout-line='discount']");

/**
 * Click a link and wait for its page. Retried on purpose: the first visit to a
 * route waits on the dev server compiling it, and a client navigation that
 * starts while the dashboard's start-up server actions are still in flight can
 * fail to commit (a known race in the notification bell's bootstrap, nothing
 * to do with these pages).
 */
async function follow(page: Page, link: Locator, url: RegExp) {
  await expect(async () => {
    if (!url.test(page.url())) await link.click({ timeout: 5_000 });
    await page.waitForURL(url, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

/** The discount form on the page, once it is there to be used. It draws a
 *  placeholder until the browser has said what time it is, so being visible
 *  also means it has hydrated and will keep what is typed into it. */
async function discountForm(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const form = page.locator("[data-discount-form]");
  await expect(form).toBeVisible({ timeout: 20_000 });
  return form;
}

/** Follow `link` to the new-discount form. */
async function openNewDiscount(page: Page, link: Locator) {
  await follow(page, link, /\/discounts\/new$/);
  return discountForm(page);
}

/** WCAG 2 A and AA on the page as it stands. The dev overlay is not ours. */
const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).exclude("nextjs-portal").withTags(["wcag2a", "wcag2aa"]).analyze()).violations;

/** From the list, open one discount's edit form. */
async function openEdit(page: Page, id: string) {
  const edit = page.locator(`[data-discount-row='${id}']`).getByRole("link", { name: "Edit" });
  await follow(page, edit, new RegExp(`/discounts/${id}/edit$`));
  return discountForm(page);
}

test.describe("discounts", () => {
  test("a seller shares a code and runs a sale; the buyer pays the lower price and the channel gets the credit", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    const s = await seed(page, "disc");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // 1. THE TAB. In the menu, and empty until the first discount.
    await gotoApp(page, "/dashboard");
    await follow(
      page,
      page.getByRole("link", { name: "Discounts", exact: true }).filter({ visible: true }).first(),
      /\/discounts$/,
    );
    const empty = page.locator("[data-discounts-empty]");
    await expect(empty).toContainText("No discounts yet");

    // 2. A CODE, shared on Instagram. A sale is the default, and a code
    //    arrives filled in; this one is typed over.
    let form = await openNewDiscount(page, empty.getByRole("link", { name: "Create discount" }).last());
    await expect(async () => {
      await form.locator("[data-discount-kind-option='code']").click();
      const code = form.getByLabel("Code", { exact: true });
      await expect(code).not.toHaveValue("", { timeout: 1_000 });
      await code.fill("insta10");
      await expect(code).toHaveValue("INSTA10", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await form.getByRole("button", { name: "Instagram" }).click();
    await expect(form.getByLabel("Shared on (optional)")).toHaveValue("Instagram");
    const summary = form.locator("[data-discount-summary]");
    await expect(summary).toContainText("INSTA10 · 10% off the order · All products");
    await expect(summary).toContainText("Example: Linen apron at €38.00 costs €34.20.");
    await form.getByRole("button", { name: "Create discount" }).click();
    await expectToast(page, "Discount created.");
    await page.waitForURL(/\/discounts$/, { timeout: 30_000 });
    const codeRow = page.locator("[data-discount-kind='code']");
    await expect(codeRow).toHaveAttribute("data-discount-status", "active");
    await expect(codeRow.locator("[data-discount-code]")).toHaveText("INSTA10");
    for (const fact of ["10% off the order", "All products", "Shared on Instagram"]) {
      await expect(codeRow).toContainText(fact);
    }

    // 3. A SALE (the default): 25% off everything, for a week.
    form = await openNewDiscount(page, page.getByRole("link", { name: "Create discount" }));
    await expect(form.locator("[data-discount-kind-option='automatic'] input")).toBeChecked();
    await expect(form.getByLabel("Code", { exact: true })).toHaveCount(0);
    await form.getByLabel("Percentage off").fill("25");
    await form.getByRole("button", { name: "1 week" }).click();
    await expect(form.locator("[data-discount-summary]")).toContainText("25% off each item · All products");
    await expect(form.locator("[data-discount-summary]")).toContainText("Example: Linen apron at €38.00 costs €28.50.");
    await form.getByRole("button", { name: "Create discount" }).click();
    await expectToast(page, "Discount created.");
    await page.waitForURL(/\/discounts$/, { timeout: 30_000 });
    const saleRow = page.locator("[data-discount-kind='automatic']");
    await expect(saleRow).toHaveAttribute("data-discount-status", "active");
    await expect(saleRow).toContainText("25% off each item");
    await expect(saleRow).toContainText("Ends ");
    // The ticket opens to show what the sale covers, and what each now costs.
    await expect(async () => {
      const scope = saleRow.getByRole("button", { name: "All products" });
      if ((await scope.getAttribute("aria-expanded")) !== "true") await scope.click();
      await expect(saleRow.locator("[data-discount-products]")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const covered = saleRow.locator("[data-discount-products] li");
    await expect(covered.filter({ hasText: "Linen apron" })).toContainText("Was €38.00, now €28.50");
    await expect(covered.filter({ hasText: "Stoneware vase" })).toContainText("Was €24.00, now €18.00");

    const made = await discountsOf(s);
    const insta = made.find((row) => row.code === "INSTA10")!;
    const sale = made.find((row) => row.kind === "automatic")!;
    expect(made).toHaveLength(2);

    // 4. THE BUYER, signed in to nothing, sees the sale.
    const context = await browser.newContext();
    const buyer = await context.newPage();
    await buyer.goto(productUrl(s, s.vase));
    const vasePrice = buyer.locator("[data-product-price='1800']").filter({ visible: true }).first();
    // €24 for the 30 days before: the reduction is announced against it.
    await expect(vasePrice.locator("[data-product-sale]")).toContainText("Was €24.00, now €18.00");
    await expect(vasePrice.locator("del")).toHaveText("€24.00");
    // The percent, the end and what the struck price is, on the sale's ticket.
    const saleTicket = buyer.locator("[data-product-sale-ticket]").filter({ visible: true }).first();
    await expect(saleTicket.locator("[data-product-sale-percent]")).toHaveText("-25%");
    await expect(saleTicket).toContainText("Sale ends ");
    await expect(buyer.getByText("Crossed-out price: the lowest price in the 30 days before this sale.")).toBeVisible();
    await expect(buyer.locator("[data-product-sale-ends]").filter({ visible: true }).first()).toContainText("Sale ends ");
    const jsonLd = JSON.parse((await buyer.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(jsonLd.offers.price).toBe("18.00");
    expect(jsonLd.offers.priceValidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The page tells a browser the terms, never which discount or whose.
    const html = await buyer.content();
    expect(html).not.toContain(sale.id);
    expect(html).not.toContain(insta.id);
    expect(html).not.toContain("INSTA10");

    // The apron's earlier prices are not on record. A buyer still sees what the
    // sale takes it down from, the regular price crossed out; what the page
    // does not do is claim a percentage, or that €38 was the lowest price of
    // the last 30 days. Its ticket calls the crossed-out price what it is.
    await buyer.goto(productUrl(s, s.apron));
    const apronPrice = buyer.locator("[data-product-price='2850']").filter({ visible: true }).first();
    await expect(apronPrice.locator("[data-product-sale]")).toContainText("Was €38.00, now €28.50");
    await expect(apronPrice.locator("del")).toHaveText("€38.00");
    const apronTicket = buyer.locator("[data-product-sale-ticket='regular']").filter({ visible: true }).first();
    await expect(apronTicket).toContainText("Crossed-out price: the regular price.");
    await expect(buyer.locator("[data-product-sale-percent]")).toHaveCount(0);
    await expect(buyer.getByText(/lowest price in the 30 days/)).toHaveCount(0);

    // 5. CHECKOUT. The sale price, plus €4.50 to Ireland.
    await buyer.goto(`${productUrl(s, s.vase)}/checkout`);
    await expect(buyer.locator("[data-checkout-page='public']")).toBeVisible();
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "2250");

    // A code that does not exist is refused in one plain sentence.
    await applyCode(buyer, "NOPE99");
    await expect(buyer.locator("[data-checkout-discount='open'] [role=alert]")).toHaveText(
      "This code can't be used for this order.",
    );
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "2250");

    // INSTA10 is real, but 10% is less than the sale: the sale price stays,
    // and the buyer is told why nothing changed.
    await applyCode(buyer, "insta10");
    await expect(buyer.locator("[data-checkout-discount='applied']")).toContainText(
      "INSTA10 works, but your sale price is already lower, so we kept it.",
    );
    await expect(discountLine(buyer)).toHaveCount(0);
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "2250");

    await fillAddress(buyer, "aoife.byrne@example.test");
    await pay(buyer);
    await expect(buyer.locator("[data-order-total]")).toHaveAttribute("data-order-total", "2250");

    // The order: the regular price, what came off, the sale that set the price
    // and the code the buyer came with.
    let orders = await ordersOf(s);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      amount_cents: 2250,
      product_price_cents: 2400,
      discount_cents: 600,
      discount_id: sale.id,
      discount_code_id: insta.id,
      discount_code: "INSTA10",
    });

    // 6. A CODE THAT BEATS THE SALE replaces it, from the regular price.
    const vip = await seedCode(s, "VIP40", 40, "Newsletter");
    await buyer.goto(`${productUrl(s, s.vase)}/checkout`);
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "2250");
    await applyCode(buyer, "vip40");
    await expect(buyer.locator("[data-checkout-discount='applied']")).toContainText("VIP40 applied.");
    await expect(buyer.locator("[data-checkout-discount='applied']")).toHaveAttribute(
      "data-checkout-discount-state",
      "in-force",
    );
    await expect(buyer.locator("[data-checkout-discount='applied']")).toContainText("-40%");
    await expect(discountLine(buyer)).toContainText("Discount (VIP40)");
    await expect(discountLine(buyer)).toHaveAttribute("data-cents", "960");
    await expect(buyer.locator("[data-checkout-unit-price='2400']").first()).toBeVisible();
    // €24.00 - €9.60 + €4.50.
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "1890");

    // Removing it puts the sale price back; applying it again takes it off.
    await buyer.locator("[data-checkout-discount='applied']").getByRole("button", { name: "Remove" }).click();
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "2250");
    await applyCode(buyer, "VIP40");
    await expect(total(buyer)).toHaveAttribute("data-checkout-total", "1890");

    await fillAddress(buyer, "nora.walsh@example.test");
    await pay(buyer);
    await expect(buyer.locator("[data-order-total]")).toHaveAttribute("data-order-total", "1890");
    orders = await ordersOf(s);
    expect(orders).toHaveLength(2);
    expect(orders[1]).toMatchObject({
      amount_cents: 1890,
      product_price_cents: 2400,
      discount_cents: 960,
      discount_id: vip,
      discount_code_id: vip,
      discount_code: "VIP40",
    });

    // The buyer's confirmation adds up line by line; the seller's mail names the code.
    await expect
      .poll(async () => (await devEmails("nora.walsh@example.test")).find((m) => m.subject.includes(s.store))?.text ?? "")
      .toContain("Total paid: €18.90");
    const confirmation = (await devEmails("nora.walsh@example.test")).find((m) => m.subject.includes(s.store))!;
    expect(confirmation.text).toContain("Items: €24.00");
    expect(confirmation.text).toContain("Discount (VIP40): -€9.60");
    expect(confirmation.text).toContain("Delivery: €4.50");
    await expect
      .poll(async () => (await devEmails(s.sellerEmail)).some((m) => m.text.includes("Discount code: VIP40")))
      .toBe(true);
    await context.close();

    // 7. THE SELLER SEES WHERE THE BUYERS CAME FROM.
    await gotoApp(page, "/discounts");
    const performance = page.locator("[data-discount-performance]");
    await expect(performance.locator("[data-analytics-metric='discounts.orders']")).toHaveAttribute(
      "data-analytics-value",
      "2",
    );
    // €22.50 + €18.90 taken; €6.00 + €9.60 given.
    await expect(performance).toContainText("€41.40");
    await expect(performance).toContainText("€15.60");
    const channels = performance.locator("[data-analytics-panel='channels']");
    await expect(channels).toContainText("Instagram");
    await expect(channels).toContainText("Newsletter");
    // A bar for each channel, drawn to its length, not just the names.
    const bars = channels.locator(".recharts-bar-rectangle");
    await expect(bars).toHaveCount(2);
    await expect.poll(async () => (await bars.first().boundingBox())?.width ?? 0).toBeGreaterThan(40);
    await expect(page.locator(`[data-discount-row='${insta.id}'] [data-discount-orders]`)).toHaveAttribute(
      "data-discount-orders",
      "1",
    );
    await expect(page.locator(`[data-discount-row='${vip}'] [data-discount-orders]`)).toHaveAttribute(
      "data-discount-orders",
      "1",
    );

    // The populated page holds up to an accessibility scan.
    expect(await scan(page)).toEqual([]);

    // The order itself says which discount it had.
    await gotoApp(page, "/orders?view=all");
    await page.locator("tr", { hasText: "aoife.byrne@example.test" }).click();
    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail.locator("[data-order-discount]")).toContainText("Sale, €6.00 off");
    await expect(detail.locator("[data-order-discount]")).toContainText(
      "Code INSTA10 used, but the sale price was lower",
    );

    // 8. SWITCHING THE CODE OFF stops it at once.
    await gotoApp(page, "/discounts");
    const instaRow = page.locator(`[data-discount-row='${insta.id}']`);
    await expect(async () => {
      await instaRow.getByRole("switch", { name: "On" }).click();
      await expectToast(page, "Code switched off.", 3_000);
    }).toPass({ timeout: 20_000 });
    await expect(instaRow).toHaveAttribute("data-discount-status", "paused");
    const off = await page.request.post(`${checkoutApi(s, s.vase)}/discount`, {
      headers: SAME_ORIGIN,
      data: { code: "INSTA10" },
    });
    expect(off.status()).toBe(409);

    // 9. ENDING THE SALE puts the price back, after one confirmation.
    await page.locator(`[data-discount-row='${sale.id}']`).getByRole("button", { name: "End now" }).click();
    const confirm = page.getByRole("dialog", { name: "End this sale now?" });
    await confirm.getByRole("button", { name: "End sale" }).click();
    await expectToast(page, "Sale ended.");
    await expect(page.locator(`[data-discount-row='${sale.id}']`)).toHaveAttribute("data-discount-status", "ended");
    const after = await page.request.get(productUrl(s, s.vase));
    expect(await after.text()).toContain('data-product-price="2400"');

    // An ended sale is history: it cannot be edited back to life.
    await expect(page.locator(`[data-discount-row='${sale.id}']`).getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("a running code can change its terms, and a running sale only its end", async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seed(page, "disc-edit");
    // Both started two days ago, at a minute no half-hour slot lands on: the
    // form has to hand a stored moment back exactly, or the save is refused.
    const startedAt = new Date(Date.now() - 2 * day - 7 * 60_000).toISOString();
    const codeId = await seedDiscount(s, {
      kind: "code",
      code: "INSTA10",
      share_channel: "Instagram",
      percent_off: 10,
      starts_at: startedAt,
    });
    const saleId = await seedDiscount(s, { kind: "automatic", percent_off: 25, starts_at: startedAt });
    const stored = async (id: string) => (await discountsOf(s)).find((row) => row.id === id)!;
    const sameMoment = (a: string, b: string) => Date.parse(a) === Date.parse(b);

    // THE CODE: what it takes off can change. Its start is a fact by now.
    await gotoApp(page, "/discounts");
    let form = await openEdit(page, codeId);
    await expect(page.locator("[data-discount-kind-fixed='code']")).toHaveText("Edit discount code");
    await expect(form.getByRole("group", { name: "Starts" })).toHaveCount(0);
    await expect(form.locator("[data-discount-summary]")).toContainText("Started ");
    await expect(async () => {
      const percent = form.getByLabel("Percentage off");
      await percent.fill("15");
      await expect(percent).toHaveValue("15", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(form.locator("[data-discount-summary]")).toContainText("INSTA10 · 15% off the order");
    expect(await scan(page)).toEqual([]);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Discount saved.");
    await page.waitForURL(/\/discounts$/, { timeout: 30_000 });
    await expect(page.locator(`[data-discount-row='${codeId}']`)).toContainText("15% off the order");
    const code = await stored(codeId);
    expect(code.percent_off).toBe(15);
    expect(sameMoment(code.starts_at, startedAt), `start moved: ${code.starts_at}`).toBe(true);

    // THE SALE: what can change is said first, and only its end is offered.
    form = await openEdit(page, saleId);
    await expect(form.locator("[data-discount-locked]")).toContainText("only its end can change");
    await expect(form.getByLabel("Percentage off")).toHaveCount(0);
    await expect(form.getByRole("group", { name: "Percentage or amount" })).toHaveCount(0);
    await expect(form.locator("[data-discount-summary]")).toContainText("25% off each item");
    await expect(async () => {
      await form.getByRole("button", { name: "1 month" }).click();
      await expect(form.getByRole("group", { name: "Ends" }).getByRole("button", { name: "On a date" })).toHaveAttribute(
        "aria-pressed",
        "true",
        { timeout: 1_000 },
      );
    }).toPass({ timeout: 15_000 });
    await form.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Discount saved.");
    await page.waitForURL(/\/discounts$/, { timeout: 30_000 });
    await expect(page.locator(`[data-discount-row='${saleId}']`)).toContainText("Ends ");
    const sale = await stored(saleId);
    expect(sale.percent_off).toBe(25);
    expect(sameMoment(sale.starts_at, startedAt), `start moved: ${sale.starts_at}`).toBe(true);
    // About a month from now (28 to 31 days, give or take the minute it was pressed).
    const runDays = (Date.parse(sale.ends_at!) - Date.now()) / day;
    expect(runDays).toBeGreaterThan(27.9);
    expect(runDays).toBeLessThan(31.1);

    // A new discount scheduled for later opens on a moment still to come.
    form = await openNewDiscount(page, page.getByRole("link", { name: "Create discount" }));
    await expect(async () => {
      await form.getByRole("group", { name: "Starts" }).getByRole("button", { name: "Later" }).click();
      await expect(form.locator("[data-discount-summary]")).toContainText("Starts ", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(form.locator("[data-discount-summary]")).not.toContainText("Started");
    await form.getByLabel("Code", { exact: true }).fill("NEXTWEEK");
    await form.getByRole("button", { name: "Create discount" }).click();
    await expectToast(page, "Discount created.");
    await page.waitForURL(/\/discounts$/, { timeout: 30_000 });
    await expect(page.locator("[data-discount-row]", { hasText: "NEXTWEEK" })).toHaveAttribute(
      "data-discount-status",
      "scheduled",
    );
  });

  test("the seller reads dates in their own time zone, not the server's", async ({ browser }) => {
    test.setTimeout(180_000);
    // A browser half a day away from wherever this server runs. The server
    // renders in ITS zone (UTC once deployed); a date it rendered and the page
    // then kept would be hours out, and plain to see from here.
    const zone = "Pacific/Auckland";
    const context = await browser.newContext({ timezoneId: zone });
    const page = await context.newPage();
    const s = await seed(page, "disc-zone");
    const endsAt = new Date(Date.now() + 5 * day).toISOString();
    const codeId = await seedDiscount(s, {
      kind: "code",
      code: "ZONE10",
      percent_off: 10,
      starts_at: ago(2),
      ends_at: endsAt,
    });
    /** The clock time of that moment on a wall in `timeZone`. */
    const clock = (timeZone?: string) =>
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
        new Date(endsAt),
      );
    expect(clock(zone), "the two zones must differ for this to prove anything").not.toBe(clock());

    // Nothing the server and the browser disagree about may reach the page.
    const mismatches: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|didn't match|did not match/i.test(message.text())) {
        mismatches.push(message.text().slice(0, 200));
      }
    });

    await gotoApp(page, "/discounts");
    const schedule = page.locator(`[data-discount-row='${codeId}'] [data-discount-schedule]`);
    await expect(schedule).toContainText(`, ${clock(zone)}`);
    await expect(schedule).not.toContainText(`, ${clock()}`);

    const form = await openEdit(page, codeId);
    await expect(form.getByText(`Times are in your time zone (${zone}).`)).toBeVisible();
    await expect(form.locator("[data-discount-summary]")).toContainText(`Ends `);
    await expect(form.locator("[data-discount-summary]")).toContainText(`, ${clock(zone)}`);
    // The picker holds that same wall-clock time, and saving hands the moment
    // back untouched.
    await form.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Discount saved.");
    const [saved] = (await discountsOf(s)).filter((row) => row.id === codeId);
    expect(Date.parse(saved.ends_at!)).toBe(Date.parse(endsAt));
    expect(mismatches).toEqual([]);
    await context.close();
  });

  test("the code check gives nothing away, and a total the buyer did not see is refused", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const s = await seed(page, "disc-guard");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    await seedCode(s, "INSTA10", 10, "Instagram");
    const check = `${checkoutApi(s, s.vase)}/discount`;

    // A real code answers with its terms and nothing else: no id, no channel,
    // no count of how often it was used.
    const good = await page.request.post(check, { headers: SAME_ORIGIN, data: { code: "insta10" } });
    expect(good.status()).toBe(200);
    expect(await good.json()).toEqual({ ok: true, terms: { code: "INSTA10", value: { type: "percent", percentOff: 10 } } });
    expect(good.headers()["cache-control"]).toContain("no-store");

    // Every refusal is the same refusal: a code that never existed, one that
    // belongs to another store, one that is switched off.
    // (The other store signs up in its own browser: this one is signed in.)
    const elsewhere = await browser.newContext();
    const other = await seed(await elsewhere.newPage(), "disc-other");
    await elsewhere.close();
    await seedCode(other, "OTHER50", 50);
    const offId = await seedCode(s, "PAUSED20", 20);
    await serviceRest(`/discounts?id=eq.${offId}`, { method: "PATCH", body: { enabled: false } });
    for (const code of ["NEVER99", "OTHER50", "PAUSED20"]) {
      const refused = await page.request.post(check, { headers: SAME_ORIGIN, data: { code } });
      expect(refused.status(), code).toBe(409);
      expect(await refused.json(), code).toEqual({ ok: false, error: "discount_invalid" });
    }

    // Another site's page cannot probe codes through a buyer's browser, and
    // the body takes a code and nothing else.
    const crossSite = await page.request.post(check, {
      headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" },
      data: { code: "INSTA10" },
    });
    expect(crossSite.status()).toBe(403);
    const padded = await page.request.post(check, { headers: SAME_ORIGIN, data: { code: "INSTA10", productId: s.apron } });
    expect(padded.status()).toBe(400);

    const order = {
      attemptId: crypto.randomUUID(),
      optionIds: [],
      quantity: 1,
      email: "tester@example.test",
      locale: "en",
      shipTo: { name: "T Ester", line1: "1 Main St", city: "Galway", postalCode: "H91", country: "IE" },
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    };
    const api = checkoutApi(s, s.vase);

    // The total the page showed must be the total the server charges. One cent
    // out and nothing is charged.
    const stale = await page.request.post(api, {
      headers: SAME_ORIGIN,
      data: { ...order, discountCode: "INSTA10", expectedTotalCents: 2609 },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, error: "price_changed" });

    // A code that stopped working since the page loaded is refused, never
    // quietly dropped for the full price.
    const gone = await page.request.post(api, { headers: SAME_ORIGIN, data: { ...order, discountCode: "PAUSED20" } });
    expect(gone.status()).toBe(409);
    expect(await gone.json()).toMatchObject({ ok: false, error: "discount_invalid" });
    // A body cannot name its own discount.
    const named = await page.request.post(api, { headers: SAME_ORIGIN, data: { ...order, discountCents: 2399 } });
    expect(named.status()).toBe(400);
    expect(await ordersOf(s)).toHaveLength(0);

    // The right total goes through: €24.00 - €2.40 + €4.50.
    const placed = await page.request.post(api, {
      headers: SAME_ORIGIN,
      data: { ...order, discountCode: "INSTA10", expectedTotalCents: 2610 },
    });
    expect(placed.status()).toBe(201);
    const [recorded] = await ordersOf(s);
    expect(recorded).toMatchObject({ amount_cents: 2610, product_price_cents: 2400, discount_cents: 240, discount_code: "INSTA10" });

    // No client role reads a store's codes or its price history.
    for (const table of ["discounts", "product_price_history"]) {
      const { status, json } = await anonRest(`/${table}?select=*`);
      expect(status === 200 ? json : [], `${table} as anon`).toEqual([]);
    }
  });
});
