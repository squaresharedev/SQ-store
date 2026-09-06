import { expect, test } from "@playwright/test";

/**
 * THE GEOMETRY OF FRAME MODE, measured in a real layout engine.
 *
 * Everything about cropping a tile's photo is arithmetic over boxes, and the
 * two boxes involved are NOT the same one: the tile, and the shorter frame
 * inside it that the picture actually fills once a `bar` title has taken its
 * row. Confusing the two is invisible in a unit test (jsdom reports every box
 * as 0x0) and invisible in the designer's own specs (their fixture photo never
 * loads, so there is no intrinsic size to scale). It shows up only here.
 *
 * The dev harness is the subject rather than the designer because it needs no
 * auth, no storefront and no R2: it renders the SAME Grid + BlockTile pair,
 * with an inline photo whose 2:1 proportions disagree with the tile's on both
 * axes — which is the only shape in which a wrong frame is visible at all.
 */

const HARNESS = "/dev/grid-playground";

/** The tile's photo, its frame, and where the dimmed copy of the rest of the
 *  picture has been drawn — everything the register depends on, read in one
 *  hop so nothing can shift between measurements. */
async function geometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const face = [
      ...document.querySelectorAll<HTMLImageElement>("li[data-grid-cell] img"),
    ].find((img) => !img.closest('[data-testid="tile-image-ghost"]'));
    if (!face) return null;
    const tile = face.closest<HTMLElement>("[data-block-tile]")!;
    const frame = face.closest<HTMLElement>("[data-image-frame]") ?? tile;
    const ghost = document.querySelector<HTMLImageElement>(
      '[data-testid="tile-image-ghost"] img',
    );
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      natural: { w: face.naturalWidth, h: face.naturalHeight },
      objectPosition: face.style.objectPosition,
      transform: face.style.transform,
      tile: box(tile),
      frame: box(frame),
      ghost: ghost ? box(ghost) : null,
    };
  });
}

/**
 * Where the dimmed copy MUST be: the whole picture at the exact scale and
 * offset the frame is cropping it to.
 *
 * Derived here from the frame's own box rather than copied from the component,
 * so the test would still fail if both were changed to the same wrong thing.
 */
function expectedGhost(g: NonNullable<Awaited<ReturnType<typeof geometry>>>) {
  const cover = Math.max(g.frame.w / g.natural.w, g.frame.h / g.natural.h);
  const zoom = Number.parseFloat(
    (g.transform.match(/scale\(([\d.]+)\)/) ?? ["", "1"])[1],
  );
  const [px, py] = (g.objectPosition || "50% 50%")
    .split(" ")
    .map((part) => Number.parseFloat(part) / 100);
  const w = g.natural.w * cover * zoom;
  const h = g.natural.h * cover * zoom;
  return {
    x: g.frame.x + px * (g.frame.w - w),
    y: g.frame.y + py * (g.frame.h - h),
    w,
    h,
  };
}

function expectAligned(
  actual: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
) {
  // A pixel of slack: the browser rounds a painted box, and the point of the
  // assertion is that the two are the same picture, not the same float.
  expect(actual.w).toBeCloseTo(expected.w, 0);
  expect(actual.h).toBeCloseTo(expected.h, 0);
  expect(actual.x).toBeCloseTo(expected.x, 0);
  expect(actual.y).toBeCloseTo(expected.y, 0);
}

test.describe("frame mode geometry", () => {
  test("selecting a product leaves its photo exactly where it was", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    const tile = page
      .locator("li[data-grid-cell]")
      .filter({ has: page.locator("img") })
      .first();
    await expect(tile).toBeVisible();

    const before = (await geometry(page))!;
    const box = (await tile.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35);

    // Selection draws chrome ON the tile — the page node among it. Chrome that
    // is not taken out of the flow leaves an inline box behind, and the face
    // after it slides down and out of the bottom of the tile.
    await expect(page.locator("[data-page-node]")).toBeVisible();
    const after = (await geometry(page))!;
    expect(after.frame).toEqual(before.frame);
    // And the frame is still inside the tile it belongs to.
    expect(after.frame.y + after.frame.h).toBeLessThanOrEqual(
      after.tile.y + after.tile.h + 1,
    );
  });

  test("the dimmed picture lines up with the frame, not with the tile", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    const tile = page
      .locator("li[data-grid-cell]")
      .filter({ has: page.locator("img") })
      .first();
    await tile.dblclick();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();

    const framed = (await geometry(page))!;
    // The fixture is deliberately shaped so that measuring the TILE instead of
    // the frame is a visible error rather than a rounding one.
    expect(framed.frame.h).toBeLessThan(framed.tile.h - 8);
    expect(framed.ghost).not.toBeNull();
    expectAligned(framed.ghost!, expectedGhost(framed));
  });

  test("it stays in register through a zoom and a pan", async ({ page }) => {
    await page.goto(HARNESS);
    const tile = page
      .locator("li[data-grid-cell]")
      .filter({ has: page.locator("img") })
      .first();
    await tile.dblclick();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();

    for (let i = 0; i < 5; i += 1) await page.keyboard.press("+");
    await expect
      .poll(async () => (await geometry(page))!.transform)
      .not.toBe("");
    const zoomed = (await geometry(page))!;
    expectAligned(zoomed.ghost!, expectedGhost(zoomed));

    const box = (await tile.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await geometry(page))!.objectPosition)
      .not.toBe("50% 50%");

    const panned = (await geometry(page))!;
    expectAligned(panned.ghost!, expectedGhost(panned));
    // The pan tracked the pointer: 40px of travel against the FRAME's own
    // overhang. Measuring the taller tile made every drag overshoot.
    const cover = Math.max(
      panned.frame.w / panned.natural.w,
      panned.frame.h / panned.natural.h,
    );
    const zoom = 1.4;
    const travel =
      Math.max(0, panned.natural.w * cover - panned.frame.w) * zoom +
      panned.frame.w * (zoom - 1);
    const moved = panned.ghost!.x - zoomed.ghost!.x;
    // Within half a percent of the picture, which is the resolution a whole
    // number of percent can express.
    expect(Math.abs(moved - 40)).toBeLessThan(travel / 100 / 2 + 1);
  });
});
