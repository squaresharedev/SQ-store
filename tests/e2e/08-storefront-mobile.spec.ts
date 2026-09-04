import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import {
  createProductViaUI,
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

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
  await createStorefrontViaUI(page);
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

/** Drag one grid cell onto another with a plain pointer drag. The move
 *  gesture itself is not pointerType-gated (only marquee and edge-resize
 *  are), so a mouse-style drag reliably produces overlap regardless of the
 *  touch behaviour under test. */
async function dragOnto(page: Page, from: Locator, to: Locator) {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error("block has no box");
  const start = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  const end = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** A single touch tap at a fixed page point, dispatched straight at whatever
 *  is physically there — the same real hit-testing a finger gets, which is
 *  what makes repeated taps at one point a meaningful stack-cycle test. */
async function touchTap(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) throw new Error(`nothing at ${x},${y}`);
      const opts = {
        pointerId: 77,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
      };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    { x, y },
  );
  await page.waitForTimeout(150);
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
    // Tapping the canvas dismisses it. A `fixed inset-0` backdrop cannot do
    // this from inside the translated toolbar, so this guards the real fix.
    await page.mouse.click(195, 220);
    await expect(menu).toBeHidden();

    // --- the desktop/mobile switch is reachable without opening any menu at
    //     all, on its own now — it is the ONLY route to preview mode on a
    //     phone. It rides whatever it controls rather than floating fixed
    //     over the editor: above the board in design view, above the fluid
    //     column in mobile preview — same chrome as the product page
    //     artboard's own buttons in both cases, not held to a touch minimum
    //     any more than those are. ---
    const desktopPreview = page.getByRole("button", { name: "Desktop preview" });
    const mobilePreview = page.getByRole("button", { name: "Mobile preview" });
    await expect(desktopPreview).toBeVisible();
    await expect(mobilePreview).toBeVisible();
    await expect(desktopPreview).toHaveAttribute("aria-pressed", "true");

    await mobilePreview.click();
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("main")?.className.includes("overflow-auto") ?? false),
      )
      .toBe(true);

    const desktopPreview2 = page.getByRole("button", { name: "Desktop preview" });
    const mobilePreview2 = page.getByRole("button", { name: "Mobile preview" });
    await expect(mobilePreview2).toBeVisible();
    await expect(mobilePreview2).toHaveAttribute("aria-pressed", "true");
    // Chrome ON the mobile-width column, not fixed near the settings panel:
    // its right edge lines up with the column's, not the viewport's.
    const columnBox = await page.locator("main > div.mx-auto").boundingBox();
    const switchBox = await mobilePreview2.boundingBox();
    expect(columnBox).not.toBeNull();
    expect(switchBox).not.toBeNull();
    expect(
      Math.abs(switchBox!.x + switchBox!.width - (columnBox!.x + columnBox!.width)),
    ).toBeLessThan(5);

    // --- and back to design view, where the board (and the switch riding
    //     it) return ---
    await desktopPreview2.click();
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("main")?.className.includes("touch-none") ?? false),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "Desktop preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    // Must be a VISIBLE confirmation, not merely a present one: the old header
    // status was `hidden sm:inline`, so a phone got no feedback that the save
    // landed at all. The toast renders at every width, and asserting on its
    // visibility is what keeps that true.
    await expectToast(page, /storefront saved/i);
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

  test("the library sheet survives inserting a shape from it", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-libsheet"));
    await settle(page);
    await openDesigner(page);

    // On lg+ the library is a column and the inspector is a separate one, so
    // they never fight for space. On a phone both are `fixed inset-x-0
    // bottom-0` bottom sheets, and inserting a shape auto-selects it — which
    // used to pop the inspector sheet up over the library that was still
    // open, hiding the very shapes the seller was choosing from.
    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page.getByRole("menu", { name: "Elements" }).getByRole("menuitem", { name: "All shapes" }).click();
    await expect(page.getByRole("button", { name: "Add square" })).toBeVisible();

    await page.getByRole("button", { name: "Add square" }).click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);

    // The library must still be the thing on screen, reachable for a second
    // insert, not covered by the newly selected block's inspector sheet.
    await expect(page.getByRole("button", { name: "Add circle" })).toBeVisible();
    await page.getByRole("button", { name: "Add circle" }).click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
  });

  test("re-tapping a selected block reaches the one stacked underneath it", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-stack"));
    await settle(page);
    await openDesigner(page);

    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page.getByRole("menu", { name: "Elements" }).getByRole("menuitem", { name: "All shapes" }).click();
    await page.getByRole("button", { name: "Add square" }).click();
    await page.getByRole("button", { name: "Add circle" }).click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
    const closeLib = page.getByRole("button", { name: "Close library panel" });
    if (await closeLib.count()) await closeLib.click();

    // Full overlap: touch has no Alt key, so Alt+click's stack walk (covered
    // by 24-layering.spec.ts) is unreachable on a phone. Repeatedly tapping
    // the block already on top is the only gesture free for it.
    const cells = page.locator("li[data-grid-cell]");
    const topBox = await cells.nth(0).boundingBox();
    await dragOnto(page, cells.nth(1), cells.nth(0));
    if (!topBox) throw new Error("no box for the first cell");
    const point = { x: topBox.x + topBox.width / 2, y: topBox.y + topBox.height / 2 };
    const selected = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[data-block-tile]")]
          .find((el) => el.getAttribute("aria-pressed") === "true")
          ?.closest("[data-grid-key]")
          ?.getAttribute("data-grid-key"),
      );

    await touchTap(page, point.x, point.y);
    const first = await selected();
    expect(first).not.toBeUndefined();

    // A second tap at the exact same point must reach the OTHER block, not
    // toggle the same one off (the pre-existing single-block behaviour) and
    // not re-select the one on top (a plain, un-cycled tap).
    await touchTap(page, point.x, point.y);
    const second = await selected();
    expect(second).not.toBe(first);
    expect(second).not.toBeUndefined();

    // A third tap wraps back to the first block, proving this is a full walk
    // through the stack and not a one-shot swap.
    await touchTap(page, point.x, point.y);
    expect(await selected()).toBe(first);
  });
});
