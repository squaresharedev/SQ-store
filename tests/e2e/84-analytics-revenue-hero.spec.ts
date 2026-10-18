import { expect, test, type Page } from "@playwright/test";
import { freshUser, seedOrders, signUp, userIdByEmail } from "./helpers";

// THE ANALYTICS REVENUE HERO, in a real layout engine.
//
// Revenue is the page's headline: an area chart drawn on the page itself, in
// a frame of four corner marks instead of a card, with the figure laid over
// it in whichever top corner the line leaves free. None of that can be seen
// from jsdom, where every box is 0x0, so this is where it is held:
//
//   1. ITS CONTAINER IS NOT A CARD. Four ink corner marks stand around the
//      graph, on the page column the cards below share, and nothing else: no
//      border, no fill, no shadow. Inside it the graph runs from one side to
//      the other. The DATA stops short of both ends, so its first and last
//      values are never in the part that blurs away; a level tail runs on
//      from each to the frame's edge, and it is the tail that blurs.
//   2. The figure sits top left when the graph is going up and top right when
//      it is going down.
//   3. The line never runs under the figure, at either width. This is the
//      rule that keeps the layout readable, and the one a change to the
//      chart's height or the figure's size would silently break.
//   4. The hero still publishes `sales.revenue`, once, the way the tile it
//      replaced did (docs/analytics-datapoints.md).
//   5. A range with no sales is the same chart lying flat, in words and
//      without a "0.00".
//   6. The tails blur (they are not just faded to white), and the figure has
//      a blur behind it, neither of which may cost the page a sideways scroll.
//   7. VERSUS: when the period before the range sold anything, it is drawn as
//      a dashed reference under the line and the change is stated; when it
//      sold nothing, no comparison is drawn at all.
//   8. ONE VALUE: a one-day range has no line to draw, so its point is marked
//      instead of leaving the plot empty.

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
    // The measured line, not the dashed reference a comparison adds.
    const curve = node.querySelector<SVGPathElement>(".recharts-area-curve:not([stroke-dasharray])")!;
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
    // The tails: where each one's level line runs from and to, on screen.
    const tails = Array.from(node.querySelectorAll("[data-chart-tail]"), (tail) => {
      const line = tail.querySelector("line")!.getBoundingClientRect();
      const soft = tail.children[1] as SVGGElement;
      return {
        end: tail.getAttribute("data-chart-tail"),
        left: line.left,
        right: line.right,
        blurred: (soft.getAttribute("filter") ?? "").includes("-blur)"),
      };
    });
    return {
      tails,
      frame: { left: frame.left, right: frame.right },
      figure: { left: figure.left, right: figure.right, bottom: figure.bottom },
      lineStart,
      lineEnd,
      lineTopUnderFigure,
      // The frame around the chart: its box, its four marks, and whether it
      // is drawn as anything more than those marks.
      container: (() => {
        const outer = node.parentElement!;
        const box = outer.getBoundingClientRect();
        const style = getComputedStyle(outer);
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          boxed:
            style.borderTopWidth !== "0px" ||
            style.boxShadow !== "none" ||
            style.backgroundColor !== "rgba(0, 0, 0, 0)",
          marks: Array.from(outer.querySelectorAll(":scope > [data-revenue-corner]"), (mark) => {
            const at = mark.getBoundingClientRect();
            return { left: at.left, right: at.right, top: at.top, bottom: at.bottom };
          }),
        };
      })(),
      // The page column, as the first and last tiles under the hero mark it.
      column: (() => {
        const tiles = Array.from(
          document.querySelectorAll('[data-analytics-section="sales"] [data-analytics-metric]'),
        ).filter((tile) => !node.contains(tile));
        const boxes = tiles.map((tile) => tile.getBoundingClientRect());
        return {
          left: Math.min(...boxes.map((box) => box.left)),
          right: Math.max(...boxes.map((box) => box.right)),
        };
      })(),
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
  // The line is revealed left to right; it has arrived once its end tail has
  // reached the edge.
  await expect(async () => {
    const m = await measure(page);
    const end = m.tails.find((tail) => tail.end === "end");
    expect(end, "no end tail yet").toBeTruthy();
    expect(Math.abs(end!.right - m.frame.right)).toBeLessThan(2);
    expect(m.lineEnd).toBeGreaterThan(m.frame.right - 130);
  }).toPass({ timeout: 10_000 });
  return total;
}

/** The assertions every width shares. */
async function expectReadableBleed(page: Page, total: number, corner: "left" | "right") {
  const m = await measure(page);

  // 1. The container: four corner marks on the page column, and no box.
  expect(m.container.boxed, "the hero's container is drawn as a box").toBe(false);
  expect(m.container.marks).toHaveLength(4);
  expect(Math.abs(m.container.left - m.column.left)).toBeLessThan(1);
  expect(Math.abs(m.container.right - m.column.right)).toBeLessThan(1);
  for (const [edge, pick] of [
    ["left", Math.min],
    ["right", Math.max],
    ["top", Math.min],
    ["bottom", Math.max],
  ] as const) {
    // The outermost mark on each side sits exactly on that side of the frame.
    const outermost = pick(...m.container.marks.map((mark) => mark[edge]));
    expect(Math.abs(outermost - m.container[edge])).toBeLessThan(1);
  }
  // The chart fills the frame from side to side, between the marks.
  expect(Math.abs(m.frame.left - m.container.left)).toBeLessThan(1);
  expect(Math.abs(m.frame.right - m.container.right)).toBeLessThan(1);
  // The data keeps clear of both ends: at least 32px, at most 112px.
  const startGap = m.lineStart - m.frame.left;
  const endGap = m.frame.right - m.lineEnd;
  for (const gap of [startGap, endGap]) {
    expect(gap).toBeGreaterThanOrEqual(31);
    expect(gap).toBeLessThanOrEqual(113);
  }
  // And a blurred tail carries the graph on from each end value to the edge.
  const start = m.tails.find((tail) => tail.end === "start")!;
  const end = m.tails.find((tail) => tail.end === "end")!;
  expect(Math.abs(start.left - m.frame.left)).toBeLessThan(2);
  expect(Math.abs(start.right - m.lineStart)).toBeLessThan(2);
  expect(Math.abs(end.left - m.lineEnd)).toBeLessThan(2);
  expect(Math.abs(end.right - m.frame.right)).toBeLessThan(2);
  expect(start.blurred && end.blurred).toBe(true);
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
  test("a rising month: corner marks, figure top left, line clear of it", async ({ page }, testInfo) => {
    const total = await openHero(page, "hero-up", rising);
    await expectReadableBleed(page, total, "left");
    await page.screenshot({ path: testInfo.outputPath("hero-rising.png") });

    // The chart keeps its scale without an axis column: value labels inside
    // the plot, and a readout wherever the pointer is.
    const hero = page.locator(HERO);
    await expect(hero.locator(".recharts-yAxis-tick-labels text").first()).toBeVisible();
    // The data itself is never masked or blurred, and nor are the labels.
    await expect(hero.locator(".recharts-area-curve")).not.toHaveAttribute("mask");
    await expect(hero.locator(".recharts-yAxis-tick-labels text").first()).not.toHaveAttribute("mask");
    await expect(hero.locator(".blur-xl")).toHaveCount(1);
    // This seller's first sale is inside the range: the period before it sold
    // nothing, so there is one line and no claim about a change.
    await expect(hero.locator(".recharts-area-curve")).toHaveCount(1);
    await expect(hero.locator("[data-analytics-change]")).toHaveCount(0);
    await expect(hero.getByText(/vs previous period/)).toHaveCount(0);
    const box = (await hero.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7);
    await expect(hero.locator(".recharts-tooltip-wrapper")).toContainText("€");
    await page.screenshot({ path: testInfo.outputPath("hero-rising-hover.png") });
  });

  test("versus: the previous period is drawn under the line and the change is stated", async ({ page }, testInfo) => {
    const user = freshUser("hero-vs");
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
    const hero = page.locator(HERO);
    const curves = hero.locator(".recharts-area-curve");
    await expect(curves).toHaveCount(2, { timeout: 30_000 });
    // One measured line, one dashed reference.
    await expect(hero.locator(".recharts-area-curve[stroke-dasharray]")).toHaveCount(1);
    await expect(hero.locator("[data-analytics-change]")).toHaveAttribute("data-analytics-change", "0.25");
    await expect(hero.getByText("+25% vs previous period")).toBeVisible();
    await expectReadableBleed(page, 150_000, "left");

    // The readout names both, and the average order card compares too.
    await hero.scrollIntoViewIfNeeded();
    const box = (await hero.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    const readout = hero.locator(".recharts-tooltip-wrapper");
    await expect(readout).toContainText("Previous period");
    await expect(readout).toContainText("€50.00");
    await expect(readout).toContainText("€40.00");
    await page.screenshot({ path: testInfo.outputPath("hero-versus.png") });
    const aov = page.locator('[data-analytics-section="sales"] [data-analytics-panel="aov"]');
    await expect(aov.locator("ul").getByText("Previous period")).toBeVisible();

    // The machine-readable payload carries the same comparison.
    const snapshot = JSON.parse((await page.locator("#analytics-snapshot").textContent())!);
    expect(snapshot.previous.sales.revenueCents).toBe(120_000);
    expect(snapshot.previous.sales.series).toHaveLength(30);

    // All time has nothing before it: no comparison.
    await page.goto("/analytics?range=all");
    await expect(page.locator(`${HERO} .recharts-area-curve`).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`${HERO} [data-analytics-change]`)).toHaveCount(0);
  });

  test("one value: a one-day range marks its point instead of leaving the plot empty", async ({ page }, testInfo) => {
    const user = freshUser("hero-one");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 6_000, created_at: new Date(Date.now() - 60_000).toISOString() },
      { amount_cents: 4_000, created_at: new Date(Date.now() - DAY_MS - 60_000).toISOString() },
    ]);
    const today = new Date(Date.now() - 60_000).toISOString().slice(0, 10);

    await page.goto(`/analytics?from=${today}&to=${today}`);
    await page.mouse.move(0, 0);
    const hero = page.locator(HERO);
    await expect(hero).toHaveAttribute("data-analytics-state", "live", { timeout: 30_000 });
    // Today's point and yesterday's, each with a level through it.
    await expect(hero.locator(".recharts-area-dot")).toHaveCount(2);
    await expect(hero.locator(".recharts-reference-line")).toHaveCount(2);
    await expect(hero.getByText("+50% vs previous period")).toBeVisible();
    // The point is in the plot, clear of the figure, and not on an edge.
    const geometry = await hero.evaluate((node) => {
      const frame = node.getBoundingClientRect();
      const figure = node.querySelector('[data-analytics-metric="sales.revenue"]')!.getBoundingClientRect();
      const dots = Array.from(node.querySelectorAll(".recharts-area-dot"), (dot) => dot.getBoundingClientRect());
      return {
        centre: (frame.left + frame.right) / 2,
        figure: { right: figure.right, bottom: figure.bottom },
        dots: dots.map((dot) => ({ x: (dot.left + dot.right) / 2, top: dot.top })),
      };
    });
    for (const dot of geometry.dots) {
      expect(Math.abs(dot.x - geometry.centre)).toBeLessThan(2);
      expect(dot.x > geometry.figure.right || dot.top > geometry.figure.bottom).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("hero-one-value.png") });

    // The average order card under it has one value too, and marks it.
    const aov = page.locator('[data-analytics-section="sales"] [data-analytics-panel="aov"]');
    await expect(aov.locator(".recharts-line-dot")).toHaveCount(2);
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

    test("the frame keeps to the page column, not to the screen", async ({ page }, testInfo) => {
      const total = await openHero(page, "hero-wide", rising);
      await expectReadableBleed(page, total, "left");
      // The page column is narrower than the screen here, and the hero stays
      // on it with the cards: its figure stands a gutter in from the frame.
      const figure = (await page.locator('[data-analytics-metric="sales.revenue"]').boundingBox())!;
      const tile = (await page.locator('[data-analytics-metric="sales.count"]').boundingBox())!;
      const hero = (await page.locator(HERO).boundingBox())!;
      expect(Math.abs(hero.x - tile.x)).toBeLessThan(1);
      expect(figure.x - hero.x).toBeCloseTo(24, 0);
      expect(hero.x).toBeGreaterThan(256 + 100);
      await page.screenshot({ path: testInfo.outputPath("hero-wide.png") });
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("rising: the same rules at phone width", async ({ page }, testInfo) => {
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
