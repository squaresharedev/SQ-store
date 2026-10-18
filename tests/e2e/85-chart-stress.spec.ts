import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// THE ANALYTICS CHARTS AT THEIR LIMITS.
//
// /dev/charts/stress draws every analytics chart on the worst data a store can
// produce: one sale, nearly a billion, nothing, three years, a product titled
// with a paragraph, an emoji, another script, or nothing at all. This walks
// that page at every screen size a seller could hold, in more than one
// language, and asks of each chart the things that make a chart useless when
// they fail:
//
//   - nothing a person reads leaves its box, is cut off, or sits on top of
//     something else, and the page never scrolls sideways;
//   - an axis never says the same thing twice, and never counts sales in
//     fractions;
//   - the revenue figure stays inside its frame, clear of the line, the
//     points and the axis labels;
//   - every chart has a name and a way to reach its numbers without a pointer.
//
// No sign-in and no seeding: the page is a dev route with its data built in.

const STRESS = "/dev/charts/stress";

/** Runs in the page. Every way a chart on it is unreadable, as sentences. */
function audit(): string[] {
  const out: string[] = [];
  type Box = { left: number; right: number; top: number; bottom: number };
  const hit = (a: Box, b: Box, pad = 0) =>
    a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
  const visible = (el: Element) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || el.closest(".sr-only")) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
  };
  const said = (el: Element) => (el.textContent ?? "").trim();

  for (const section of document.querySelectorAll("[data-stress-case]")) {
    const id = section.getAttribute("data-stress-case") ?? "";
    const bounds = section.getBoundingClientRect();
    const say = (problem: string, detail = "") => out.push(`${id}: ${problem}${detail ? ` (${detail})` : ""}`);

    // Nothing a person reads leaves the case's own box sideways.
    for (const el of section.querySelectorAll("svg text, p, span, li, h3, th, td, dt, dd")) {
      if (!visible(el) || !said(el) || el.querySelector("p, span, li")) continue;
      const box = el.getBoundingClientRect();
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) say("text leaves its box", said(el).slice(0, 30));
    }

    // Axis labels: none cut by the drawing, none repeated, none on another.
    for (const group of section.querySelectorAll(".recharts-cartesian-axis-tick-labels")) {
      const labels = [...group.querySelectorAll("text")].filter(visible);
      const drawing = group.closest("svg")!.getBoundingClientRect();
      const seen = new Set<string>();
      labels.forEach((label, index) => {
        const box = label.getBoundingClientRect();
        if (box.left < drawing.left - 1 || box.right > drawing.right + 1) say("axis label cut off", said(label));
        if (seen.has(said(label))) say("axis label repeated", said(label));
        seen.add(said(label));
        for (const other of labels.slice(index + 1)) {
          if (hit(box, other.getBoundingClientRect(), 1)) say("axis labels overlap", `${said(label)} / ${said(other)}`);
        }
      });
    }

    // The revenue hero: its figure stays in the frame, and clear of the rest.
    const hero = section.querySelector('[data-analytics-panel="trend"]');
    const figure = hero?.querySelector('[data-analytics-metric="sales.revenue"]');
    if (hero && figure) {
      const frame = hero.getBoundingClientRect();
      const box = figure.getBoundingClientRect();
      if (box.left < frame.left - 1 || box.right > frame.right + 1) say("figure wider than its frame");
      for (const label of hero.querySelectorAll(".recharts-cartesian-axis-tick-labels text")) {
        if (visible(label) && hit(box, label.getBoundingClientRect(), 1)) say("axis label under the figure", said(label));
      }
      const curve = hero.querySelector<SVGPathElement>(".recharts-area-curve:not([stroke-dasharray])");
      if (curve && curve.getTotalLength() > 0) {
        const toScreen = curve.getScreenCTM()!;
        const length = curve.getTotalLength();
        for (let i = 0; i <= 400; i += 1) {
          const point = curve.getPointAtLength((length * i) / 400).matrixTransform(toScreen);
          if (point.x >= box.left && point.x <= box.right && point.y < box.bottom) {
            say("line runs under the figure");
            break;
          }
        }
      }
      for (const dot of hero.querySelectorAll(".recharts-area-dot")) {
        if (hit(box, dot.getBoundingClientRect())) say("point under the figure");
      }
      if (hero.parentElement!.querySelectorAll(":scope > [data-revenue-corner]").length !== 4) say("corner marks missing");
      // A graph with no scale is a shape, not a chart.
      if (curve && ![...hero.querySelectorAll(".recharts-yAxis-tick-labels text")].some(visible)) say("no value labels");
    }

    // Every chart has a name, and its numbers somewhere a pointer is not needed.
    for (const chart of section.querySelectorAll('[role="group"]')) {
      if (!chart.getAttribute("aria-label")) say("chart has no accessible name");
      if (chart.querySelector(".recharts-wrapper") && !chart.querySelector("table") && !chart.querySelector("ul li")) {
        say("chart has neither a table twin nor a value legend");
      }
    }
  }

  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth) out.push(`page scrolls sideways by ${page.scrollWidth - page.clientWidth}px`);
  return out;
}

/** The value-axis labels of one case, as printed. */
const axisLabels = (page: Page, id: string) =>
  page.locator(`[data-stress-case="${id}"] .recharts-yAxis-tick-labels text`).allTextContents();

async function openStress(page: Page) {
  await page.goto(STRESS);
  await expect(page.locator("[data-stress-case] .recharts-wrapper").first()).toBeVisible({ timeout: 60_000 });
  // Entrances, count-ups and the hero's measured layout all settle.
  await page.waitForTimeout(2_500);
}

const SCREENS = [
  { name: "a 320px phone", width: 320, height: 568 },
  { name: "a 390px phone", width: 390, height: 844 },
  { name: "a phone on its side", width: 844, height: 390 },
  { name: "a tablet", width: 768, height: 1024 },
  { name: "a laptop", width: 1280, height: 800 },
  { name: "a 2560px monitor", width: 2560, height: 1440 },
];

test.describe("analytics charts at their limits", () => {
  for (const screen of SCREENS) {
    test(`every chart stays readable on ${screen.name}`, async ({ page }) => {
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await openStress(page);
      expect(await page.evaluate(audit)).toEqual([]);
    });
  }

  // Money and counts print longer in other languages ("1,5 Mio. €"), and so
  // does the copy around them. German and French are the longest the app has.
  for (const locale of ["de", "fr"]) {
    test(`every chart stays readable in ${locale}, on a phone and a laptop`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "ss_locale", value: locale, url: baseURL! }]);
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await openStress(page);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        expect(await page.evaluate(audit), `at ${width}px`).toEqual([]);
      }
    });
  }

  test("counts are counted in whole things, and large numbers stay short", async ({ page }) => {
    await openStress(page);
    // One sale in a week: gridlines at 0, 1, 2..., never at a quarter of a sale.
    for (const id of ["week-one-sale", "views-ones"]) {
      const labels = await axisLabels(page, id);
      expect(labels.length, id).toBeGreaterThan(1);
      for (const label of labels) expect(label, id).toMatch(/^\d+$/);
    }
    // Millions are "M", not thousands of thousands.
    expect((await axisLabels(page, "aov-millions")).join(" ")).toMatch(/€\d+(\.\d)?M/);
    expect((await axisLabels(page, "views-millions")).join(" ")).toMatch(/\dM/);
    // A product with no title is still named, in the legend and on the axis.
    await expect(page.locator('[data-stress-case="week-long-titles"] ul')).toContainText("Untitled product");
    const products = page.locator('[data-stress-case="top-products-long"]');
    await expect(products.locator(".recharts-yAxis-tick-labels")).toContainText("Untitled");
    // And a product that earned one cent beside one that earned a billion
    // still has a bar to point at: four products, four bars with a width.
    const widths = await products
      .locator(".recharts-bar-rectangle path")
      .evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().width));
    expect(widths).toHaveLength(4);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(2);
  });

  test("the charts pass an accessibility scan, and work from the keyboard", async ({ page }) => {
    test.setTimeout(120_000);
    await openStress(page);
    const scan = await new AxeBuilder({ page }).analyze();
    const serious = scan.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`)).toEqual([]);

    // A chart is a stop in the tab order, and the arrow keys walk its points
    // with the same readout the pointer gets.
    const hero = page.locator('[data-stress-case="hero-quarter"] [data-analytics-panel="trend"]');
    const surface = hero.locator("svg.recharts-surface");
    await surface.focus();
    await expect(surface).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const readout = hero.locator(".recharts-tooltip-wrapper");
    await expect(readout).toBeVisible();
    await expect(readout).toContainText("€");
    const first = await readout.textContent();
    await page.keyboard.press("ArrowRight");
    await expect(readout).not.toHaveText(first!);

    // And every number is in the table twin, for a reader with no screen.
    const table = hero.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(93);
  });

  test("with reduced motion asked for, nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(STRESS);
    const hero = page.locator('[data-stress-case="hero-quarter"] [data-analytics-panel="trend"]');
    // No entrance to wait for: the line and the settled figure are there at once.
    await expect(hero.locator(".recharts-area-curve")).toBeVisible({ timeout: 60_000 });
    const figure = hero.locator('[data-analytics-metric="sales.revenue"]');
    // The count-up's visible copy sits just before its screen-reader one.
    const spoken = figure.locator(".sr-only").first();
    const settled = await spoken.textContent();
    await expect(spoken.locator("xpath=preceding-sibling::span[1]")).toHaveText(settled!);

    await hero.scrollIntoViewIfNeeded();
    const at = (await hero.boundingBox())!;
    await page.mouse.move(at.x + at.width * 0.5 - 10, at.y + at.height * 0.6);
    await page.mouse.move(at.x + at.width * 0.5, at.y + at.height * 0.6);
    const readout = hero.locator(".recharts-tooltip-wrapper");
    await expect(readout).toBeVisible();
    const motion = await readout.evaluate((wrapper) => ({
      entrance: getComputedStyle(wrapper.firstElementChild!).animationName,
      glide: getComputedStyle(wrapper).transitionDuration,
    }));
    expect(motion).toEqual({ entrance: "none", glide: "0s" });
  });
});
