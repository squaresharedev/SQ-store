import { expect, test, type Page } from "@playwright/test";
import { freshUser, seedOrders, signUp, userIdByEmail } from "./helpers";

// THE ANALYTICS REVENUE LEAD, in a real layout engine.
//
// Since 2026-11-08 revenue leads the page the way the Payments tab leads with
// its earnings (components/analytics/look.ts, ANALYTICS_LOOK): a card with the
// figure on top, one line under it that adds the range up day by day, read by
// moving along it, and the sales tiles joined under it, each with its change
// and its own line. The charts further down keep their axes. None of that can
// be seen from jsdom, where every box is 0x0, so this is where it is held:
//
//   1. The figure sits ABOVE the line, in ink, and the line is the money
//      green. It is published as `sales.revenue`, once, as the tile it
//      replaced did (docs/analytics-datapoints.md).
//   2. The line is the running total: it never falls.
//   3. Moving along the line reads that day into the figure ("Up to ..."),
//      and leaving puts the range's total back.
//   4. VERSUS: when the period before sold anything, it is drawn dashed under
//      the line and the change is stated (`data-analytics-change`) as a chip;
//      when it sold nothing, nothing is compared.
//   5. ONE VALUE: a one-day range has no line to draw, so its point is marked.
//   6. A range with no sales is the same chart lying flat, in words and
//      without a "0.00".
//   7. None of it costs the page a sideways scroll, on a phone either.
//
// The older frame look (RevenueHero: corner marks, the figure over a bled
// chart) is no longer on /analytics; its geometry is held at /dev/charts and
// by 85-chart-stress.spec.ts.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 28;

/** One paid order a day across the default window, `amount(daysAgo)` cents each. */
async function seedDailyRevenue(sellerId: string, amount: (daysAgo: number) => number) {
  const orders = Array.from({ length: DAYS }, (_, daysAgo) => ({
    amount_cents: amount(daysAgo),
    // A minute back, so "today" cannot land in tomorrow's bucket.
    created_at: new Date(Date.now() - daysAgo * DAY_MS - 60_000).toISOString(),
  }));
  await seedOrders(sellerId, orders);
  return orders.reduce((sum, order) => sum + order.amount_cents, 0);
}

/** Low at the start of the window, high today. */
const rising = (daysAgo: number) => 2_000 + (DAYS - daysAgo) * 450 + (daysAgo % 3) * 300;

const LEAD = '[data-analytics-section="sales"] [data-analytics-panel="trend"]';
/** The lead's line: the scrub chart, not a tile's sparkline. */
const CHART = `${LEAD} [role="img"]`;

/** The lead's geometry and paint, in page pixels. */
async function measure(page: Page) {
  return page.locator(LEAD).evaluate((node) => {
    const figure = node.querySelector("[data-scrub-figure]")?.getBoundingClientRect() ?? null;
    const chart = node.querySelector('[role="img"]')!;
    const paths = Array.from(chart.querySelectorAll("path"));
    // The measured line: stroked, not dashed, not the wash under it.
    const line = paths.find((path) => path.getAttribute("fill") === "none" && !path.getAttribute("stroke-dasharray"))!;
    const length = line.getTotalLength();
    const toScreen = line.getScreenCTM()!;
    const ys = Array.from({ length: 60 }, (_, i) => line.getPointAtLength((length * i) / 59).matrixTransform(toScreen).y);
    const style = getComputedStyle(node);
    const figureNode = node.querySelector("[data-scrub-figure]");
    const heading = document.querySelector('[data-analytics-section="sales"] h2')!;
    return {
      figure,
      chart: chart.getBoundingClientRect(),
      lineStroke: line.getAttribute("stroke"),
      dashed: paths.filter((path) => path.getAttribute("stroke-dasharray")).length,
      // Screen y grows downward: a line that never falls never has a later
      // point lower on screen than an earlier one (a pixel of curve allowed).
      neverFalls: ys.every((y, i) => i === 0 || y <= ys[i - 1] + 1),
      lineBox: line.getBoundingClientRect(),
      boxed: style.backgroundColor !== "rgba(0, 0, 0, 0)",
      figureInk: figureNode ? getComputedStyle(figureNode).color === getComputedStyle(heading).color : null,
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

/** Load the page for a seller with `amount`-shaped revenue. */
async function openLead(page: Page, tag: string, amount: (daysAgo: number) => number) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const total = await seedDailyRevenue(sellerId, amount);
  await page.goto("/analytics");
  // Signing up left the pointer wherever the form's button was: park it, so
  // no day is being read out that the test did not ask for.
  await page.mouse.move(0, 0);
  await expect(page.locator(`${CHART} svg path`).first()).toBeAttached({ timeout: 30_000 });
  return total;
}

/** The rules every width shares. */
async function expectReadableLead(page: Page, total: number) {
  const m = await measure(page);
  // 1. A card, the figure above the line in ink, the line green.
  expect(m.boxed, "the lead is drawn as a card").toBe(true);
  expect(m.figure).not.toBeNull();
  expect(m.figure!.bottom).toBeLessThan(m.chart.top);
  expect(m.figureInk, "the figure is ink, not green").toBe(true);
  expect(m.lineStroke).toBe("var(--chart-positive)");
  const metric = page.locator('[data-analytics-metric="sales.revenue"]');
  await expect(metric).toHaveCount(1);
  await expect(metric).toHaveAttribute("data-analytics-value", String(total));
  await expect(metric).toHaveAttribute("data-analytics-unit", "currency_cents");
  await expect(page.locator(LEAD)).toHaveAttribute("data-analytics-state", "live");
  // 2. Running: it only climbs.
  expect(m.neverFalls).toBe(true);
  // 7. No sideways scroll.
  expect(m.scrollWidth).toBeLessThanOrEqual(m.viewport);
}

test.describe("analytics revenue lead", () => {
  test("a rising month: figure over a running line, tiles joined under it, scrubbing reads a day", async ({ page }, testInfo) => {
    const total = await openLead(page, "lead-up", rising);
    await expectReadableLead(page, total);

    // This seller's first sale is inside the range: the period before sold
    // nothing, so there is one line and no claim about a change.
    const m = await measure(page);
    expect(m.dashed).toBe(0);
    await expect(page.locator(`${LEAD} [data-analytics-change]`)).toHaveCount(0);

    // The tiles are joined to the lead (one block), each publishing its
    // figure, and the two with a series draw it.
    const block = page.locator(LEAD).locator("xpath=..");
    const tiles = block.locator("[data-trend-tiles]");
    await expect(tiles).toHaveCount(1);
    await expect(tiles.locator("[data-analytics-metric]")).toHaveCount(4);
    await expect(tiles.locator('[data-analytics-metric="sales.count"] [role="img"]')).toHaveCount(1);
    await expect(tiles.locator('[data-analytics-metric="sales.aov"] [role="img"]')).toHaveCount(1);

    // 3. Scrubbing: the figure reads the day out, and comes back.
    const figure = page.locator(`${LEAD} [data-scrub-figure]`);
    const atRest = await figure.innerText();
    const box = (await page.locator(CHART).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect(page.locator(LEAD).getByText(/^Up to /)).toBeVisible();
    await expect(figure).not.toHaveText(atRest);
    await page.screenshot({ path: testInfo.outputPath("lead-scrub.png") });
    await page.mouse.move(0, 0);
    await expect(figure).toHaveText(atRest);

    // The charts under it keep their axes.
    const aov = page.locator('[data-analytics-section="sales"] [data-analytics-panel="aov"]');
    await expect(aov.locator(".recharts-yAxis-tick-labels text").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("lead-rising.png") });
  });

  test("versus: the period before is drawn dashed and the change is stated", async ({ page }, testInfo) => {
    const user = freshUser("lead-vs");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // The 30 days before the range: a flat 40.00 a day, 1,200.00 in all.
    await seedOrders(
      sellerId,
      Array.from({ length: 30 }, (_, i) => ({
        amount_cents: 4_000,
        created_at: new Date(Date.now() - (30 + i) * DAY_MS - 60_000).toISOString(),
      })),
    );
    // The range itself: a flat 50.00 a day, 1,500.00 in all. Up a quarter.
    await seedOrders(
      sellerId,
      Array.from({ length: 30 }, (_, i) => ({
        amount_cents: 5_000,
        created_at: new Date(Date.now() - i * DAY_MS - 60_000).toISOString(),
      })),
    );

    await page.goto("/analytics");
    await page.mouse.move(0, 0);
    const lead = page.locator(LEAD);
    await expect(lead.locator("[data-analytics-change]")).toHaveAttribute("data-analytics-change", "0.25", {
      timeout: 30_000,
    });
    await expect(lead.getByText("vs €1,200.00 before")).toBeVisible();
    await expect(lead.locator("[data-analytics-change]").getByText("25%")).toBeVisible();
    expect((await measure(page)).dashed).toBe(1);
    await expectReadableLead(page, 150_000);
    // The table twin names both lines.
    await expect(lead.locator("table th", { hasText: "Previous period" })).toHaveCount(1);
    // The average order tile compares too: 50.00 against 40.00.
    const aovTile = page.locator('[data-trend-tiles] [data-analytics-metric="sales.aov"]');
    await expect(aovTile.getByText("25%")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("lead-versus.png") });

    // The machine-readable payload carries the same comparison.
    const snapshot = JSON.parse((await page.locator("#analytics-snapshot").textContent())!);
    expect(snapshot.previous.sales.revenueCents).toBe(120_000);

    // All time has nothing before it: no comparison.
    await page.goto("/analytics?range=all");
    await expect(page.locator(`${CHART} svg path`).first()).toBeAttached({ timeout: 30_000 });
    await expect(page.locator(`${LEAD} [data-analytics-change]`)).toHaveCount(0);
  });

  test("one value: a one-day range marks its point instead of leaving the plot empty", async ({ page }, testInfo) => {
    const user = freshUser("lead-one");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 6_000, created_at: new Date(Date.now() - 60_000).toISOString() },
      { amount_cents: 4_000, created_at: new Date(Date.now() - DAY_MS - 60_000).toISOString() },
    ]);
    const today = new Date(Date.now() - 60_000).toISOString().slice(0, 10);

    await page.goto(`/analytics?from=${today}&to=${today}`);
    await page.mouse.move(0, 0);
    const lead = page.locator(LEAD);
    await expect(lead).toHaveAttribute("data-analytics-state", "live", { timeout: 30_000 });
    // Today's point and yesterday's, each marked with a level through it.
    await expect(lead.locator("[data-scrub-lone]")).toHaveCount(2);
    await expect(lead.locator("[data-analytics-change]")).toHaveAttribute("data-analytics-change", "0.5");
    await page.screenshot({ path: testInfo.outputPath("lead-one-value.png") });

    // The average order card under it has one value too, and marks it.
    const aov = page.locator('[data-analytics-section="sales"] [data-analytics-panel="aov"]');
    await expect(aov.locator(".recharts-line-dot")).toHaveCount(2);
  });

  test("no sales: the same chart lying flat, in words, without a zero figure", async ({ page }, testInfo) => {
    const user = freshUser("lead-none");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // A refund only: the page is past first-run, and the range holds no sale.
    await seedOrders(sellerId, [{ amount_cents: 4_000, status: "refunded" }]);

    await page.goto("/analytics");
    await page.mouse.move(0, 0);
    const lead = page.locator(LEAD);
    await expect(lead).toHaveAttribute("data-analytics-state", "empty", { timeout: 30_000 });
    const metric = lead.locator('[data-analytics-metric="sales.revenue"]');
    await expect(metric.getByText("No sales in this range")).toBeVisible();
    await expect(metric).not.toContainText("€");
    await expect(lead.locator("[data-scrub-figure]")).toHaveCount(0);

    // Still a chart, still dated: only flat, and not green.
    const m = await measure(page);
    expect(m.lineBox.height).toBeLessThan(1);
    expect(m.lineStroke).not.toBe("var(--chart-positive)");
    await page.screenshot({ path: testInfo.outputPath("lead-empty.png") });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("rising: the same rules at phone width", async ({ page }, testInfo) => {
      const total = await openLead(page, "lead-up-m", rising);
      await expectReadableLead(page, total);
      await page.locator(LEAD).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("lead-phone.png"), fullPage: false });
    });
  });
});
