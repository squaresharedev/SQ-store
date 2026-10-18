import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
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
 * THE ORDER LIFECYCLE, end to end (20261008_order_lifecycle), through the real
 * checkout route, the real order writer and the seller's own order panel.
 *
 *   - Stock is taken WITH the order: two buyers after the last one get one
 *     order and one "sold out", and a repeated attempt takes nothing twice.
 *   - A sale that leaves a product at its low-stock line tells the seller.
 *   - The owner takes a paid order back: it leaves To ship, its units go back
 *     on the shelf, the buyer is emailed and their own order page says so.
 *
 * NEEDS test payments, like every checkout spec: run it with
 *   pnpm test:e2e:checkout
 * (playwright.checkout.config.ts). Without them checkout is not offered and
 * these tests skip.
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

type Shop = { sellerId: string; storefrontId: string; store: string; vase: string };

/** A signed-in owner with one physical product on a storefront: a vase at
 *  €24, `stock` of them, delivery to Ireland priced at €4.50. */
async function seedShop(page: Page, tag: string, stock: number): Promise<Shop> {
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
      stock_quantity: stock,
      low_stock_threshold: 2,
    },
  ]);
  const [{ id: vase }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
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
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return { sellerId, storefrontId, store, vase };
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

/** One buyer pressing Pay, as the checkout form sends it. */
function buy(page: Page, shop: Shop, buyer: string, options: { quantity?: number; attemptId?: string } = {}) {
  return page.request.post(`/api/checkout/${shop.storefrontId}/${shop.vase}`, {
    headers: SAME_ORIGIN,
    data: {
      attemptId: options.attemptId ?? crypto.randomUUID(),
      optionIds: [],
      quantity: options.quantity ?? 1,
      email: buyer,
      locale: "en",
      shipTo: { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Galway", postalCode: "H91 X2Y3", country: "IE" },
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    },
  });
}

async function checkoutOffered(page: Page, shop: Shop): Promise<boolean> {
  const response = await page.request.get(`/s/${shop.storefrontId}/p/${shop.vase}/checkout`, { maxRedirects: 0 });
  return response.status() === 200;
}

const stockOf = async (shop: Shop) =>
  ((await serviceRest(`/products?id=eq.${shop.vase}&select=stock_quantity`)) as { stock_quantity: number }[])[0]
    .stock_quantity;

type OrderRow = {
  id: string;
  status: string;
  stock_reserved: number;
  refund_reason: string | null;
  refunded_at: string | null;
  seller_notified_at: string | null;
  confirmation_sent_at: string | null;
};
const ordersOf = async (shop: Shop) =>
  (await serviceRest(
    `/orders?seller_id=eq.${shop.sellerId}&select=id,status,stock_reserved,refund_reason,refunded_at,seller_notified_at,confirmation_sent_at`,
  )) as OrderRow[];

const panel = (page: Page) => page.getByRole("dialog", { name: /order details/i });

test.describe("the order lifecycle", () => {
  test("two buyers after the last one: one order, one 'sold out'", async ({ page }) => {
    const shop = await seedShop(page, "life-race", 1);
    test.skip(!(await checkoutOffered(page, shop)), "run with pnpm test:e2e:checkout");

    const responses = await Promise.all([
      buy(page, shop, "first@example.test"),
      buy(page, shop, "second@example.test"),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.status() === 409)!;
    // Told BEFORE any money moves, in the words the checkout already has for it.
    expect(await refused.json()).toMatchObject({ ok: false, error: "sold_out" });

    expect(await stockOf(shop)).toBe(0);
    const orders = await ordersOf(shop);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: "paid", stock_reserved: 1 });
  });

  test("a repeated attempt answers with its order, takes nothing twice, and the news goes out once", async ({ page }) => {
    const shop = await seedShop(page, "life-repeat", 5);
    test.skip(!(await checkoutOffered(page, shop)), "run with pnpm test:e2e:checkout");

    const attemptId = crypto.randomUUID();
    const buyer = `repeat-${Date.now()}@example.test`;
    const first = await buy(page, shop, buyer, { attemptId });
    const again = await buy(page, shop, buyer, { attemptId });
    expect(first.status()).toBe(201);
    expect(again.status()).toBe(201);
    expect((await again.json()).orderUrl).toBe((await first.json()).orderUrl);

    expect(await stockOf(shop)).toBe(4);
    expect(await ordersOf(shop)).toHaveLength(1);
    // What was said is recorded on the order, which is what lets a later call
    // finish the job without saying it twice.
    await expect
      .poll(async () => {
        const [order] = await ordersOf(shop);
        return Boolean(order.seller_notified_at && order.confirmation_sent_at);
      })
      .toBe(true);
    expect((await devEmails(buyer)).filter((mail) => mail.subject.includes(shop.store))).toHaveLength(1);
  });

  test("a sale that leaves a product at its low-stock line tells the seller", async ({ page }) => {
    const shop = await seedShop(page, "life-low", 3);
    test.skip(!(await checkoutOffered(page, shop)), "run with pnpm test:e2e:checkout");

    expect((await buy(page, shop, "low@example.test")).status()).toBe(201);
    await expect
      .poll(async () => {
        const rows = (await serviceRest(
          `/notifications?user_id=eq.${shop.sellerId}&type=eq.stock&select=title,body`,
        )) as { title: string; body: string }[];
        return rows[0] ?? null;
      })
      .toMatchObject({ title: "Stoneware vase is running low", body: expect.stringContaining("Only 2 left.") });
  });

  test("the owner takes an order back: out of To ship, units returned, buyer told and shown", async ({ page }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "life-refund", 5);
    test.skip(!(await checkoutOffered(page, shop)), "run with pnpm test:e2e:checkout");

    const buyer = `refund-${Date.now()}@example.test`;
    const placed = await buy(page, shop, buyer, { quantity: 2 });
    expect(placed.status()).toBe(201);
    const orderUrl = ((await placed.json()) as { orderUrl: string }).orderUrl.replace(/\?placed=1$/, "");
    expect(await stockOf(shop)).toBe(3);

    // The seller's side: the order is waiting to ship.
    await gotoApp(page, "/orders");
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(panel(page)).toBeVisible();

    await panel(page).getByRole("button", { name: "Refund or cancel" }).click();
    // Said before anything can be pressed: this records a refund, it does not make one.
    await expect(panel(page)).toContainText("didn't go through Square Share");
    // Never sent, so it is a cancellation and the units go back by default.
    await expect(panel(page).getByLabel("Reason")).toContainText("Cancelled before sending");
    await expect(panel(page).getByRole("switch", { name: "Put all 2 back in stock" })).toBeChecked();
    await panel(page).getByRole("button", { name: "Record refund of €52.50" }).click();

    await expectToast(page, /Refund recorded\./);
    await expect(panel(page).locator("[data-order-refunded]")).toContainText("Cancelled and refunded");
    await expect(panel(page).getByRole("button", { name: "Refund or cancel" })).toHaveCount(0);
    // Nothing to ship any more.
    await expect(panel(page).getByRole("button", { name: "Mark as shipped" })).toHaveCount(0);

    const [order] = await ordersOf(shop);
    expect(order).toMatchObject({ status: "refunded", refund_reason: "cancelled", stock_reserved: 0 });
    expect(order.refunded_at).not.toBeNull();
    expect(await stockOf(shop)).toBe(5);

    // Out of the To ship queue.
    await gotoApp(page, "/orders?view=to-ship");
    await expect(page.locator("tbody tr")).toHaveCount(0);

    // The buyer is told, on the seller's behalf, and honestly about the money.
    await expect
      .poll(async () => (await devEmails(buyer)).find((mail) => mail.subject.endsWith("has been refunded"))?.text ?? "")
      .toContain("Refunded: €52.50");
    const mail = (await devEmails(buyer)).find((message) => message.subject.endsWith("has been refunded"))!;
    expect(mail.subject).toBe(`Your order from ${shop.store} has been refunded`);
    expect(mail.text).toContain(`${shop.store} has cancelled your order and refunded it.`);
    expect(mail.text).toContain("is paying you back directly");
    expect(mail.fromName).toBe(`${shop.store} via Square Share`);

    // And their own order page says so, instead of still reading "being prepared".
    await page.goto(orderUrl);
    await expect(page.locator("[data-order-page='public']")).toHaveAttribute("data-order-payment", "refunded");
    await expect(page.locator("[data-order-step='refunded']")).toContainText("Refunded");
    await expect(page.locator("[data-order-step='preparing']")).toHaveCount(0);
  });
});
