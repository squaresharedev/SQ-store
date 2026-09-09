import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  canvasStill,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * THE CONTROLS FOR A SELECTED TILE DO NOT SIT ON IT, AND ARE STILL PRESSABLE.
 *
 * They used to sit on it: the rotate handle in the bottom-left corner, the
 * resize handle in the bottom-right, and a control chip in whichever corner it
 * could find free. All three were painted OVER the face, which is where the
 * seller has just put a price tag, a product title, or a sold-out badge, so
 * the work kept disappearing under the tools for doing it, and a press meant
 * for a price chip landed on a handle instead.
 *
 * The BUTTONS have since left the board altogether, into the selection's own
 * island above the canvas (SelectionToolbar, covered by its own component
 * spec). What is still drawn per tile, and what this file is about, are the
 * two HANDLES — resize and rotate — because they are direct manipulation and
 * have to be on the thing they manipulate. They hang outside the tile,
 * welded to its bottom edge, flush rather than floating apart from it or
 * doubling its border. That move is only an improvement if they stay
 * REACHABLE, and chrome outside a tile is drawn over its neighbours in a board
 * where every cell is its own stacking context. Reaching it therefore takes a
 * deliberate lift, and the lift cannot be the pointer's arrival, because the
 * pointer arriving on covered chrome lands on the cover instead.
 *
 * FLUSH is not the same as TOUCHING EXACTLY. A hairline of overlap
 * (`[data-tile-chrome]`'s `-mt-px`) closes any subpixel gap a zoomed stage
 * could round open between two elements measured a fraction of a pixel apart —
 * dead space that belongs to neither the chrome nor the tile, and is exactly
 * where the pointer used to fall through to the free-cell guide behind it. The
 * overlap itself is invisible: the touching edge's own border is dropped
 * (`border-t-0`), so it never draws a second line on top of the tile's, which
 * is what an overlap with a border on both sides actually looks like.
 *
 * What is checked here, all in the real designer:
 *   - nothing overlaps the tile's face by more than that hairline;
 *   - everything is pressable while the tile is hovered;
 *   - everything is pressable while the tile is SELECTED and the pointer is
 *     nowhere near it;
 *   - there is no dead strip between the tile and its controls to lose the
 *     pointer in on the way over;
 *   - a block sitting directly under the tile, covering the strip its handles
 *     hang in, does not take the press meant for them.
 */

const PHOTO = "https://images.e2e.invalid/chrome-fixture.jpg";

async function setUpBoardWithProduct(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  // A PRODUCT tile, not a shape: it is the one with a title band and a price
  // tag, which is the content the chrome used to cover.
  await seedProducts(ownerId, [{ title: "Enamel Mug", image_key: PHOTO }]);

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /add enamel mug|enamel mug/i })
    .first()
    .click();
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
}

/**
 * Every control drawn for a tile: where it sits relative to the tile's own box,
 * and whether a press there would actually reach it.
 *
 * `[data-tile-chrome]` marks the control itself (today, a bare handle) —
 * there is no separate wrapper any more, so `closest(...)` normally just
 * returns the element back to itself. Kept as a lookup rather than read
 * directly in case a future control ever needs one layer of indirection.
 */
async function chrome(page: Page, index = 0) {
  return page.evaluate((cellIndex) => {
    const cell =
      document.querySelectorAll<HTMLElement>("li[data-grid-cell]")[cellIndex];
    const tile = cell.querySelector<HTMLElement>("[data-block-tile]")!;
    const face = tile.getBoundingClientRect();
    // The board is drawn on a stage the canvas may have zoomed, so the
    // fraction-of-a-pixel tolerance for "flush" (a hairline of overlap, never
    // a gap) is not one CSS pixel on screen. Derived, not guessed.
    const scale = tile.offsetWidth > 0 ? face.width / tile.offsetWidth : 1;
    const flush = 1.5 * scale;
    const controls = [
      ...cell.querySelectorAll<HTMLElement>("button[aria-label]"),
    ];
    return controls
      .map((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const held = el.closest<HTMLElement>("[data-tile-chrome]") ?? el;
        const h = held.getBoundingClientRect();
        // A real overlap onto the tile's face — more than the deliberate
        // hairline the seamless weld allows.
        const overlapsFace =
          r.left < face.right - flush &&
          r.right > face.left + flush &&
          r.top < face.bottom - flush &&
          r.bottom > face.top + flush;
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return {
          label: el.getAttribute("aria-label") ?? "",
          overlapsFace,
          // Whatever is under the middle of the control has to BE the control,
          // or something inside it: anything else means a neighbouring cell is
          // painted over it and the press never lands.
          reachable: !!hit && (el === hit || el.contains(hit)),
          opacity: Number(getComputedStyle(held).opacity),
          // How far the control sits from the tile it belongs to, along the
          // axis it hangs off. Positive is a gap: a strip of board that
          // belongs to neither, which is where the pointer used to be lost.
          // Negative (up to the weld's own hairline) is the deliberate overlap
          // that keeps that strip from ever existing.
          gap: h.top >= face.bottom - flush
            ? h.top - face.bottom
            : face.top - h.bottom,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, index);
}

/**
 * Select a tile, then leave it: pointer parked in the corner and focus off the
 * board, with the block still selected.
 *
 * BOTH halves matter. Clicking a tile also FOCUSES it, and a focused cell
 * already shows its chrome and lifts through `:focus-within`, so a spec that
 * only moves the pointer away is still testing focus and passes on a build
 * where selection does nothing at all. Selected-without-focus is not a corner
 * case: it is where the seller is after touching any control in the inspector,
 * after a marquee drag (which selects without focusing anything), and after
 * picking a block in the layers panel.
 */
async function selectAndLeave(page: Page, tile: Locator) {
  await tile.click();
  await expect(tile).toHaveAttribute("data-block-selected", "");
  // Selecting opens the inspector, which makes the board step out from under
  // the panel; measuring before that settles measures where the tile was.
  await canvasStill(page);
  await tile.evaluate((el: HTMLElement) => el.blur());
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.activeElement?.closest("li[data-grid-cell]"),
      ),
    )
    .toBe(false);
  // Still selected: this is about losing focus, not the selection.
  await expect(tile).toHaveAttribute("data-block-selected", "");
  await page.mouse.move(4, 4);
  // Let the chrome settle before anything is measured. A control on its way
  // OUT still computes to opacity 1 for the first frame of its fade, so a spec
  // that measures immediately reads "visible" off a button that is
  // disappearing, and passes on the build where selection shows nothing.
  await settleChrome(page);
}

/** Wait out every transition running inside the board's cells. */
async function settleChrome(page: Page) {
  await page.evaluate(async () => {
    const cells = [...document.querySelectorAll("li[data-grid-cell]")];
    await Promise.all(
      cells
        .flatMap((cell) => cell.getAnimations({ subtree: true }))
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

/** A cell's placement, read off the inline grid area the grid writes. */
async function placement(cell: Locator) {
  return cell.evaluate((el) => {
    const parse = (value: string) => {
      const [line, span] = value.split("/");
      return {
        start: Number.parseInt(line, 10) - 1,
        span: Number.parseInt(span.replace(/\D/g, ""), 10) || 1,
      };
    };
    const column = parse(el.style.gridColumn);
    const row = parse(el.style.gridRow);
    return { x: column.start, y: row.start, w: column.span, h: row.span };
  });
}

/** Walk a block to a cell with the arrow keys, the way a seller would. */
async function moveBlockTo(page: Page, cell: Locator, x: number, y: number) {
  const tile = cell.locator("[data-block-tile]");
  await tile.focus();
  for (let guard = 0; guard < 24; guard += 1) {
    const at = await placement(cell);
    if (at.x === x && at.y === y) return;
    if (at.x !== x) await page.keyboard.press(at.x < x ? "ArrowRight" : "ArrowLeft");
    else await page.keyboard.press(at.y < y ? "ArrowDown" : "ArrowUp");
  }
  throw new Error(`block never reached ${x},${y}`);
}

/** Add a square shape element to the board. */
async function addSquare(page: Page) {
  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "All shapes" })
    .click();
  await page.getByRole("button", { name: "Add square" }).click();
  await page.getByRole("button", { name: "Close library panel" }).click();
}

test.describe("a selected tile's controls stay off its face", () => {
  test("nothing is drawn on the tile, and everything can still be pressed", async ({
    page,
  }) => {
    await setUpBoardWithProduct(page, "chrome");

    const tile = page.locator("li[data-grid-cell] [data-block-tile]");
    await tile.hover();
    await expect(
      page.getByRole("button", { name: /^Resize/ }),
    ).toBeVisible();

    const rows = await chrome(page);
    // The two the grid draws: resize and rotate. The buttons live in the
    // selection island now, off the board entirely. A board that suddenly
    // draws neither handle is not a pass.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.overlapsFace, `${row.label} overlaps the tile`).toBe(false);
      expect(row.reachable, `${row.label} is not pressable`).toBe(true);
    }
  });

  test("the rotate handle is clear of the price tag it used to cover", async ({
    page,
  }) => {
    await setUpBoardWithProduct(page, "chromeprice");
    const tile = page.locator("li[data-grid-cell] [data-block-tile]");
    await tile.hover();

    const overlap = await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>("li[data-grid-cell]")!;
      const rotate = cell.querySelector<HTMLElement>(
        'button[aria-label^="Rotate"]',
      )!;
      // The price tag rides in the tile's title band by default, which is the
      // bottom row of the face — exactly where the rotate handle used to be.
      const band = cell.querySelector<HTMLElement>("[data-title-band]")!;
      const a = rotate.getBoundingClientRect();
      const b = band.getBoundingClientRect();
      return (
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5
      );
    });
    expect(overlap).toBe(false);
  });

  test("the weld draws no doubled border where chrome overlaps the tile", async ({
    page,
  }) => {
    // The hairline overlap that keeps the pointer from ever finding a dead
    // strip (see `chrome()`) is only invisible if the touching edge draws NO
    // border of its own: a handle with a full border sitting a pixel into the
    // tile stacks two border lines on top of each other there, and that
    // doubled, slightly misaligned line is exactly what reads as a visible
    // overlap glitch rather than a seamless weld.
    await setUpBoardWithProduct(page, "chromeborder");
    const tile = page.locator("li[data-grid-cell] [data-block-tile]");
    await tile.hover();

    const borders = await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>("li[data-grid-cell]")!;
      const resize = cell.querySelector<HTMLElement>(
        'button[aria-label^="Resize"]',
      )!;
      const rotate = cell.querySelector<HTMLElement>(
        'button[aria-label^="Rotate"]',
      )!;
      return {
        // The handles sit BELOW the tile: their TOP edge overlaps.
        resizeTop: getComputedStyle(resize).borderTopWidth,
        rotateTop: getComputedStyle(rotate).borderTopWidth,
      };
    });
    expect(borders.resizeTop).toBe("0px");
    expect(borders.rotateTop).toBe("0px");
  });

  test("the controls are welded flush to the tile, with no dead strip to lose the pointer in", async ({
    page,
  }) => {
    // A gap between handle and tile belongs to nobody: crossing it on the way
    // to a button put the pointer on the free-cell guide underneath, which
    // took `:hover` off the cell, faded the button out, dropped the cell out
    // of the chrome band mid-reach, and lit the guide up as if IT were the
    // thing being aimed at. The weld closes that strip entirely.
    await setUpBoardWithProduct(page, "chromegap");
    const tile = page.locator("li[data-grid-cell] [data-block-tile]");

    // First, the other half of the bargain. Chrome that is not showing must
    // not take presses either: it hangs over the cell below, which on this
    // board is a free cell whose whole job is to be clicked, and an
    // `opacity: 0` button still hit-tests. Press the board's own background to
    // put the tile out of the selection the picker left it in, then look at
    // what owns the strip the handles live in.
    const board = (await page.locator("[data-canvas-board]").boundingBox())!;
    await page.mouse.click(board.x + 4, board.y + 4);
    await expect(tile).not.toHaveAttribute("data-block-selected", "");
    await page.mouse.move(4, 4);
    await settleChrome(page);
    const ownerOfStrip = await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>("li[data-grid-cell]")!;
      const handle = cell.querySelector<HTMLElement>(
        'button[aria-label^="Resize"]',
      )!;
      const r = handle.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        handleOpacity: getComputedStyle(handle).opacity,
        insideCell: !!hit && cell.contains(hit),
      };
    });
    expect(ownerOfStrip.handleOpacity).toBe("0");
    expect(
      ownerOfStrip.insideCell,
      "a hidden handle is still swallowing the cell it hangs over",
    ).toBe(false);

    await tile.hover();

    const rows = await chrome(page);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.gap, `${row.label} is not welded flush to the tile`).toBeLessThanOrEqual(0);
    }

    // And the walk itself: from inside the tile out to the middle of a control,
    // every step of the way stays on this cell. One step landing anywhere else
    // is one dropped hover.
    const strays = await page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>("li[data-grid-cell]")!;
      const tileEl = cell.querySelector<HTMLElement>("[data-block-tile]")!;
      const face = tileEl.getBoundingClientRect();
      const off: string[] = [];
      for (const control of cell.querySelectorAll<HTMLElement>(
        "button[aria-label]",
      )) {
        const r = control.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Straight out of the tile and into the control, down the corridor the
        // two share. A control with no such corridor is reached diagonally and
        // is the geometry check's business, not this one's.
        const lo = Math.max(r.left, face.left) + 2;
        const hi = Math.min(r.right, face.right) - 2;
        if (hi <= lo) continue;
        const x = (lo + hi) / 2;
        const below = r.top >= face.bottom - 2;
        const fromY = below ? face.bottom - 4 : face.top + 4;
        const toY = r.y + r.height / 2;
        const steps = Math.ceil(Math.abs(toY - fromY));
        for (let step = 0; step <= steps; step += 1) {
          const y = fromY + ((toY - fromY) * step) / steps;
          const hit = document.elementFromPoint(x, y);
          if (!hit || !cell.contains(hit)) {
            off.push(
              `${control.getAttribute("aria-label")} @${Math.round(x)},${Math.round(y)} -> ${
                hit ? `${hit.tagName}.${hit.className}` : "nothing"
              }`,
            );
            break;
          }
        }
      }
      return off;
    });
    expect(strays, "the pointer leaves the cell on the way to a control").toEqual(
      [],
    );
  });

  test("a selected tile's controls are pressable with the pointer nowhere near it", async ({
    page,
  }) => {
    // Selection is a state, not a moment: the handles stay out once a block is
    // being worked on, so they have to stay PRESSABLE without being hovered
    // back into reach first.
    await setUpBoardWithProduct(page, "chromeselected");
    const tile = page.locator("li[data-grid-cell] [data-block-tile]");
    await selectAndLeave(page, tile);

    const rows = await chrome(page);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.opacity, `${row.label} is invisible while selected`).toBe(1);
      expect(row.reachable, `${row.label} is not pressable`).toBe(true);
    }

    // And a real press, through Playwright's own hit-testing: it refuses to
    // click an element another one would receive the event for. The page node
    // is in the selection island now, which is exactly the point — nothing on
    // the board can be painted over it there.
    await page
      .locator('[data-selection-toolbar] button[data-page-node="closed"]')
      .click({ timeout: 5_000 });
    // The node itself reports the page is out; the artboard beside the board
    // is 30-product-page's business, not this spec's.
    await expect(
      page.locator('[data-selection-toolbar] button[data-page-node="open"]'),
    ).toBeVisible();
  });

  test("a block directly under a selected tile cannot take its handles", async ({
    page,
  }) => {
    // The trap the move opens, and the one a seller actually hits: the resize
    // and rotate handles hang in the strip BELOW the tile, which on a packed
    // board is another block, one later in reading order, so it paints on top.
    // Reaching across it hovers it, and a hovered neighbour level with the
    // selected cell wins on document order, so the press lands on the neighbour
    // and the handle can never be taken at all.
    await setUpBoardWithProduct(page, "chromestack");
    await addSquare(page);
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);

    const first = page.locator("li[data-grid-cell]").first();
    const second = page.locator("li[data-grid-cell]").nth(1);
    const top = await placement(first);
    // Directly under the product tile, covering the strip its handles hang in.
    await moveBlockTo(page, second, top.x, top.y + top.h);
    const under = await placement(second);
    expect(under).toMatchObject({ x: top.x, y: top.y + top.h });

    const tile = first.locator("[data-block-tile]");
    await selectAndLeave(page, tile);

    const rows = await chrome(page, 0);
    for (const row of rows) {
      expect(row.reachable, `${row.label} is not pressable`).toBe(true);
    }

    // Approaching ACROSS the neighbour is the path that used to deadlock: the
    // neighbour lights up under the pointer and stays in front of the handle.
    // Located by attribute, not by role: the rotate handle carries
    // role="slider" so assistive tech hears the angle it holds.
    const handle = first.locator('button[aria-label^="Rotate"]');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 12,
    });
    const reached = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    });
    expect(reached, "the neighbour takes the press meant for the handle").toBe(
      true,
    );
    // Playwright's own actionability check, which fails on an intercepted click.
    await handle.click({ timeout: 5_000 });
  });
});
