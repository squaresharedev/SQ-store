import { expect, test, type Browser, type Page } from "@playwright/test";
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
import { STRIPE_MOCK_ORIGIN, startStripeMock, type StripeMock } from "./stripe-mock";

/**
 * STRIPE CONNECT, end to end against a stand-in for Stripe (./stripe-mock.ts):
 * a seller connects their own account, a buyer pays on the provider's page,
 * and the order is settled by the provider's event and by nothing else.
 *
 *   - Connecting: Payments sends the owner to onboarding and comes back
 *     knowing where the account stands. Checkout opens only once the account
 *     may take payments.
 *   - Paying: the order exists first, pending and holding its stock; the
 *     charge is on the SELLER's account with our fee; the event makes it paid.
 *   - Backing out gives the stock back, and a closed page cannot be paid.
 *   - Refunding goes through the provider, with our fee, before it is recorded.
 *   - Our cut: the plan's rate on everything the buyer pays, asked of the
 *     provider as the application fee, read back from what it collected into
 *     the order and the fee ledger, nothing for a waived seller or while fees
 *     are switched off, and returned in proportion when a payment is refunded.
 *   - The webhook: only a signed event from the order's own account counts.
 *
 * NEEDS the Connect run: `pnpm test:e2e:connect` (playwright.connect.config.ts).
 * Anywhere else Connect is off, and every test here skips.
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

const CONNECT_ON = process.env.NEXT_PUBLIC_STRIPE_CONNECT_ENABLED === "true";

type Shop = { sellerId: string; storefrontId: string; store: string; vase: string };

/** A signed-in owner with one physical product on a storefront: a vase at
 *  €24, `stock` of them, delivery to Ireland priced at €4.50. Not connected. */
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
    { title: "Stoneware vase", price_cents: 2400, max_per_order: 5, track_stock: true, stock_quantity: stock },
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

type AccountRow = { stripe_account_id: string; charges_enabled: boolean; livemode: boolean };
const accountOf = async (shop: Shop) =>
  ((await serviceRest(
    `/seller_payment_accounts?owner_id=eq.${shop.sellerId}&select=stripe_account_id,charges_enabled,livemode`,
  )) as AccountRow[])[0] ?? null;

/** The owner goes through "Connect with Stripe" on the Payments page and
 *  lands back on it. */
async function connectFromPayments(page: Page, opener: string) {
  await gotoApp(page, "/payments");
  await page.getByRole("button", { name: opener }).click();
  const dialog = page.getByRole("dialog", { name: "Connect with Stripe" });
  await expect(dialog).toBeVisible();
  // Out to the provider's onboarding and back through our return route. The
  // return is what is waited for: the page is on /payments before it leaves,
  // too, so its address alone says nothing.
  const returned = page.waitForResponse((response) => response.url().includes("/api/payments/connect/return"), {
    timeout: 30_000,
  });
  await dialog.locator("[data-connect-stripe]").click();
  await returned;
  await page.waitForURL(/\/payments$/, { timeout: 30_000 });
  await expect(page.getByText("Stripe account connected")).toBeVisible();
}

const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const checkoutIdOf = (attemptId: string) => `cs_ss_${attemptId.replace(/-/g, "")}`;

/** One buyer pressing Pay, as the checkout form sends it. */
function buy(page: Page, shop: Shop, buyer: string, attemptId: string = crypto.randomUUID()) {
  return page.request.post(`/api/checkout/${shop.storefrontId}/${shop.vase}`, {
    headers: SAME_ORIGIN,
    data: {
      attemptId,
      optionIds: [],
      quantity: 1,
      email: buyer,
      locale: "en",
      shipTo: { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Galway", postalCode: "H91 X2Y3", country: "IE" },
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    },
  });
}

/** A buyer who gets as far as the provider's page: the order is pending. */
async function startPayment(page: Page, shop: Shop, buyer: string) {
  const attemptId = crypto.randomUUID();
  const placed = await buy(page, shop, buyer, attemptId);
  expect(placed.status()).toBe(201);
  const { orderUrl } = (await placed.json()) as { orderUrl: string };
  expect(orderUrl.startsWith(`${STRIPE_MOCK_ORIGIN}/pay/`)).toBe(true);
  return { checkoutId: checkoutIdOf(attemptId), payUrl: orderUrl };
}

/** ...and one who pays there. Answers with where the provider sent them. */
async function pay(page: Page, payUrl: string): Promise<string> {
  const response = await page.request.get(`${payUrl}/complete`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  return response.headers().location;
}

type OrderRow = {
  id: string;
  status: string;
  channel: string;
  payment_ref: string | null;
  stock_reserved: number;
  amount_cents: number;
  platform_fee_cents: number;
  platform_fee_bps: number | null;
  seller_plan: string | null;
  ad_fee_cents: number;
  application_fee_cents: number | null;
  fee_capped: boolean;
  pending_expires_at: string | null;
  refunded_at: string | null;
};
const ordersOf = async (shop: Shop) =>
  (await serviceRest(
    `/orders?seller_id=eq.${shop.sellerId}&select=id,status,channel,payment_ref,stock_reserved,amount_cents,platform_fee_cents,platform_fee_bps,seller_plan,ad_fee_cents,application_fee_cents,fee_capped,pending_expires_at,refunded_at&order=created_at.asc`,
  )) as OrderRow[];

type LedgerRow = { kind: string; amount_cents: number; stripe_application_fee_id: string | null; livemode: boolean };
/** What the fee ledger holds for one order, oldest first. */
const ledgerOf = async (orderId: string) =>
  (await serviceRest(
    `/fee_ledger?order_id=eq.${orderId}&select=kind,amount_cents,stripe_application_fee_id,livemode&order=created_at.asc,kind.asc`,
  )) as LedgerRow[];

/** The per-sale fee's launch switch (billing_switches). It ships off. */
const switchFees = (on: boolean) =>
  serviceRest("/billing_switches?id=eq.true", { method: "PATCH", body: { fees_enabled: on } });

/** Put a store on a paid plan the way the billing webhook would have. */
async function subscribe(shop: Shop, plan: "starter" | "pro") {
  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await serviceRest("/seller_billing", {
    method: "POST",
    body: {
      owner_id: shop.sellerId,
      stripe_customer_id: `cus_e2e${shop.sellerId.replace(/-/g, "")}`,
      plan,
      billing_interval: "month",
      status: "active",
      current_period_end: until,
      paid_until: until,
    },
  });
}

/** A buyer who pays, start to finish; answers with the order as it stands. */
async function sell(page: Page, stripe: StripeMock, shop: Shop, buyer: string) {
  const { checkoutId, payUrl } = await startPayment(page, shop, buyer);
  const session = stripe.sessionFor(checkoutId)!;
  await pay(page, payUrl);
  const order = (await ordersOf(shop)).find((candidate) => candidate.payment_ref === session.payment_intent)!;
  return { session, order };
}

const stockOf = async (shop: Shop) =>
  ((await serviceRest(`/products?id=eq.${shop.vase}&select=stock_quantity`)) as { stock_quantity: number }[])[0]
    .stock_quantity;

const checkoutStatus = async (page: Page, shop: Shop) =>
  (await page.request.get(`/s/${shop.storefrontId}/p/${shop.vase}/checkout`, { maxRedirects: 0 })).status();

const panel = (page: Page) => page.getByRole("dialog", { name: /order details/i });

/** A second seller with a connected account of their own, for "not yours". */
async function otherConnectedSeller(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const user = freshUser("connect-other");
    await signUp(await context.newPage(), user);
    const ownerId = await userIdByEmail(user.email);
    const stripeAccountId = `acct_e2eother${Date.now()}`;
    await serviceRest("/seller_payment_accounts", {
      method: "POST",
      body: { owner_id: ownerId, stripe_account_id: stripeAccountId, charges_enabled: true },
    });
    return stripeAccountId;
  } finally {
    await context.close();
  }
}

test.describe("Stripe Connect", () => {
  test.skip(!CONNECT_ON, "run with pnpm test:e2e:connect");

  let stripe: StripeMock;
  test.beforeAll(async () => {
    stripe = await startStripeMock();
    // The per-sale fee ships switched off; this run is about it being charged.
    await switchFees(true);
  });
  test.afterAll(async () => {
    await switchFees(false);
    await stripe?.close();
  });
  test.beforeEach(() => {
    Object.assign(stripe.knobs, {
      onboardingCompletes: true,
      refuseRefunds: false,
      announcePayments: true,
      feeShortfallCents: 0,
    });
  });

  test("an owner connects from Payments; checkout opens only once the account may take payments", async ({ page }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "connect-onboard", 5);

    // Set up, and still not buyable: the checklist says what is left.
    await gotoApp(page, "/dashboard");
    await expect(page.locator('[data-setup-step="payments"]')).toHaveAttribute("data-setup-state", "todo");
    await expect(page.locator('[data-setup-step="delivery"]')).toHaveAttribute("data-setup-state", "done");
    expect(await checkoutStatus(page, shop)).not.toBe(200);

    // Onboarding the seller leaves half done: connected, not yet payable.
    stripe.knobs.onboardingCompletes = false;
    await connectFromPayments(page, "Connect with Stripe");
    await expect(page.getByText("Stripe account connected")).toBeVisible();
    await expect(page.locator("[data-connect-unfinished]")).toContainText("Stripe still needs a few details");
    const started = await accountOf(shop);
    expect(started).toMatchObject({ charges_enabled: false, livemode: false });
    expect(stripe.accounts.has(started!.stripe_account_id)).toBe(true);
    expect(await checkoutStatus(page, shop)).not.toBe(200);

    // The same account, finished: one account at the provider, not two.
    stripe.knobs.onboardingCompletes = true;
    await connectFromPayments(page, "Finish on Stripe");
    await expect(page.locator("[data-connect-unfinished]")).toHaveCount(0);
    expect(await accountOf(shop)).toMatchObject({
      stripe_account_id: started!.stripe_account_id,
      charges_enabled: true,
    });
    expect(stripe.accounts.size).toBe(1);
    expect(await checkoutStatus(page, shop)).toBe(200);

    // The product page now says what delivery costs, beside the price.
    await page.goto(`/s/${shop.storefrontId}/p/${shop.vase}`);
    await expect(page.locator("[data-product-delivery]").first()).toHaveText("Delivery €4.50");
  });

  test("a buyer pays on the provider's page: a pending order, a charge on the seller's account, paid by the event", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "connect-pay", 5);
    await connectFromPayments(page, "Connect with Stripe");
    const account = (await accountOf(shop))!;

    const buyer = `pay-${Date.now()}@example.test`;
    await page.goto(`/s/${shop.storefrontId}/p/${shop.vase}/checkout`);
    await expect(page.locator("[data-checkout-payment='stripe']")).toContainText("Stripe's secure page");
    await page.getByLabel("Email").fill(buyer);
    await page.getByLabel("Full name").fill("Aoife Byrne");
    await page.getByLabel("Address", { exact: true }).fill("12 Harbour Road");
    await page.getByLabel("Town or city").fill("Galway");
    await page.getByLabel("Postcode").fill("H91 X2Y3");
    await page.locator("form [data-checkout-pay]").click();

    // The provider's page, asked for exactly what the quote said.
    await page.waitForURL(`${STRIPE_MOCK_ORIGIN}/pay/**`, { timeout: 30_000 });
    await expect(page.locator("[data-stripe-page]")).toHaveAttribute("data-stripe-amount", "2850");

    // The order exists BEFORE the money: pending, holding its unit, and
    // remembering which payment page is its own.
    const [pending] = await ordersOf(shop);
    expect(pending).toMatchObject({ status: "pending", stock_reserved: 1, amount_cents: 2850 });
    expect(pending.pending_expires_at).not.toBeNull();
    expect(await stockOf(shop)).toBe(4);
    const session = stripe.sessions.get(pending.payment_ref!)!;
    // On the SELLER's account, with our fee and nothing a browser chose:
    // Free's 5% of the EUR 28.50 the buyer pays, delivery included.
    expect(session.account).toBe(account.stripe_account_id);
    expect(session.application_fee_amount).toBe(143);
    expect(pending).toMatchObject({ platform_fee_cents: 143, platform_fee_bps: 500, application_fee_cents: 143 });
    expect(session.line_items.map((line) => line.amount)).toEqual([2400, 450]);
    expect(session.customer_email).toBe(buyer);
    // Nobody has been told about an order that is not paid.
    expect(await devEmails(buyer)).toHaveLength(0);

    await page.locator("#pay").click();
    await page.waitForURL(/\/order\/.+placed=1/, { timeout: 30_000 });
    await expect(page.locator("[data-order-page='public']")).toHaveAttribute("data-order-payment", "paid");

    const [paid] = await ordersOf(shop);
    expect(paid).toMatchObject({ status: "paid", payment_ref: session.payment_intent, pending_expires_at: null });
    expect(await stockOf(shop)).toBe(4);
    await expect.poll(async () => (await devEmails(buyer)).length).toBe(1);
    // What the provider collected for us is in the ledger, under its own id.
    expect(await ledgerOf(paid.id)).toEqual([
      {
        kind: "platform_fee",
        amount_cents: 143,
        stripe_application_fee_id: stripe.feeFor(session.payment_intent!)!.id,
        livemode: false,
      },
    ]);

    // And the seller's Payments tab shows the provider's own figures.
    await gotoApp(page, "/payments");
    await expect(page.getByText("Stoneware vase").first()).toBeVisible();
  });

  test("backing out gives the last one back, and the closed page cannot be paid", async ({ page }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "connect-cancel", 1);
    await connectFromPayments(page, "Connect with Stripe");

    const { payUrl } = await startPayment(page, shop, "first@example.test");
    expect(await stockOf(shop)).toBe(0);
    // Held for the buyer who is paying: nobody else can have it meanwhile.
    const second = await buy(page, shop, "second@example.test");
    expect(second.status()).toBe(409);
    expect(await second.json()).toMatchObject({ ok: false, error: "sold_out" });

    await page.goto(payUrl);
    await page.locator("#cancel").click();
    await page.waitForURL(new RegExp(`/s/${shop.storefrontId}/p/${shop.vase}/checkout`), { timeout: 30_000 });

    expect(await stockOf(shop)).toBe(1);
    expect(await ordersOf(shop)).toHaveLength(0);
    // Closed FIRST: the page left open in another tab takes no money.
    const late = await page.request.get(`${payUrl}/complete`, { maxRedirects: 0 });
    expect(late.status()).toBe(410);
    expect(await ordersOf(shop)).toHaveLength(0);
  });

  test("a refund goes back through the provider, with our fee, before it is recorded", async ({ page }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "connect-refund", 5);
    await connectFromPayments(page, "Connect with Stripe");
    const account = (await accountOf(shop))!;

    const buyer = `refund-${Date.now()}@example.test`;
    const { payUrl } = await startPayment(page, shop, buyer);
    await pay(page, payUrl);
    await expect.poll(async () => (await ordersOf(shop))[0]?.status).toBe("paid");
    const [order] = await ordersOf(shop);

    await gotoApp(page, "/orders");
    await page.locator("tbody tr").first().click();
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "Refund or cancel" }).click();
    await expect(panel(page).locator("[data-order-refund-how='provider']")).toContainText("through Stripe");

    // The provider says no: nothing is recorded, and the seller is told why.
    stripe.knobs.refuseRefunds = true;
    await panel(page).getByRole("button", { name: "Refund €28.50" }).click();
    await expect(panel(page)).toContainText("Stripe couldn't make this refund.");
    expect((await ordersOf(shop))[0]).toMatchObject({ status: "paid", refunded_at: null });
    expect(stripe.refunds).toHaveLength(0);

    stripe.knobs.refuseRefunds = false;
    await panel(page).getByRole("button", { name: "Refund €28.50" }).click();
    await expectToast(page, /Refund sent\./);
    await expect(panel(page).locator("[data-order-refunded]")).toBeVisible();

    expect(stripe.refunds).toHaveLength(1);
    expect(stripe.refunds[0]).toMatchObject({
      account: account.stripe_account_id,
      payment_intent: order.payment_ref,
      refund_application_fee: true,
      idempotencyKey: `refund_${order.id}`,
    });
    expect((await ordersOf(shop))[0]).toMatchObject({ status: "refunded", stock_reserved: 0 });
    // Our fee went back with it. The provider says so a moment later, and
    // that is what the ledger is written from: charged, then returned in full.
    await expect
      .poll(async () => (await ledgerOf(order.id)).map((row) => [row.kind, row.amount_cents]))
      .toEqual([
        ["platform_fee", 143],
        ["platform_fee_refund", -143],
      ]);
    expect(await stockOf(shop)).toBe(5);
    await expect
      .poll(async () => (await devEmails(buyer)).find((mail) => mail.subject.endsWith("has been refunded"))?.text ?? "")
      .toContain("goes back the way you paid");
  });

  test("only a signed event from the order's own account pays it, and only once", async ({ page, browser }) => {
    test.setTimeout(300_000);
    const shop = await seedShop(page, "connect-hook", 5);
    await connectFromPayments(page, "Connect with Stripe");
    const account = (await accountOf(shop))!;
    const foreignAccount = await otherConnectedSeller(browser);

    // Paid at the provider, with the news held back: the buyer is on their
    // order page a moment before we know.
    stripe.knobs.announcePayments = false;
    const buyer = `hook-${Date.now()}@example.test`;
    const { checkoutId, payUrl } = await startPayment(page, shop, buyer);
    const orderUrl = await pay(page, payUrl);
    const session = stripe.sessionFor(checkoutId)!;
    const paidObject = {
      id: session.id,
      client_reference_id: checkoutId,
      payment_status: "paid",
      payment_intent: session.payment_intent,
    };
    const statusNow = async () => (await ordersOf(shop))[0].status;

    await page.goto(orderUrl);
    await expect(page.locator("[data-order-page='public']")).toHaveAttribute("data-order-payment", "pending");
    await expect(page.locator("[data-order-step='paid']")).toContainText("Confirming your payment");

    // Not signed by Stripe.
    const forged = await stripe.sendEvent({
      type: "checkout.session.completed",
      account: account.stripe_account_id,
      object: paidObject,
      secret: "whsec_someone_elses",
    });
    expect(forged.status).toBe(400);
    expect(await statusNow()).toBe("pending");

    // Signed, but from ANOTHER seller's account naming this seller's order.
    const foreign = await stripe.sendEvent({
      type: "checkout.session.completed",
      account: foreignAccount,
      object: paidObject,
    });
    expect(foreign.status).toBe(200);
    expect(await statusNow()).toBe("pending");

    // Signed, from an account this app never created.
    const unknown = await stripe.sendEvent({
      type: "checkout.session.completed",
      account: "acct_e2enobodyweknow",
      object: paidObject,
    });
    expect(unknown.status).toBe(200);
    expect(await statusNow()).toBe("pending");

    // The real one, and the page the buyer is already on catches up unasked.
    const eventId = `evt_e2e${Date.now()}`;
    const genuine = { id: eventId, type: "checkout.session.completed", account: account.stripe_account_id, object: paidObject };
    expect((await stripe.sendEvent(genuine)).status).toBe(200);
    expect(await statusNow()).toBe("paid");
    await expect(page.locator("[data-order-page='public']")).toHaveAttribute("data-order-payment", "paid", {
      timeout: 20_000,
    });

    // Delivered again (Stripe retries): nothing happens twice.
    expect((await stripe.sendEvent(genuine)).status).toBe(200);
    await expect.poll(async () => (await devEmails(buyer)).length).toBe(1);
    expect(await stockOf(shop)).toBe(4);
    expect(await ordersOf(shop)).toHaveLength(1);

    // A dispute opened at the buyer's bank reaches the seller.
    const dispute = await stripe.sendEvent({
      type: "charge.dispute.created",
      account: account.stripe_account_id,
      object: { id: "dp_e2e1", payment_intent: session.payment_intent },
    });
    expect(dispute.status).toBe(200);
    expect(await statusNow()).toBe("disputed");
    await expect
      .poll(async () => {
        const rows = (await serviceRest(
          `/notifications?user_id=eq.${shop.sellerId}&type=eq.payment&select=title`,
        )) as { title: string }[];
        return rows[0]?.title ?? null;
      })
      .toBe("A buyer disputed the payment for Stoneware vase");

    // A refund made in the provider's own dashboard is recorded here too.
    const second = await startPayment(page, shop, `hook2-${Date.now()}@example.test`);
    stripe.knobs.announcePayments = true;
    await pay(page, second.payUrl);
    const dashboardRefund = await stripe.sendEvent({
      type: "charge.refunded",
      account: account.stripe_account_id,
      object: { id: "ch_e2e1", refunded: true, payment_intent: stripe.sessionFor(second.checkoutId)!.payment_intent },
    });
    expect(dashboardRefund.status).toBe(200);
    expect((await ordersOf(shop))[1]).toMatchObject({ status: "refunded" });
  });

  test("our cut is the seller's plan rate, decided by the server: Free, then Starter, a waived seller, fees off", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const shop = await seedShop(page, "connect-fee", 5);
    await connectFromPayments(page, "Connect with Stripe");
    const buyer = (tag: string) => `fee-${tag}-${Date.now()}@example.test`;

    // FREE: 5% of the EUR 28.50 paid. The session says where the figure came
    // from, and the order and the ledger say the same as the provider.
    const free = await sell(page, stripe, shop, buyer("free"));
    expect(free.session.application_fee_amount).toBe(143);
    expect(free.session.metadata).toMatchObject({
      order_id: free.order.id,
      origin: "hosted_storefront",
      plan_id: "free",
      platform_fee_bps: "500",
    });
    expect(free.order).toMatchObject({
      status: "paid",
      channel: "direct",
      seller_plan: "free",
      platform_fee_bps: 500,
      platform_fee_cents: 143,
      ad_fee_cents: 0,
      application_fee_cents: 143,
      fee_capped: false,
    });
    expect((await ledgerOf(free.order.id)).map((row) => [row.kind, row.amount_cents])).toEqual([["platform_fee", 143]]);

    // A body that names a fee, a plan or the marketplace changes nothing: the
    // route refuses fields it does not know, and takes the channel only from
    // the links a seller can make.
    const tampered = await page.request.post(`/api/checkout/${shop.storefrontId}/${shop.vase}`, {
      headers: SAME_ORIGIN,
      data: {
        attemptId: crypto.randomUUID(),
        optionIds: [],
        quantity: 1,
        email: buyer("tamper"),
        locale: "en",
        shipTo: { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Galway", postalCode: "H91 X2Y3", country: "IE" },
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
        channel: "marketplace",
      },
    });
    expect(tampered.status()).toBe(400);
    expect(await ordersOf(shop)).toHaveLength(1);

    // STARTER, from the next checkout on: 2%.
    await subscribe(shop, "starter");
    const starter = await sell(page, stripe, shop, buyer("starter"));
    expect(starter.session.application_fee_amount).toBe(57);
    expect(starter.session.metadata).toMatchObject({ plan_id: "starter", platform_fee_bps: "200" });
    expect(starter.order).toMatchObject({ seller_plan: "starter", platform_fee_bps: 200, application_fee_cents: 57 });
    expect((await ledgerOf(starter.order.id)).map((row) => row.amount_cents)).toEqual([57]);

    // A WAIVED seller (the closed beta) pays nothing: no fee is asked of the
    // provider at all, and nothing is written.
    await serviceRest("/seller_fee_waivers", { method: "POST", body: { owner_id: shop.sellerId } });
    const waived = await sell(page, stripe, shop, buyer("waived"));
    expect(waived.session.application_fee_amount).toBeNull();
    expect(waived.order).toMatchObject({
      status: "paid",
      seller_plan: "starter",
      platform_fee_bps: 0,
      platform_fee_cents: 0,
      application_fee_cents: 0,
    });
    expect(await ledgerOf(waived.order.id)).toEqual([]);
    expect(stripe.feeFor(waived.session.payment_intent!)).toBeUndefined();

    // And with FEES SWITCHED OFF nobody does, waived or not.
    await serviceRest(`/seller_fee_waivers?owner_id=eq.${shop.sellerId}`, { method: "DELETE" });
    await switchFees(false);
    try {
      const off = await sell(page, stripe, shop, buyer("off"));
      expect(off.session.application_fee_amount).toBeNull();
      expect(off.order).toMatchObject({ status: "paid", platform_fee_cents: 0, application_fee_cents: 0 });
      expect(await ledgerOf(off.order.id)).toEqual([]);
    } finally {
      await switchFees(true);
    }

    // The seller sees what each sale paid, on its row, and the month's total.
    // (The ledger view: with parcels waiting, Orders opens on the To ship
    // queue, which shows where each goes rather than what it cost.)
    await gotoApp(page, "/orders?view=all");
    await expect(page.locator("[data-order-fee]")).toHaveText(["Fee €0.57", "Fee €1.43"]);
    await gotoApp(page, "/payments");
    await expect(page.locator("[data-fees-this-month]")).toContainText("€2.00");
  });

  test("a refund returns our fee in proportion, and the order follows what the provider collected", async ({ page }) => {
    test.setTimeout(300_000);
    const shop = await seedShop(page, "connect-fee-refund", 5);
    await connectFromPayments(page, "Connect with Stripe");
    const amounts = async (orderId: string) => (await ledgerOf(orderId)).map((row) => [row.kind, row.amount_cents]);

    // HALF the payment refunded in the provider's dashboard: half the fee
    // comes back (71.5 rounds to 72), and the order is still a paid one.
    const first = await sell(page, stripe, shop, `part-${Date.now()}@example.test`);
    expect((await stripe.refundInDashboard(first.session.payment_intent!, 1425)).status).toBe(200);
    expect(await amounts(first.order.id)).toEqual([
      ["platform_fee", 143],
      ["platform_fee_refund", -72],
    ]);
    expect((await ordersOf(shop))[0]).toMatchObject({ status: "paid", refunded_at: null });

    // The event delivered again writes nothing twice.
    const charge = { payment_intent: first.session.payment_intent, refunded: false, application_fee: stripe.feeFor(first.session.payment_intent!)!.id };
    const account = (await accountOf(shop))!;
    expect((await stripe.sendEvent({ type: "charge.refunded", account: account.stripe_account_id, object: charge })).status).toBe(200);
    expect(await amounts(first.order.id)).toHaveLength(2);

    // The rest: everything is back, and now the order is refunded.
    expect((await stripe.refundInDashboard(first.session.payment_intent!)).status).toBe(200);
    expect(await amounts(first.order.id)).toEqual([
      ["platform_fee", 143],
      ["platform_fee_refund", -72],
      ["platform_fee_refund", -71],
    ]);
    expect((await ordersOf(shop))[0]).toMatchObject({ status: "refunded" });

    // The provider collects 3 cents less than was asked: the order and the
    // ledger say what was collected, not what we worked out.
    stripe.knobs.feeShortfallCents = 3;
    const short = await sell(page, stripe, shop, `short-${Date.now()}@example.test`);
    expect(short.session.application_fee_amount).toBe(143);
    expect(short.order).toMatchObject({ status: "paid", platform_fee_cents: 140, application_fee_cents: 140 });
    expect(await amounts(short.order.id)).toEqual([["platform_fee", 140]]);
  });
});
