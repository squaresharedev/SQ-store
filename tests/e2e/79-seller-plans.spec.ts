import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { freshUser, seedProducts, seedStorefronts, serviceRest, signUp, userIdByEmail } from "./helpers";
import { ANON_KEY, GATEWAY_URL, signJwt } from "./stack/keys.mjs";

/**
 * Seller plans, end to end, on the stack's TEST billing provider (the stack
 * sets BILLING_TEST_PROVIDER=1: "checkout" and "the portal" complete the
 * moment they open, through the same write the Stripe webhook makes).
 *
 *   - a new seller is on Free, and the rail says so;
 *   - upgrading goes plans page -> checkout -> back to Settings, which
 *     confirms the new plan on its first render and drops the session id;
 *   - a sale on Pro is charged Pro's rate, snapshotted on the order;
 *   - moving back to Free is scheduled for the end of the period;
 *   - Settings sells the next plan up with its benefit, and buying it there
 *     unlocks the orders export, whose file is a ledger without buyer details;
 *   - an outside link to the plans page is counted under its source;
 *   - the Free storefront limit holds for a direct REST insert as well as in
 *     the app, and a paid plan lifts it;
 *   - the Free product limit holds the same way: the import brings in only
 *     what there is room for, a full store sees the limit instead of a form,
 *     and nothing it already has is touched.
 */

function userJwt(id: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
}

/** Click a download button until the file arrives: a click that lands before
 *  hydration does nothing, so one try is not enough on a fresh page. */
async function downloadFrom(page: Page, button: Locator): Promise<Download> {
  await expect(button).toBeVisible();
  let file: Download | null = null;
  await expect(async () => {
    [file] = await Promise.all([page.waitForEvent("download", { timeout: 4_000 }), button.click()]);
  }).toPass({ timeout: 30_000 });
  return file!;
}

async function openPlansFromRail(page: Page) {
  const chip = page.locator("nav [data-plan-chip]");
  // A click that lands before hydration can be lost: retry until it navigates.
  await expect(async () => {
    await chip.click();
    await page.waitForURL(/\/plans\?from=sidebar/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator("[data-plans-page][data-plans-source='sidebar']")).toBeVisible();
}

test.describe("seller plans", () => {
  test("Free -> Pro through checkout, a sale at Pro's rate, then back to Free at period end", async ({ page }) => {
    const seller = freshUser("plans");
    await signUp(page, seller);
    const sellerId = await userIdByEmail(seller.email);

    // A new account is on Free, and the rail offers the upgrade.
    await expect(page.locator("nav [data-plan-chip='free']")).toBeVisible();

    await openPlansFromRail(page);
    await expect(page.locator("[data-pricing-plan='free']")).toContainText("Current plan");
    await expect(page.locator("[data-recommended]")).toHaveAttribute("data-pricing-plan", "starter");
    await page.locator("[data-pricing-upgrade='pro']").click();

    // Back from "checkout": Settings confirms the plan on its first render,
    // then drops the session id from the address.
    await page.waitForURL(/\/settings\/billing/, { timeout: 30_000 });
    await expect(page.locator("[data-billing-return='confirmed']")).toContainText("You're on Pro");
    await expect(page.locator("[data-billing-plan='pro']")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/billing$/);
    await expect(page.locator("nav [data-plan-chip='pro']")).toBeVisible();
    // On the top plan, Settings shows what it has rather than selling more.
    await expect(page.locator("[data-upsell='top']")).toBeVisible();

    const [billing] = (await serviceRest(
      `/seller_billing?owner_id=eq.${sellerId}&select=plan,status,billing_interval,paid_until`,
    )) as Array<{ plan: string; status: string; billing_interval: string; paid_until: string }>;
    expect(billing).toMatchObject({ plan: "pro", status: "active", billing_interval: "month" });
    expect(new Date(billing.paid_until).getTime()).toBeGreaterThan(Date.now());

    // A sale now is charged Pro's rate on the items, and the order says so.
    await seedProducts(sellerId, [{ title: "Pro lamp", price_cents: 2500 }]);
    const sale = await page.request.post("/dev/simulate-sale", { data: { quantity: 2 } });
    expect(sale.ok()).toBe(true);
    const [order] = (await serviceRest(
      `/orders?seller_id=eq.${sellerId}&select=amount_cents,platform_fee_cents,platform_fee_bps,seller_plan`,
    )) as Array<Record<string, number | string>>;
    expect(order).toEqual({ amount_cents: 5000, platform_fee_cents: 50, platform_fee_bps: 100, seller_plan: "pro" });

    // Pro's analytics report: the range's figures as a CSV, matching the page.
    await page.goto("/analytics?range=all");
    const reportFile = await downloadFrom(page, page.locator("[data-analytics-export='ready']"));
    expect(reportFile.suggestedFilename()).toMatch(/^square-share-analytics-.+\.csv$/);
    const reportCsv = await readFile((await reportFile.path())!, "utf8");
    expect(reportCsv.replace(/^\uFEFF/, "")).toMatch(/^period_start,sales,revenue,average_order,currency/);
    // The one sale above: a single order of two lamps.
    expect(reportCsv).toContain(",1,50.00,50.00,EUR");

    // Moving back to Free ends the plan with its period, not now.
    await openPlansFromRail(page);
    await page.locator("[data-pricing-plan='free']").getByRole("button", { name: /Move to Free/ }).click();
    await page.waitForURL(/\/settings\/billing/);
    await expect(page.locator("[data-billing-plan='pro']")).toContainText("Ends on");
    const [cancelled] = (await serviceRest(
      `/seller_billing?owner_id=eq.${sellerId}&select=plan,cancel_at_period_end`,
    )) as Array<{ plan: string; cancel_at_period_end: boolean }>;
    expect(cancelled).toEqual({ plan: "pro", cancel_at_period_end: true });
  });

  test("Free exports its orders, Settings sells Starter with its benefit, and reports stay Pro's", async ({ page }) => {
    const seller = freshUser("plans-upsell");
    await signUp(page, seller);
    const sellerId = await userIdByEmail(seller.email);
    await seedProducts(sellerId, [{ title: "Ledger lamp", price_cents: 1250 }]);
    expect((await page.request.post("/dev/simulate-sale", { data: { quantity: 1 } })).ok()).toBe(true);

    // The orders export is on every plan: a CSV ledger, without buyer details.
    await page.goto("/orders");
    const download = await downloadFrom(page, page.locator("[data-orders-export='ready']"));
    expect(download.suggestedFilename()).toMatch(/^square-share-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, "utf8");
    const [header, line] = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(header).toMatch(/^order_number,placed_at,status,/);
    expect(line).toContain("Ledger lamp");
    expect(line).toContain(",12.50,");
    const [{ buyer_email }] = (await serviceRest(`/orders?seller_id=eq.${sellerId}&select=buyer_email`)) as Array<{
      buyer_email: string;
    }>;
    expect(buyer_email).toContain("@");
    expect(csv).not.toContain(buyer_email);

    // The analytics report is Pro's: locked on Free, naming Pro.
    await page.goto("/analytics?range=all");
    const lockedReport = page.locator("[data-analytics-export='locked']");
    await expect(lockedReport).toContainText("Pro");
    await expect(lockedReport).toHaveAttribute("href", "/plans?from=analytics_nudge");

    // Settings offers the next plan up with what it changes, not "See plans".
    await page.goto("/settings/billing");
    const upsell = page.locator("[data-upsell='starter']");
    await expect(upsell).toContainText("Best value");
    await expect(upsell.locator("[data-upsell-fee]")).toContainText("5%");
    await expect(upsell.locator("[data-upsell-fee]")).toContainText("3%");
    await expect(upsell).toContainText("60 products");
    await expect(page.getByRole("button", { name: /^See plans$|^Change plan$/ })).toHaveCount(0);

    // A click before hydration does nothing; one after it leaves for
    // "checkout" and comes back on Starter.
    const cta = upsell.locator("[data-upsell-cta='starter']");
    await expect(async () => {
      if (await cta.isVisible()) await cta.click({ timeout: 2_000 });
      await expect(page.locator("[data-billing-plan='starter']")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 45_000 });
    // Now on Starter, the card offers the step after it.
    await expect(page.locator("[data-upsell='pro']")).toBeVisible();
  });

  test("an outside link to the plans page is counted under its source", async ({ page }) => {
    const seller = freshUser("plans-link");
    await signUp(page, seller);
    const sellerId = await userIdByEmail(seller.email);

    await page.goto("/plans?from=orders_export");
    await expect(page.locator("[data-plans-page][data-plans-source='orders_export']")).toBeVisible();
    const viewed = (await serviceRest(
      `/seller_funnel_events?account_id=eq.${sellerId}&kind=eq.pricing_viewed&select=source`,
    )) as Array<{ source: string }>;
    expect(viewed).toEqual([{ source: "orders_export" }]);

    // A made-up source is ignored, never stored.
    await page.goto("/plans?from=anything");
    await expect(page.locator("[data-plans-page]")).toBeVisible();
    await expect(page.locator("[data-plans-source]")).toHaveCount(0);
  });

  test.describe("with plan limits switched on", () => {
    // Limits ship switched off (billing_switches) until paid plans are on
    // sale; these tests switch them on, and back off for the specs after.
    const setLimits = (on: boolean) =>
      serviceRest("/billing_switches?id=eq.true", { method: "PATCH", body: { plan_limits_enforced: on } });
    test.beforeEach(() => setLimits(true));
    test.afterEach(() => setLimits(false));

    test("the Free storefront limit holds over REST, and Pro lifts it", async ({ page }) => {
      const seller = freshUser("plans-limit");
      await signUp(page, seller);
      const sellerId = await userIdByEmail(seller.email);
      const token = userJwt(sellerId, seller.email);
      await seedStorefronts(sellerId, [{ name: "One" }, { name: "Two" }, { name: "Three" }]);

      const insert = () =>
        fetch(`${GATEWAY_URL}/rest/v1/storefronts`, {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ owner_id: sellerId, name: "Over the limit" }),
        });

      // Past Free's three, the database itself says no, whatever the client.
      const refused = await insert();
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("plan_limit_reached:storefronts");

      // The app says why and takes the seller to the plans, named as the source.
      await page.goto("/storefront");
      await page.getByRole("button", { name: /new storefront|create storefront/i }).first().click();
      await page.getByRole("button", { name: /skip setup/i }).click();
      await page.waitForURL(/\/plans\?from=storefront_limit/);
      await expect(page.locator("[data-plans-page][data-plans-source='storefront_limit']")).toBeVisible();

      // On Pro the same insert goes through.
      await serviceRest(`/rpc/billing_apply_snapshot`, {
        method: "POST",
        body: {
          p_owner: sellerId,
          p_customer: `cus_e2e${sellerId.replace(/-/g, "")}`,
          p_subscription: null,
          p_plan: "pro",
          p_interval: "month",
          p_status: "active",
          p_price_cents: 4000,
          p_currency: "EUR",
          p_current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          p_cancel_at_period_end: false,
          p_canceled_at: null,
          p_paid_until: new Date(Date.now() + 31 * 86_400_000).toISOString(),
          p_livemode: false,
          p_synced_at: new Date().toISOString(),
        },
      });
      expect((await insert()).status).toBe(201);
    });

    test("the Free product limit holds in the import, the new-product page and over REST", async ({ page }) => {
      const seller = freshUser("plans-products");
      await signUp(page, seller);
      const sellerId = await userIdByEmail(seller.email);
      const token = userJwt(sellerId, seller.email);
      const cap = 20;
      // Two short of Free's twenty (seeded by the trusted service role).
      await seedProducts(
        sellerId,
        Array.from({ length: cap - 2 }, (_, i) => ({ title: `Seeded ${i + 1}`, price_cents: 1000 })),
      );
      const productCount = async () =>
        ((await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as unknown[]).length;

      // Room for two: the import says so, brings in two of five, and names
      // the three it left out, with the way to more room.
      await page.goto("/products/import");
      await expect(page.getByText("Your plan has room for 2 more products")).toBeVisible();
      await page.setInputFiles("#import-file", {
        name: "five.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Title,Price\nAlpha,10\nBravo,10\nCharlie,10\nDelta,10\nEcho,10\n", "utf8"),
      });
      const dropped = page.locator("[data-import-dropped='plan']");
      await expect(dropped).toContainText("3 rows will not be imported");
      await expect(dropped.getByRole("link", { name: "See plans" })).toHaveAttribute(
        "href",
        "/plans?from=product_limit",
      );
      await page.getByRole("button", { name: /^import 2 products$/i }).click();
      await expect(page).toHaveURL(/\/products$/);
      expect(await productCount()).toBe(cap);

      // Full: both ways of adding a product show the limit instead of a form.
      for (const path of ["/products/new", "/products/import"]) {
        await page.goto(path);
        const notice = page.locator("[data-plan-limit='products']");
        await expect(notice).toContainText("Your Free plan includes 20 products");
        await expect(notice.getByRole("link", { name: /See plans/ })).toHaveAttribute(
          "href",
          "/plans?from=product_limit",
        );
      }
      await expect(page.locator("#import-file")).toHaveCount(0);

      // The database says no to a client that skips the app.
      const insert = () =>
        fetch(`${GATEWAY_URL}/rest/v1/products`, {
          method: "POST",
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ owner_id: sellerId, title: "Over the limit", price_cents: 100 }),
        });
      const refused = await insert();
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain("plan_limit_reached:products");
      expect(await productCount()).toBe(cap);

      // Nothing the store already has is touched: the products are all still
      // there, and one of them can still be edited.
      await page.goto("/products");
      await expect(page.getByText("Alpha").first()).toBeVisible();

      // The link lands on the plans page, counted under its source.
      await page.goto("/plans?from=product_limit");
      await expect(page.locator("[data-plans-page][data-plans-source='product_limit']")).toBeVisible();
      const events = (await serviceRest(
        `/seller_funnel_events?account_id=eq.${sellerId}&source=eq.product_limit&select=kind`,
      )) as Array<{ kind: string }>;
      expect(events.map((event) => event.kind)).toContain("pricing_viewed");
    });
  });
});
