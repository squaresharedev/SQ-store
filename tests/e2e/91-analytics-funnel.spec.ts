import { expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  seedOrders,
  seedSignals,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// The analytics page's FUNNEL: from a storefront shown on the seller's own
// site to a paid order.
//
// What these guard:
//
//  1. A rate is never shown without the counts it came from, and never below
//     50 views. "15 orders per 100 views" from twenty views is a number that
//     makes a seller change something that was working.
//  2. A store nobody has embedded has no funnel section at all.
//  3. The checkout counts come from the daily table a scheduled job fills, and
//     a seller's page only ever shows their own rows.
//  4. The copy says "per 100 views", never "per visitor".

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

async function storefrontFor(sellerId: string, name: string) {
  await seedStorefronts(sellerId, [{ name }]);
  const rows = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  return rows[0].id;
}

/** What the scheduled job does for one day, done by hand. */
async function rollDay(
  day: string,
  rows: { seller_id: string; store_id: string; event: string; events: number }[],
) {
  await serviceRest(`/rpc/storefront_funnel_roll_day`, {
    method: "POST",
    body: {
      p_day: day,
      p_rows: rows.map((row) => ({
        product_id: "00000000-0000-4000-8000-000000000001",
        referrer_host: "",
        placement_id: "",
        ...row,
      })),
    },
  });
}

const funnel = (page: Page) => page.locator('[data-analytics-section="funnel"]');
const metric = (page: Page, name: string) => funnel(page).locator(`[data-analytics-metric="funnel.${name}"]`);

test.describe("analytics, storefront funnel", () => {
  test("shows counts beside every rate once there are enough views", async ({ page }) => {
    const user = freshUser("funnel");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await storefrontFor(sellerId, "Funnel shop");

    const stranger = freshUser("funnelother");
    const otherPage = await page.context().browser()!.newPage();
    await signUp(otherPage, stranger);
    const strangerId = await userIdByEmail(stranger.email);
    await otherPage.close();

    await seedSignals(sellerId, [
      ...Array.from({ length: 80 }, (_, i) => ({
        kind: "storefront_view" as const,
        storefrontId,
        daysAgo: (i % 6) + 1,
      })),
      // Hosted-page views are not the embed's, and stay out of the funnel.
      ...Array.from({ length: 30 }, () => ({
        kind: "storefront_view" as const,
        storefrontId,
        channel: "direct" as const,
        daysAgo: 2,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        kind: "product_click" as const,
        storefrontId,
        daysAgo: (i % 4) + 1,
      })),
    ]);
    await seedOrders(sellerId, [
      { amount_cents: 2500, channel: "embed", created_at: new Date(Date.now() - DAY_MS).toISOString() },
      { amount_cents: 4000, channel: "embed", created_at: new Date(Date.now() - 2 * DAY_MS).toISOString() },
      // A sale that did not come through the embed is not the embed's order.
      { amount_cents: 9000, channel: "direct", created_at: new Date(Date.now() - DAY_MS).toISOString() },
    ]);
    await rollDay(isoDaysAgo(1), [
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_started", events: 6 },
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_expired", events: 2 },
      // Another seller's day, in the same run of the job.
      { seller_id: strangerId, store_id: storefrontId, event: "checkout_started", events: 400 },
      { seller_id: strangerId, store_id: storefrontId, event: "checkout_expired", events: 400 },
    ]);
    await rollDay(isoDaysAgo(2), [
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_started", events: 4 },
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_expired", events: 1 },
    ]);

    await page.goto("/analytics");
    await expect(funnel(page)).toBeVisible({ timeout: 20_000 });

    await expect(metric(page, "embed_views")).toHaveAttribute("data-analytics-value", "80");
    await expect(metric(page, "product_opens")).toHaveAttribute("data-analytics-value", "12");
    await expect(metric(page, "checkouts_started")).toHaveAttribute("data-analytics-value", "10");
    await expect(metric(page, "checkouts_expired")).toHaveAttribute("data-analytics-value", "3");

    // 2 embed orders from 80 embed views: 2.5 per 100, with both counts shown.
    const conversion = metric(page, "orders_per_100_views");
    await expect(conversion).toHaveAttribute("data-analytics-value", "2.5");
    await expect(conversion).toContainText("2.5");
    await expect(conversion).toContainText("Orders: 2, views: 80");

    // 3 of 10 checkouts left unpaid.
    const abandonment = metric(page, "checkout_abandonment");
    await expect(abandonment).toHaveAttribute("data-analytics-value", "30");
    await expect(abandonment).toContainText("30.0%");
    await expect(abandonment).toContainText("Left unpaid: 3, started: 10");

    await expect(funnel(page).getByText("Orders per 100 views")).toBeVisible();
    await expect(funnel(page).getByText(/per visitor/i)).toHaveCount(0);
    await expect(funnel(page).getByText("Not enough data yet")).toHaveCount(0);

    // The published snapshot carries the same counts.
    const snapshot = JSON.parse((await page.locator("#analytics-snapshot").textContent())!) as {
      funnel: Record<string, number | boolean>;
    };
    expect(snapshot.funnel).toEqual({
      checkoutsAvailable: true,
      embedViews: 80,
      productOpens: 12,
      embedOrders: 2,
      checkoutsStarted: 10,
      checkoutsExpired: 3,
    });

    await page.screenshot({ path: "test-results/funnel-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await funnel(page).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(1);
    await funnel(page).screenshot({ path: "test-results/funnel-phone.png" });
  });

  test("below 50 views it shows the counts and no rate", async ({ page }) => {
    const user = freshUser("funnelthin");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    const storefrontId = await storefrontFor(sellerId, "Quiet shop");

    await seedSignals(
      sellerId,
      Array.from({ length: 20 }, (_, i) => ({
        kind: "storefront_view" as const,
        storefrontId,
        daysAgo: (i % 5) + 1,
      })),
    );
    await seedOrders(sellerId, [
      { amount_cents: 2500, channel: "embed", created_at: new Date(Date.now() - DAY_MS).toISOString() },
      { amount_cents: 2500, channel: "embed", created_at: new Date(Date.now() - DAY_MS).toISOString() },
      { amount_cents: 2500, channel: "embed", created_at: new Date(Date.now() - DAY_MS).toISOString() },
    ]);
    await rollDay(isoDaysAgo(1), [
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_started", events: 4 },
      { seller_id: sellerId, store_id: storefrontId, event: "checkout_expired", events: 1 },
    ]);

    await page.goto("/analytics");
    await expect(funnel(page)).toBeVisible({ timeout: 20_000 });

    // Three orders from twenty views would be "15 per 100". It is not said.
    await expect(metric(page, "orders_per_100_views")).toHaveCount(0);
    await expect(metric(page, "checkout_abandonment")).toHaveCount(0);
    await expect(funnel(page).getByText("Not enough data yet")).toHaveCount(2);
    await expect(funnel(page).getByText(/15(\.0)?\b/)).toHaveCount(0);
    // The counts are all still there.
    await expect(metric(page, "embed_views")).toHaveAttribute("data-analytics-value", "20");
    await expect(metric(page, "checkouts_started")).toHaveAttribute("data-analytics-value", "4");
    await expect(funnel(page).getByText("Orders: 3, views: 20")).toBeVisible();
    await expect(funnel(page).getByText("Rates appear once this range holds 50 views.")).toBeVisible();
    await funnel(page).screenshot({ path: "test-results/funnel-thin.png" });
  });

  test("a store with no embed activity has no funnel section", async ({ page }) => {
    const user = freshUser("funnelnone");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await storefrontFor(sellerId, "Unembedded shop");
    await seedOrders(sellerId, [
      { amount_cents: 2500, channel: "direct", created_at: new Date(Date.now() - DAY_MS).toISOString() },
    ]);

    await page.goto("/analytics");
    await expect(page.locator('[data-analytics-section="sales"]')).toBeVisible({ timeout: 20_000 });
    await expect(funnel(page)).toHaveCount(0);
  });
});
