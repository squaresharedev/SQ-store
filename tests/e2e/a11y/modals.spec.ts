import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Axe over EVERY dialog, through the dev gallery (/dev/modals), which opens
 * each one from a fixture: no sign-in, no seeded data, and no hunting for the
 * state that normally leads to a dialog. The main a11y spec scans a handful of
 * dialogs in passing; this is the sweep. Serious and critical violations fail.
 *
 * Reduced motion, so a mark that draws itself in or a step that fades is
 * scanned settled: axe measures whatever is on screen at that instant, and a
 * dialog caught mid-fade reports contrast failures it never has.
 */
test.use({ contextOptions: { reducedMotion: "reduce" } });

/** What a specimen draws: a dialog over the page, or a page card in a frame. */
const TARGET = '[role="dialog"], [data-specimen-page]';

test("every dialog in the gallery passes axe", async ({ page }) => {
  // One page load per specimen on a dev server that compiles on demand.
  test.setTimeout(480_000);

  await page.goto("/dev/modals");
  await page.waitForLoadState("networkidle").catch(() => {});
  const ids = await page
    .locator("[data-specimen]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-specimen") ?? ""));
  expect(ids.length).toBeGreaterThan(20);

  const failures: string[] = [];
  for (const id of ids) {
    await page.goto(`/dev/modals?open=${id}`);
    const target = page.locator(TARGET).first();
    await expect(target, `${id} opens`).toBeVisible({ timeout: 30_000 });
    // Whatever still moves under reduced motion, give it a moment to land.
    await target.evaluate(async (el) => {
      const settled = Promise.all(
        el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
      );
      await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 1_500))]);
    });

    const results = await new AxeBuilder({ page }).include(TARGET).exclude("nextjs-portal").analyze();
    for (const violation of results.violations) {
      if (violation.impact !== "serious" && violation.impact !== "critical") continue;
      const where = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ");
      failures.push(`${id}: ${violation.id} (${violation.impact}): ${violation.help} -> ${where}`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
