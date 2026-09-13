import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  canvasStill,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * THE CANVAS MOVES UNDER THE HAND IT IS HELD WITH.
 *
 * With the pointer over the workspace, a laptop trackpad drives it the way
 * every design tool does: two fingers pinching zoom about the cursor, two
 * fingers sliding pan. On a phone two fingers on the board pinch AND pan at
 * once, wherever they land (a tile, an empty cell, the margin).
 *
 * Everything is driven through the DevTools protocol rather than synthesised
 * DOM events wherever Chromium allows it, so the browser does its own hit
 * testing and its own event conversion: a trackpad pinch really does reach the
 * page as a ctrl+wheel with fractional deltas, and a touch really does land on
 * whatever tile is under it. Safari's GestureEvent is the one exception, since
 * Chromium never raises it.
 */

type Box = { x: number; y: number; width: number; height: number };

/** Current canvas scale, read off the stage's transform. */
async function canvasZoom(page: Page): Promise<number> {
  const zoom = await page.evaluate(() => {
    const stage = document.querySelector("[data-canvas-stage]") as HTMLElement | null;
    const match = stage?.style.transform.match(/scale\(([\d.e-]+)\)/);
    return match ? Number(match[1]) : null;
  });
  if (zoom === null) throw new Error("no canvas stage transform");
  return zoom;
}

async function stageBox(page: Page): Promise<Box> {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const box = await page.locator("[data-canvas-stage]").boundingBox();
  if (!box) throw new Error("no canvas stage");
  return box;
}

async function workspaceBox(page: Page): Promise<Box> {
  const box = await page.locator("main").first().boundingBox();
  if (!box) throw new Error("no workspace");
  return box;
}

/** Let the rAF-batched transform land. */
async function frames(page: Page, count = 3) {
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

async function openDesigner(page: Page) {
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await canvasStill(page);
}

/** One wheel event exactly as the platform would raise it. `ctrl` is how
 *  Chromium (and Firefox) deliver a trackpad pinch. */
async function wheel(
  cdp: CDPSession,
  at: { x: number; y: number },
  delta: { x?: number; y?: number },
  ctrl = false,
) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: at.x,
    y: at.y,
    deltaX: delta.x ?? 0,
    deltaY: delta.y ?? 0,
    modifiers: ctrl ? 2 : 0,
    pointerType: "mouse",
  });
}

test.describe("laptop trackpad", () => {
  let page: Page;
  let cdp: CDPSession;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    await signUp(page, freshUser("trackpad"));
    await page.waitForLoadState("networkidle").catch(() => {});
    await openDesigner(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  /** The middle of the board, where the pinch is centred. */
  async function boardMiddle() {
    const box = await stageBox(page);
    const area = await workspaceBox(page);
    return {
      x: Math.round(Math.max(area.x + 40, Math.min(area.x + area.width - 40, box.x + box.width / 2))),
      y: Math.round(Math.max(area.y + 40, Math.min(area.y + area.height - 40, box.y + box.height / 3))),
    };
  }

  test("a pinch made of the smallest trackpad steps still zooms", async () => {
    const at = await boardMiddle();
    await page.mouse.move(at.x, at.y);
    const start = await canvasZoom(page);
    // A slow pinch on a Mac trackpad reports deltas under 2px per event. Each
    // one on its own is a fraction of a percent, and a zoom that rounds every
    // step back to the nearest 1% swallows every single one of them.
    for (let i = 0; i < 30; i += 1) await wheel(cdp, at, { y: -1 }, true);
    await frames(page);
    expect(await canvasZoom(page)).toBeGreaterThan(start * 1.05);

    for (let i = 0; i < 30; i += 1) await wheel(cdp, at, { y: 1 }, true);
    await frames(page);
    expect(await canvasZoom(page)).toBeCloseTo(start, 2);
  });

  test("a pinch zooms about the cursor, not the corner", async () => {
    const at = await boardMiddle();
    const zoom = await canvasZoom(page);
    const before = await stageBox(page);
    // The board point under the cursor, in unscaled board px.
    const pinned = { x: (at.x - before.x) / zoom, y: (at.y - before.y) / zoom };

    for (let i = 0; i < 12; i += 1) await wheel(cdp, at, { y: -6 }, true);
    await frames(page);

    const after = await stageBox(page);
    const next = await canvasZoom(page);
    expect(next).toBeGreaterThan(zoom);
    expect(Math.abs(after.x + pinned.x * next - at.x)).toBeLessThan(2);
    expect(Math.abs(after.y + pinned.y * next - at.y)).toBeLessThan(2);
  });

  test("Chromium's own trackpad pinch tracks the fingers one to one", async () => {
    const at = await boardMiddle();
    const start = await canvasZoom(page);
    await cdp.send("Input.synthesizePinchGesture", {
      x: at.x,
      y: at.y,
      scaleFactor: 0.6,
      relativeSpeed: 400,
      gestureSourceType: "mouse",
    });
    await frames(page);
    // At a third of the rate (the old /300) this landed near 0.84x.
    const ratio = (await canvasZoom(page)) / start;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.66);
  });

  test("two fingers sliding on the trackpad pan both ways", async () => {
    const at = await boardMiddle();
    const zoom = await canvasZoom(page);
    const before = await stageBox(page);
    for (let i = 0; i < 10; i += 1) await wheel(cdp, at, { x: 6, y: 4 });
    await frames(page);
    const after = await stageBox(page);
    expect(await canvasZoom(page)).toBe(zoom);
    expect(after.x - before.x).toBeCloseTo(-60, 0);
    expect(after.y - before.y).toBeCloseTo(-40, 0);
  });

  test("Safari's gesture events zoom the canvas and are kept from the page", async () => {
    const at = await boardMiddle();
    const start = await canvasZoom(page);
    const prevented = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      if (!target) throw new Error("nothing under the pointer");
      // Chromium has no GestureEvent constructor; Safari's carries scale and
      // the pointer position on a plain UIEvent, which is all a handler reads.
      const fire = (type: string, scale: number) => {
        const event = new UIEvent(type, { bubbles: true, cancelable: true });
        Object.assign(event, { scale, rotation: 0, clientX: x, clientY: y });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const results = [fire("gesturestart", 1)];
      for (let i = 1; i <= 5; i += 1) results.push(fire("gesturechange", 1 + i * 0.1));
      fire("gestureend", 1.5);
      return results.every(Boolean);
    }, at);
    await frames(page);
    expect(prevented).toBe(true);
    expect(await canvasZoom(page)).toBeCloseTo(Math.min(2, start * 1.5), 1);
  });

  test("the mobile preview column still scrolls under the wheel", async () => {
    // The preview has no stage to pan, and the canvas wheel handler used to
    // swallow its wheel anyway. Short enough that the column overflows.
    await page.setViewportSize({ width: 1440, height: 480 });
    await page.getByRole("button", { name: "Mobile preview" }).first().click();
    const column = page.locator("main").first();
    await expect(column.locator("[data-canvas-stage]")).toHaveCount(0);
    const overflow = await column.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(100);

    const box = await workspaceBox(page);
    const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    for (let i = 0; i < 5; i += 1) await wheel(cdp, at, { y: 40 });
    await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  });
});

test.describe("phone touch", () => {
  let page: Page;
  let cdp: CDPSession;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 664 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    await signUp(page, freshUser("touchzoom"));
    await page.waitForLoadState("networkidle").catch(() => {});
    await openDesigner(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  type Finger = { x: number; y: number };

  /** Put two real fingers down, move them from `from` to `to`, lift them. */
  async function twoFingers(from: [Finger, Finger], to: [Finger, Finger], steps = 12) {
    const points = (pair: [Finger, Finger]) =>
      pair.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
    // Both fingers down, one after the other, as a hand really does it.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points([from[0], from[0]]).slice(0, 1),
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const at = from.map((p, n) => ({
        x: p.x + (to[n].x - p.x) * t,
        y: p.y + (to[n].y - p.y) * t,
      })) as [Finger, Finger];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(at) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await frames(page);
  }

  async function boardMiddle() {
    const box = await stageBox(page);
    const area = await workspaceBox(page);
    return {
      x: Math.round(area.x + area.width / 2),
      y: Math.round(Math.max(area.y + 120, Math.min(area.y + area.height - 160, box.y + 200))),
    };
  }

  test("two fingers on the board pinch it, whatever they land on", async () => {
    const mid = await boardMiddle();
    const landed = await page.evaluate(({ x, y }) => {
      const at = (px: number) =>
        document.elementFromPoint(px, y)?.closest("[data-grid-key], button, [data-canvas-stage], main")
          ?.tagName ?? "none";
      return [at(x - 40), at(x + 40)];
    }, mid);
    // The fingers land on the board's own content, never the workspace
    // element itself, which is where an event-on-<main> spec would cheat.
    expect(landed).not.toContain("MAIN");

    const start = await canvasZoom(page);
    const tiles = await page.locator("[data-grid-key]").count();
    await twoFingers(
      [{ x: mid.x - 40, y: mid.y }, { x: mid.x + 40, y: mid.y }],
      [{ x: mid.x - 110, y: mid.y }, { x: mid.x + 110, y: mid.y }],
    );
    await page.waitForTimeout(300);
    expect(await canvasZoom(page)).toBeGreaterThan(start * 1.5);
    // A pinch is not a tap: nothing inserted, and the page itself unzoomed.
    expect(await page.locator("[data-grid-key]").count()).toBe(tiles);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });

  test("two fingers sliding together pan the board without zooming", async () => {
    const mid = await boardMiddle();
    const zoom = await canvasZoom(page);
    const before = await stageBox(page);
    await twoFingers(
      [{ x: mid.x - 50, y: mid.y }, { x: mid.x + 50, y: mid.y }],
      [{ x: mid.x - 50, y: mid.y + 70 }, { x: mid.x + 50, y: mid.y + 70 }],
    );
    await page.waitForTimeout(300);
    const after = await stageBox(page);
    expect(await canvasZoom(page)).toBeCloseTo(zoom, 2);
    expect(after.y - before.y).toBeGreaterThan(55);
  });

  test("Chromium's own touch pinch synthesis squeezes the board back down", async () => {
    // Centred on the WORKSPACE: a synthesized pinch-in starts its fingers
    // ~140px either side, and centred any higher the top one comes down on the
    // page header, where a pinch is not the canvas's to take.
    const area = await workspaceBox(page);
    const start = await canvasZoom(page);
    await cdp.send("Input.synthesizePinchGesture", {
      x: Math.round(area.x + area.width / 2),
      y: Math.round(area.y + area.height / 2),
      scaleFactor: 0.5,
      relativeSpeed: 600,
      gestureSourceType: "touch",
    });
    await page.waitForTimeout(300);
    expect(await canvasZoom(page)).toBeLessThan(start * 0.8);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });
});
