import {
  devices,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  canvasStill,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * MULTI-SELECT ON A PHONE.
 *
 * Its own file because `test.use` with a device forces a worker of its own.
 *
 * A touchscreen had no way to select two things at all. Shift-click is the
 * desktop gesture and a phone has no Shift; the marquee is mouse and pen only
 * (a touch drag on the board is a pan); the layers list wants a modifier too.
 * So every group tool — the shared colour, stroke, corners and opacity, and
 * moving a selection as one object — worked perfectly with a mouse and was
 * unreachable with a finger.
 *
 * Press and hold is the answer, and it is the idiom every phone already uses
 * for "and this one too". What has to hold true:
 *
 *   - a HOLD adds a tile to the selection; a TAP still just selects one, and a
 *     DRAG still just moves (the gesture must not have eaten either);
 *   - the group's tools arrive on the bar, at a size a finger can hit;
 *   - and the whole selection moves together under one finger.
 */

/**
 * The phone, WITHOUT the browser the preset comes with.
 *
 * `devices["iPhone 13"]` carries a `defaultBrowserType` of "webkit", and
 * spreading it whole moves this file off the suite's only project — onto a
 * browser whose binary the stack does not install, and whose contexts have no
 * CDP, which is the one way Playwright can dispatch a real touch hold (its
 * `touchscreen` API taps and nothing else). What this file actually needs from
 * the preset is the phone: a 390px viewport, touch input, and a mobile user
 * agent. Chromium reproduces all three.
 */
const { defaultBrowserType: _presetBrowser, ...iPhone13 } = devices["iPhone 13"];
test.use(iPhone13);

/** `createStorefrontViaUI`, but able to survive a phone: on a 390px screen the
 *  wizard's bottom bar is shared with Next's own dev-tools badge, which wins
 *  the click. The badge is dev chrome no seller ever sees. */
async function createStorefrontOnAPhone(page: Page) {
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await page.getByRole("button", { name: /skip setup/i }).click({ force: true });
  await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

async function addSquare(page: Page) {
  await page.getByRole("button", { name: "Add element" }).tap();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: /^Add square$/ })
    .tap();
  // Inserting a block selects it, and on a phone the inspector is a sheet
  // across the bottom of the screen — over the very toolbar the next block is
  // added from. Put it away, the way a seller would.
  await page
    .getByRole("button", { name: /^close .* panel$/i })
    .first()
    .tap();
  await canvasStill(page);
}

const tiles = (page: Page) =>
  page.locator('li[data-grid-cell] [data-block-tile][aria-label*="square shape"]');

/** A finger resting on a tile: down, wait past the hold window, up.
 *  `touchscreen.tap()` is press and release in one, so the two halves have to
 *  be dispatched separately. */
async function hold(page: Page, target: Locator, ms = 700) {
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await page.waitForTimeout(ms);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

async function board(page: Page) {
  const user = freshUser("multiphone");
  await signUp(page, user);
  await gotoApp(page, "/storefront");
  await createStorefrontOnAPhone(page);
  await addSquare(page);
  await addSquare(page);
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
}

test("press and hold builds a selection a finger can then use", async ({
  page,
}) => {
  await board(page);

  // A TAP still selects one. The hold must not have taken the ordinary
  // gesture over.
  await tiles(page).first().tap();
  await expect(page.locator("[data-block-selected]")).toHaveCount(1);

  // The size of a control this bar ALREADY had on a phone, measured before the
  // group exists. The bar scales with the board's zoom on purpose — it grows
  // and shrinks in lockstep with the grid's own resize and rotate handles (see
  // useAnchorToSelection) — so there is no absolute number to assert here that
  // would not be asserting a different design. What must hold is that the
  // group's tools are no harder to hit than the single block's already are.
  const bar = page.locator("[data-selection-toolbar]");
  const single = (await bar
    .getByRole("button", { name: /remove/i })
    .boundingBox())!;
  expect(single.height).toBeGreaterThan(0);

  // A HOLD on the other adds it, rather than replacing the selection.
  await hold(page, tiles(page).nth(1));
  await expect(page.locator("[data-block-selected]")).toHaveCount(2);

  // ...and the group's own tools are on the bar, each the size of the controls
  // the seller was already hitting on it.
  await expect(bar).toBeVisible();
  for (const name of [
    /change the colour of 2 elements/i,
    /edit the stroke of 2 elements/i,
    /edit the corner roundness of 2 elements/i,
    /edit the opacity of 2 elements/i,
  ]) {
    const button = bar.getByRole("button", { name });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height, `${name} is smaller than the bar's own controls`)
      .toBeCloseTo(single.height, 1);
  }


  // The bar still fits the phone with four more controls on it.
  const viewport = page.viewportSize()!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.x).toBeGreaterThanOrEqual(0);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(viewport.width + 1);

  // A hold on a tile that is ALREADY in the selection takes it back out, the
  // way shift-click does — the gesture is a toggle, not an "add" that can only
  // grow.
  await hold(page, tiles(page).nth(1));
  await expect(page.locator("[data-block-selected]")).toHaveCount(1);

  // AND A FINGER REALLY REACHES THEM. Drawn at the right size is not the same
  // as pressable: the bar rides over the board, and a group tool a tap fell
  // through would be worse than one that was never drawn. Last, because the
  // colour panel is a sheet across the bottom of a phone and it covers the
  // board it opens over.
  await hold(page, tiles(page).nth(1));
  await expect(page.locator("[data-block-selected]")).toHaveCount(2);
  await bar.getByRole("button", { name: /change the colour of 2 elements/i }).tap();
  await expect(
    page.getByRole("group", { name: /standard colors/i }),
  ).toBeVisible();
});

test("one finger moves the whole selection", async ({ page }) => {
  await board(page);
  await tiles(page).first().tap();
  await hold(page, tiles(page).nth(1));
  await expect(page.locator("[data-block-selected]")).toHaveCount(2);

  const before = await placements(page);

  // Drag the first tile one whole cell down. Touch drags are the only way to
  // move a tile on a phone, and they now carry the group.
  const box = (await tiles(page).first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pitch = await strideY(page);
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  // Past the drag threshold, then the real distance, so the press becomes a
  // drag before it is asked to land anywhere.
  for (const step of [8, pitch / 2, pitch]) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + step }],
    });
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();

  const after = await placements(page);
  const keys = Object.keys(before);
  expect(keys).toHaveLength(2);
  for (const key of keys) {
    expect(after[key].y - before[key].y, "a selected block stayed behind").toBe(1);
  }
});

/** Every cell's grid coordinates, by key. */
async function placements(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const cell of document.querySelectorAll<HTMLElement>(
      "li[data-grid-cell][data-grid-key]",
    )) {
      const style = getComputedStyle(cell);
      out[cell.dataset.gridKey!] = {
        x: Number.parseInt(style.gridColumnStart, 10) - 1,
        y: Number.parseInt(style.gridRowStart, 10) - 1,
      };
    }
    return out;
  });
}

/** The board's row pitch on screen — cell plus gap, post-zoom, which is the
 *  space the finger actually travels through. */
async function strideY(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(
      'ul[aria-label="Storefront canvas"]',
    )!;
    const rect = grid.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
    const rows = Number.parseInt(
      getComputedStyle(grid).getPropertyValue("--ss-rows"),
      10,
    );
    return (rect.height - (rows - 1) * gap) / rows + gap;
  });
}
