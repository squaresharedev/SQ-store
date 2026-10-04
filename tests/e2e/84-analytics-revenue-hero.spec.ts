import { expect, test, type Page } from "@playwright/test";
import { freshUser, seedOrders, signUp, userIdByEmail } from "./helpers";

// THE ANALYTICS REVENUE HERO, in a real layout engine.
//
// Revenue is the page's headline: an area chart drawn on the page itself, from
// the left edge of the screen to the right, with the figure laid over it in
// whichever top corner the line leaves free. None of that can be seen from
// jsdom, where every box is 0x0, so this is where it is held:
//
//   1. The line really does start and end on the edges (the sidebar's edge on
//      a desktop, the screen's on a phone), and that costs no sideways scroll.
//   2. The figure sits top left when the graph is going up and top right when
//      it is going down.
//   3. The line never runs under the figure, at either width. This is the
//      rule that keeps the layout readable, and the one a change to the
//      chart's height or the figure's size would silently break.
//   4. The hero still publishes `sales.revenue`, once, the way the tile it
//      replaced did (docs/analytics-datapoints.md).
//   5. A range with no sales is the same chart lying flat, in words and
//      without a "0.00".

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
/** High at the start of the window, low today. */
const falling = (daysAgo: number) => 2_000 + daysAgo * 450 + (daysAgo % 3) * 300;

const HERO = '[data-analytics-section="sales"] [data-analytics-panel="trend"]';

/** Where the hero, its figure and its line actually are, in page pixels. */
async function measure(page: Page) {
  return page.locator(HERO).evaluate((node) => {
    const frame = node.getBoundingClientRect();
    const figure = node
      .querySelector('[data-analytics-metric="sales.revenue"]')!
      .getBoundingClientRect();
    const curve = node.querySelector<SVGPathElement>(".recharts-area-curve")!;
    const toScreen = curve.getScreenCTM()!;
    const length = curve.getTotalLength();
    const samples = 800;
    let lineStart = Infinity;
    let lineEnd = -Infinity;
    // Screen y grows downward, so the line's HIGHEST point under the figure is
    // its smallest y there.
    let lineTopUnderFigure = Infinity;
    for (let i = 0; i <= samples; i += 1) {
      const point = curve.getPointAtLength((length * i) / samples).matrixTransform(toScreen);
      lineStart = Math.min(lineStart, point.x);
      lineEnd = Math.max(lineEnd, point.x);
      if (point.x >= figure.left && point.x <= figure.right) {
        lineTopUnderFigure = Math.min(lineTopUnderFigure, point.y);
      }
    }
    return {
      frame: { left: frame.left, right: frame.right },
      figure: { left: figure.left, right: figure.right, bottom: figure.bottom },
      lineStart,
      lineEnd,
      lineTopUnderFigure,
      contentLeft: document.getElementById("main-content")!.getBoundingClientRect().left,
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

/** Load the page for a seller with `amount`-shaped revenue and wait for the
 *  chart to finish drawing itself in. */
async function openHero(page: Page, tag: string, amount: (daysAgo: number) => number) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const total = await seedDailyRevenue(sellerId, amount);

  await page.goto("/analytics");
  // Signing up left the pointer wherever the form's button was, which is now
  // over the chart: park it, so no readout is open that the test did not ask for.
  await page.mouse.move(0, 0);
  await expect(page.locator(`${HERO} .recharts-area-curve`)).toBeVisible({ timeout: 30_000 });
  // The line is revealed left to right; it has arrived once it reaches the edge.
  await expect(async () => {
    const m = await measure(page);
    expect(Math.abs(m.lineEnd - m.frame.right)).toBeLessThan(2);
  }).toPass({ timeout: 10_000 });
  return total;
}

/** The assertions every width shares. */
async function expectReadableBleed(page: Page, total: number, corner: "left" | "right") {
  const m = await measure(page);

  // 1. Edge to edge of the page area, and no sideways scroll for it.
  expect(Math.abs(m.frame.left - m.contentLeft)).toBeLessThan(1);
  expect(Math.abs(m.frame.right - m.viewport)).toBeLessThan(1);
  expect(Math.abs(m.lineStart - m.frame.left)).toBeLessThan(2);
  expect(Math.abs(m.lineEnd - m.frame.right)).toBeLessThan(2);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.viewport);

  // 2. The corner follows the graph.
  const figureCentre = (m.figure.left + m.figure.right) / 2;
  const frameCentre = (m.frame.left + m.frame.right) / 2;
  if (corner === "left") expect(figureCentre).toBeLessThan(frameCentre);
  else expect(figureCentre).toBeGreaterThan(frameCentre);

  // 3. The line stays below the figure wherever it passes under it.
  expect(m.lineTopUnderFigure).toBeGreaterThan(m.figure.bottom);

  // 4. Published once, as the raw figure.
  const metric = page.locator('[data-analytics-metric="sales.revenue"]');
  await expect(metric).toHaveCount(1);
  await expect(metric).toHaveAttribute("data-analytics-value", String(total));
  await expect(metric).toHaveAttribute("data-analytics-unit", "currency_cents");
  await expect(page.locator(HERO)).toHaveAttribute("data-analytics-state", "live");
}

test.describe("analytics revenue hero", () => {
  test("a rising month: edge to edge, figure top left, line clear of it", async ({ page }, testInfo) => {
    const total = await openHero(page, "hero-up", rising);
    await expectReadableBleed(page, total, "left");
    await page.screenshot({ path: testInfo.outputPath("hero-rising.png") });

    // The chart keeps its scale without an axis column: value labels inside
    // the plot, and a readout wherever the pointer is.
    const hero = page.locator(HERO);
    await expect(hero.locator(".recharts-yAxis-tick-labels text").first()).toBeVisible();
    const box = (await hero.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7);
    await expect(hero.locator(".recharts-tooltip-wrapper")).toContainText("€");
    await page.screenshot({ path: testInfo.outputPath("hero-rising-hover.png") });
  });

  test("a falling month moves the figure to the top right", async ({ page }, testInfo) => {
    const total = await openHero(page, "hero-down", falling);
    await expectReadableBleed(page, total, "right");
    await page.screenshot({ path: testInfo.outputPath("hero-falling.png") });
  });

  test("no sales: the same chart lying flat, in words, without a zero figure", async ({ page }, testInfo) => {
    const user = freshUser("hero-none");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // A refund only: the page is past first-run, and the range holds no sale.
    await seedOrders(sellerId, [{ amount_cents: 4_000, status: "refunded" }]);

    await page.goto("/analytics");
    await page.mouse.move(0, 0);
    const hero = page.locator(HERO);
    await expect(hero).toHaveAttribute("data-analytics-state", "empty", { timeout: 30_000 });
    const figure = hero.locator('[data-analytics-metric="sales.revenue"]');
    await expect(figure.getByText("No sales in this range")).toBeVisible();
    await expect(figure).not.toContainText("€");

    // Still a chart, still edge to edge, still dated: only flat, and not green.
    // (Counted, not "visible": a perfectly flat path has a box with no height,
    // which is exactly what is being asserted two lines down.)
    const curve = hero.locator(".recharts-area-curve");
    await expect(curve).toHaveCount(1);
    await expect(hero.locator(".recharts-xAxis-tick-labels text").first()).toBeVisible();
    const shape = await curve.evaluate((path: SVGPathElement) => {
      const box = path.getBoundingClientRect();
      return { height: box.height, stroke: path.getAttribute("stroke") };
    });
    expect(shape.height).toBeLessThan(1);
    expect(shape.stroke).not.toBe("var(--chart-positive)");
    const box = (await hero.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(320);
    await page.screenshot({ path: testInfo.outputPath("hero-empty.png") });
  });

  test.describe("on a wide screen", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("the chart still reaches both edges while the figure stays over the cards", async ({ page }, testInfo) => {
      const total = await openHero(page, "hero-wide", rising);
      await expectReadableBleed(page, total, "left");
      // The page column is narrower than the screen here. The chart ignores
      // it; the figure does not, so it lines up with the first tile below.
      const figure = (await page.locator('[data-analytics-metric="sales.revenue"]').boundingBox())!;
      const tile = (await page.locator('[data-analytics-metric="sales.count"]').boundingBox())!;
      const hero = (await page.locator(HERO).boundingBox())!;
      expect(Math.abs(figure.x - tile.x)).toBeLessThan(1);
      expect(figure.x - hero.x).toBeGreaterThan(100);
      await page.screenshot({ path: testInfo.outputPath("hero-wide.png") });
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("rising: the same rules at full screen width", async ({ page }, testInfo) => {
      const total = await openHero(page, "hero-up-m", rising);
      await expectReadableBleed(page, total, "left");
      await page.locator(HERO).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("hero-phone-rising.png") });
    });

    test("falling: the figure is on the right and still clear of the line", async ({ page }, testInfo) => {
      const total = await openHero(page, "hero-down-m", falling);
      await expectReadableBleed(page, total, "right");
      await page.locator(HERO).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("hero-phone-falling.png") });
    });
  });
});
