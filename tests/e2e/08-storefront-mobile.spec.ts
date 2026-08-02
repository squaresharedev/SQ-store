import { devices, expect, test, type Page } from "@playwright/test";
import { createProductViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * The storefront designer ON A PHONE.
 *
 * The desktop toolbar is ~570px of controls. At 390px it used to overflow with
 * no scroll affordance, stranding everything past the zoom readout — including
 * the Design button, which is the ONLY route to global settings on mobile. That
 * made theme, background and header unreachable on a phone, so these assertions
 * are about reachability first and niceties second.
 */

test.use({ ...devices["iPhone 13"] });

/**
 * `signUp` resolves the moment the URL becomes /dashboard, while that
 * navigation is still in flight — starting the next goto immediately makes
 * Playwright abort it as "interrupted by another navigation".
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Open a fresh storefront designer and wait for the board to settle. */
async function openDesigner(page: Page) {
  await gotoApp(page, "/storefront");
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  // The board places itself on the first frames after layout.
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await page.waitForTimeout(1_000);
}

/** Current canvas scale, read off the stage's transform. */
async function canvasZoom(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const stage = document
      .querySelector("main")
      ?.querySelector("[style*='scale']");
    const match = stage?.getAttribute("style")?.match(/scale\(([\d.]+)\)/);
    return match ? Number(match[1]) : null;
  });
}

/**
 * Drive a two-finger pinch with raw pointer events. Playwright has no pinch
 * gesture, and the workspace sets `touch-action: none` and listens to pointer
 * events directly, so synthesising them is exactly what the browser would do.
 */
async function pinch(page: Page, fromHalfSpan: number, toHalfSpan: number) {
  await page.evaluate(
    async ({ from, to }) => {
      const main = document.querySelector("main");
      if (!main) throw new Error("no workspace");
      const cx = 195;
      const cy = 330;
      const send = (type: string, points: { id: number; x: number }[]) => {
        for (const p of points) {
          main.dispatchEvent(
            new PointerEvent(type, {
              pointerId: p.id,
              pointerType: "touch",
              isPrimary: p.id === 1,
              clientX: p.x,
              clientY: cy,
              bubbles: true,
              cancelable: true,
              buttons: 1,
            }),
          );
        }
      };
      send("pointerdown", [
        { id: 1, x: cx - from },
        { id: 2, x: cx + from },
      ]);
      for (let i = 1; i <= 10; i++) {
        const d = from + ((to - from) * i) / 10;
        send("pointermove", [
          { id: 1, x: cx - d },
          { id: 2, x: cx + d },
        ]);
        await new Promise((r) => setTimeout(r, 16));
      }
      send("pointerup", [
        { id: 1, x: cx - to },
        { id: 2, x: cx + to },
      ]);
    },
    { from: fromHalfSpan, to: toHalfSpan },
  );
  await page.waitForTimeout(300);
}

test.describe("storefront designer on a phone", () => {
  test("every control is reachable, and the phone-only affordances work", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-designer"));
    await settle(page);
    await createProductViaUI(page, { title: "Blue Mug", price: "24.00" });
    await openDesigner(page);

    // --- the toolbar fits, and nothing is stranded past the screen edge ---
    const bar = await page.evaluate(() => {
      const toolbar = document.querySelector('[role="toolbar"]');
      if (!toolbar) return null;
      const buttons = [...toolbar.children].flatMap((group) =>
        group.matches("button")
          ? [group as HTMLElement]
          : [...group.querySelectorAll<HTMLElement>(":scope > button")],
      );
      return {
        overflows: toolbar.scrollWidth > toolbar.clientWidth,
        controls: buttons
          .map((b) => {
            const r = b.getBoundingClientRect();
            return {
              label: b.getAttribute("aria-label"),
              height: Math.round(r.height),
              offscreen: r.right > window.innerWidth || r.left < 0,
            };
          })
          // Zero-size entries are the `sm:`-only groups, correctly hidden here.
          .filter((c) => c.height > 0),
      };
    });
    expect(bar).not.toBeNull();
    expect(bar!.overflows).toBe(false);
    expect(bar!.controls.filter((c) => c.offscreen)).toEqual([]);
    // Apple's 44px minimum: the bar is the primary touch surface.
    expect(bar!.controls.filter((c) => c.height < 44)).toEqual([]);

    // --- the board starts near the top rather than floating mid-screen ---
    const gapAbove = await page.evaluate(() => {
      const main = document.querySelector("main");
      const stage = main?.querySelector("[style*='translate']");
      if (!main || !stage) return null;
      return Math.round(
        stage.getBoundingClientRect().top - main.getBoundingClientRect().top,
      );
    });
    expect(gapAbove).not.toBeNull();
    expect(gapAbove!).toBeLessThanOrEqual(40);

    // --- Design settings: the regression that made this file exist ---
    const design = page.getByRole("button", { name: "Design settings" });
    await expect(design).toBeVisible();
    await design.click();
    await expect(page.getByRole("button", { name: /close design settings/i })).toBeVisible();
    await page.getByRole("button", { name: /close design settings/i }).click();

    // --- the phone-only overflow menu holds what the bar gave up ---
    await page.getByRole("button", { name: "More tools" }).click();
    const menu = page.getByRole("menu", { name: "More tools" });
    await expect(menu).toBeVisible();
    for (const name of ["Redo", "Tidy up", "Reset zoom"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
    for (const name of ["Desktop preview", "Mobile preview"]) {
      await expect(menu.getByRole("menuitemradio", { name })).toBeVisible();
    }
    // Tapping the canvas dismisses it. A `fixed inset-0` backdrop cannot do
    // this from inside the translated toolbar, so this guards the real fix.
    await page.mouse.click(195, 220);
    await expect(menu).toBeHidden();
  });

  test("blocks can be inserted and the design saved from a phone", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-insert"));
    await settle(page);
    await createProductViaUI(page, { title: "Blue Mug", price: "24.00" });
    await openDesigner(page);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    await page.getByRole("button", { name: "Add product", exact: true }).click();
    await page.getByRole("button", { name: /blue mug/i }).first().click();

    await page.getByRole("button", { name: /^save$/i }).click();
    // Must be a VISIBLE confirmation, not merely a present one: the status
    // used to be `hidden sm:inline`, so a phone got no feedback that the save
    // landed. Matching `:visible` is what makes this a regression guard —
    // `.first()` would happily resolve to the desktop-only span.
    await expect(
      page.locator('[role="status"] span:visible').filter({ hasText: /^Saved/ }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("pinch zooms the canvas — the only zoom control on touch", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-pinch"));
    await settle(page);
    await openDesigner(page);

    // The zoom buttons are deliberately desktop-only.
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeHidden();

    const start = await canvasZoom(page);
    expect(start).not.toBeNull();

    await pinch(page, 50, 135);
    const spread = await canvasZoom(page);
    expect(spread!).toBeGreaterThan(start!);

    await pinch(page, 135, 45);
    const squeezed = await canvasZoom(page);
    expect(squeezed!).toBeLessThan(spread!);

    // A lone finger after a pinch must pan, never resume a phantom pinch —
    // it would if a lifted pointer id were left behind in the tracking map.
    await pinch(page, 60, 60);
    expect(await canvasZoom(page)).toBe(squeezed);
  });
});
