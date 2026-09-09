import { devices, expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A TILE'S CONTROLS ON A PHONE: all of them, or none of them.
 *
 * Every control a block still has on the board hangs OUTSIDE its cell: the
 * resize and rotate handles, under its bottom edge (see HANDLE_CLASS). The
 * buttons that used to sit in a chip above the top edge have moved off the
 * board entirely, into the selection island over the canvas. Each cell is its
 * own stacking
 * context, so reaching any of them takes a deliberate lift of the whole cell,
 * and the three states that buy that lift are hover, focus and selection. A
 * finger does none of the first two.
 *
 * That left two ways to draw a control nobody could press, and a phone hit
 * both at once:
 *
 *   - CHROME ON EVERY TILE. The handles were drawn
 *     unconditionally for coarse pointers, on the grounds that touch has no
 *     hover to reveal them with. But unlifted chrome is painted into the
 *     neighbouring cell's face, so on any board with a block under another one
 *     the upper tile showed a resize and a rotate handle that were visible and
 *     permanently dead. They follow SELECTION now, on every pointer type,
 *     which is exactly the state that lifts the cell.
 *
 *   - THE SHEET THAT SELECTING OPENS. Selecting a block opens the inspector,
 *     which on a phone is a bottom sheet over the canvas, and the canvas
 *     anchors the selected tile into whatever strip is left. It anchored on
 *     the CELL, so it revealed the tile flush against the sheet's top edge and
 *     buried the two handles welded under it — the reported bug, and on a
 *     touchscreen those handles are the only route to either gesture. The
 *     anchor measures the chrome now (selectionBoxes in useCanvasAnchor), and
 *     the sheet leaves a strip tall enough to hold it (SHEET_ON_MOBILE_CLASS).
 *
 *   - THE REFLOWED BOARD. A board narrower than its columns needs repacking to
 *     fit, and a repacked board cannot honour stored coordinates AS AN
 *     ABSOLUTE placement, so it used to turn every resize handle off wholesale
 *     — the same flag that gated the rotate handle, gating them both by simply
 *     not rendering either, while the tile's own chip, gated on `editable`,
 *     stayed. The storefront's MOBILE PREVIEW is often reflowed (a 6-column
 *     board at 384px comes back as 4), so on a phone the seller selected a
 *     block and got a chip and no handles at all.
 *
 *     Rotation is an angle, not a coordinate, so it was never affected by any
 *     of this and just needed its own flag. Resize is a DELTA once the corner
 *     handle is being dragged, and a delta survives the column count changing
 *     under it by scaling through reflow's own ratio (see
 *     invertReflowResize) — so it is only genuinely stuck for a tile already
 *     spanning the full width AND the full height of the repacked board; every
 *     other tile keeps a working handle, translated back onto the real
 *     design when it lands.
 *
 * So: nothing selected, no chrome anywhere; one tile selected, every one of
 * its controls both drawn and pressable, with the sheet up; and in mobile
 * preview, a lone tile with room to grow resizes for real (and writes back to
 * the design), while one already filling the repacked board stays inert and
 * says why.
 */

test.use({ ...devices["iPhone 13"] });

const PHOTO = "https://images.e2e.invalid/mobile-chrome.jpg";

/** Every control on every cell: is it drawn, and would a tap reach it? */
async function controls(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("li[data-grid-cell]")).map((cell) => {
      const el = cell as HTMLElement;
      return {
        key: el.dataset.gridKey ?? "",
        selected: !!el.querySelector("[data-block-selected]"),
        controls: Array.from(
          el.querySelectorAll<HTMLElement>("button[aria-label]"),
        ).map((control) => {
          // What decides whether a control is DRAWN is the chrome element
          // around it; a bare handle is its own chrome and comes back as
          // itself.
          const chrome = control.closest<HTMLElement>("[data-tile-chrome]") ?? control;
          const box = control.getBoundingClientRect();
          const under = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return {
            label: control.getAttribute("aria-label") ?? "",
            shown: Number(getComputedStyle(chrome).opacity) > 0.5,
            takesPresses: getComputedStyle(chrome).pointerEvents !== "none",
            // Whatever is under the middle of the control has to BE the
            // control: anything else means a neighbouring cell or a sheet is
            // drawn over it and would take the press instead.
            reachable: !!under && (control.contains(under) || under === control),
            covering:
              under && !(control.contains(under) || under === control)
                ? `${under.tagName}.${(under.className || "").toString().slice(0, 40)}`
                : null,
          };
        }),
      };
    }),
  );
}

test("a phone shows a tile's controls only when it is selected, and then all of them", async ({
  page,
}) => {
  const user = freshUser("mchrome");
  await signUp(page, user);
  await seedProducts(await userIdByEmail(user.email), [
    { title: "Enamel Mug", image_key: PHOTO },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});

  // TWO BLOCKS, ONE DIRECTLY UNDER THE OTHER. The lower one is what used to
  // swallow the upper one's handles, so a board of one tile cannot show the
  // bug at all. Text blocks because they insert in one press, with no picker
  // to walk through.
  //
  // The sheet each insert raises has to be cleared before the next one:
  // inserting selects the new block, which raises its inspector, and the
  // toolbar stands down for as long as any sheet is up (see
  // 47-mobile-editor-usability), so the second Add text is not reachable
  // until the first one is shut.
  await page.getByRole("button", { name: "Add text" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /close text block panel/i }).click();
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
  await page.waitForTimeout(1_000);

  const laidOut = await controls(page);
  // Move the second block under the first from the keyboard: a drag would
  // depend on where the fit-to-box put the board.
  await page.evaluate((key) => {
    document
      .querySelector<HTMLElement>(
        `li[data-grid-cell][data-grid-key="${key}"] [data-block-tile]`,
      )
      ?.focus();
  }, laidOut[1].key);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(600);

  const stacked = await page.evaluate(() =>
    Array.from(document.querySelectorAll("li[data-grid-cell]")).map((cell) => {
      const r = cell.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), bottom: Math.round(r.bottom) };
    }),
  );
  // The board really is stacked: same column, the second starting where the
  // first ends. Without this the rest of the test proves nothing.
  expect(stacked[0].x).toBe(stacked[1].x);
  expect(stacked[1].y).toBeGreaterThanOrEqual(stacked[0].bottom - 2);

  // ── Nothing selected: no chrome anywhere ────────────────────────────────
  // Deselect AND drop the keyboard focus the move above left on the tile:
  // `focus-within` is a reveal in its own right (and rightly so, for a
  // keyboard user), so leaving it behind would test nothing about touch.
  await page.keyboard.press("Escape");
  await page.touchscreen.tap(370, 150);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(1_200);

  for (const cell of await controls(page)) {
    if (cell.selected) continue;
    for (const control of cell.controls) {
      expect(
        control.shown,
        `${control.label} is drawn on an unselected tile`,
      ).toBe(false);
      expect(
        control.takesPresses,
        `${control.label} still hit-tests while invisible`,
      ).toBe(false);
    }
  }

  // ── One tile selected: every control drawn AND pressable ────────────────
  const upper = page.locator("li[data-grid-cell]").first();
  const box = (await upper.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1_500);

  const selected = (await controls(page)).find((cell) => cell.selected);
  expect(selected, "tapping a tile selects it").toBeDefined();

  const labels = selected!.controls.map((control) => control.label);
  // The two that the sheet used to bury. Named rather than merely counted, so
  // a future board that stops drawing them fails here instead of passing
  // vacuously.
  expect(labels.some((label) => /^Resize /.test(label))).toBe(true);
  expect(labels.some((label) => /^Rotate /.test(label))).toBe(true);

  for (const control of selected!.controls) {
    expect(control.shown, `${control.label} is not drawn`).toBe(true);
    expect(control.takesPresses, `${control.label} takes no presses`).toBe(true);
    expect(
      control.reachable,
      `${control.label} is covered by ${control.covering}`,
    ).toBe(true);
  }

  // And the sheet the selection opened really is up — otherwise the hard half
  // of this (chrome and sheet competing for the same strip) went untested.
  const sheet = page.locator("[data-canvas-panel]").filter({ visible: true });
  await expect(sheet.first()).toBeVisible();
});

/** A touch drag from one point to another, fired as raw PointerEvents on
 *  whatever element sits under the start point — the same recipe the
 *  rotation gesture below uses, since these handles are `touch-none` and a
 *  library-level drag helper does not reliably reach them. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.evaluate(
    async ({ from, to }) => {
      const target = document.elementFromPoint(from.x, from.y)!;
      const fire = (type: string, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 9,
            pointerType: "touch",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown", from.x, from.y);
      for (let i = 1; i <= 12; i += 1) {
        fire(
          "pointermove",
          from.x + ((to.x - from.x) * i) / 12,
          from.y + ((to.y - from.y) * i) / 12,
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      fire("pointerup", to.x, to.y);
    },
    { from, to },
  );
}

test("mobile preview: a lone tile resizes for real, and rotation stays live", async ({
  page,
}) => {
  const user = freshUser("mpreview");
  await signUp(page, user);
  await seedProducts(await userIdByEmail(user.email), [
    { title: "Enamel Mug", image_key: PHOTO },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Mobile preview" }).first().click();
  await page.waitForTimeout(1_200);

  // The premise: this board really is reflowed. Without it the test would
  // pass on the design canvas, where the handles were never in doubt.
  const columns = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".ss-grid");
    return grid
      ? Number(getComputedStyle(grid).getPropertyValue("--ss-cols"))
      : null;
  });
  expect(columns, "mobile preview repacks the board").toBeLessThan(6);

  const cell = page.locator("li[data-grid-cell]").first();
  const box = (await cell.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1_000);

  // RESIZING: a lone block on an otherwise empty board has plenty of room on
  // the repacked layout too, so the handle is a real control, not an
  // explanation — only a tile already filling the repacked board's full
  // width and height goes inert (see the next test). Dragging it out grows
  // the tile on screen AND, once it lands, on the stored design: reflow's
  // ratio is inverted to translate the repacked delta back onto the design's
  // own column count (see invertReflowResize).
  const resize = page.getByRole("button", { name: /^Resize / });
  await expect(resize).toBeVisible();
  await expect(resize).not.toHaveAttribute("aria-disabled", "true");

  const boxBefore = (await cell.boundingBox())!;
  const resizeHandle = (await resize.boundingBox())!;
  const grab = {
    x: resizeHandle.x + resizeHandle.width / 2,
    y: resizeHandle.y + resizeHandle.height / 2,
  };
  await touchDrag(page, grab, { x: grab.x + 120, y: grab.y });
  await page.waitForTimeout(700);

  const boxAfter = (await cell.boundingBox())!;
  expect(boxAfter.width, "dragging the handle out widened the tile").toBeGreaterThan(
    boxBefore.width + 10,
  );

  // The grow has to be a real design edit, not a transient reflow artifact:
  // on the full design view (never reflowed at 6-of-6 columns) the block
  // spans more than the default two of six columns it was inserted at.
  await page.getByRole("button", { name: "Desktop preview" }).first().click();
  await page.waitForTimeout(800);
  const designBox = (await page.locator(".ss-grid").first().boundingBox())!;
  const designCell = (await page.locator("li[data-grid-cell]").first().boundingBox())!;
  expect(
    designCell.width / designBox.width,
    "the widened block still spans more of the design than the default two-of-six columns",
  ).toBeGreaterThan(2 / 6 + 0.02);

  await page.getByRole("button", { name: "Mobile preview" }).first().click();
  await page.waitForTimeout(1_200);

  // ROTATION: drawn, and it actually turns the block. A quarter swing of the
  // handle around the tile's centre.
  const rotate = page.getByRole("slider", { name: /^Rotate / }).first();
  await expect(rotate).toBeVisible();
  const handle = (await rotate.boundingBox())!;
  const centre = await cell.boundingBox().then((c) => ({
    x: c!.x + c!.width / 2,
    y: c!.y + c!.height / 2,
  }));
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const to = {
    x: centre.x - (from.y - centre.y),
    y: centre.y + (from.x - centre.x),
  };
  await touchDrag(page, from, to);
  await page.waitForTimeout(700);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector("li[data-grid-cell]")!).rotate,
      ),
    )
    .not.toBe("none");

  // And now that the board carries a tilt it no longer repacks at all (see
  // DesignerCanvas's `responsive` prop), so the resize handle stays a working
  // control rather than an explanation.
  const resizeAfterTilt = page.getByRole("button", { name: /^Resize / });
  await expect(resizeAfterTilt).toBeVisible();
  await expect(resizeAfterTilt).not.toHaveAttribute("aria-disabled", "true");
});

test("mobile preview: a tile already filling the repacked board stays inert", async ({
  page,
}) => {
  const user = freshUser("mpreviewfull");
  await signUp(page, user);
  await seedProducts(await userIdByEmail(user.email), [
    { title: "Enamel Mug", image_key: PHOTO },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  await page.waitForTimeout(800);

  // Grow the block to the design's full width (2 -> 6 of 6 columns) on the
  // DESIGN view, from the keyboard: Shift+ArrowRight grows the far edge one
  // column per press, anchored at the block's own top-left.
  const tile = page.locator("[data-block-tile]").first();
  await tile.focus();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(150);
  }

  await page.getByRole("button", { name: "Mobile preview" }).first().click();
  await page.waitForTimeout(1_200);

  // The premise: reflowed, AND this lone block now fills the repacked
  // board's full width and full height (its only row) — the one case with
  // genuinely nowhere left to grow.
  const columns = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".ss-grid");
    return grid
      ? Number(getComputedStyle(grid).getPropertyValue("--ss-cols"))
      : null;
  });
  expect(columns, "mobile preview repacks the board").toBeLessThan(6);

  const cell = page.locator("li[data-grid-cell]").first();
  const box = (await cell.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1_000);

  const resize = page.getByRole("button", { name: /^Resizing is unavailable/ });
  await expect(resize).toBeVisible();
  await expect(resize).toHaveAttribute("aria-disabled", "true");
});
