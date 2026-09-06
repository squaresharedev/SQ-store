import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  serviceRest,
  signUp,
} from "./helpers";

/**
 * Tilting a block: the handle, the keyboard, and the trip through a save.
 *
 * The geometry is pinned in tests/unit/storefront-rotation.test.ts and
 * tests/unit/grid-edge-resize.test.ts. What can only be proven here is the
 * WIRING, and specifically the three things a tilted tile breaks if the
 * gesture code is wrong: that dragging one still tracks the cursor in SCREEN
 * space (the drag offset must land in `translate`, outside the rotation, or
 * the tile flies off at an angle), that a resize grows the side the hand is
 * actually pulling, and that the tilt is still there afterwards.
 */

/** The tilt the first block is actually painted with. */
async function tilt(page: Page) {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>("li[data-grid-cell]")?.style.rotate ??
      "",
  );
}

/** The block's grid placement, so a gesture can be proven not to have moved it. */
async function placement(page: Page) {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>("li[data-grid-cell]");
    return `${cell?.style.gridColumn ?? ""}|${cell?.style.gridRow ?? ""}`;
  });
}

async function setUpBoardWithShape(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);

  // A shape needs no seeded product and no photo, so it is the cheapest block
  // to put a handle on.
  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "All shapes" })
    .click();
  await page.getByRole("button", { name: "Add square" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  // The library panel takes width off the canvas; closing it puts the board
  // back where the geometry below expects to find it.
  await page.getByRole("button", { name: "Close library panel" }).click();
  // Inserting SELECTS the new block, so the panel is already on it. Clicking
  // the tile here would toggle the selection straight back off.
  await expect(
    page.getByRole("slider", { name: "Block rotation" }),
  ).toBeVisible();
  return user;
}

/** Spin the handle to roughly `degrees`, holding Shift when asked. */
async function dragHandle(page: Page, degrees: number, shift = false) {
  const cell = page.locator("li[data-grid-cell]").first();
  const handle = cell.getByRole("slider", { name: /rotate/i });
  await handle.hover();
  const box = (await cell.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const handleBox = (await handle.boundingBox())!;
  const radius = Math.hypot(
    handleBox.x + handleBox.width / 2 - cx,
    handleBox.y + handleBox.height / 2 - cy,
  );
  // Where the handle sits now, as a bearing clockwise from twelve.
  const start = Math.atan2(
    handleBox.x + handleBox.width / 2 - cx,
    cy - (handleBox.y + handleBox.height / 2),
  );
  const end = start + (degrees * Math.PI) / 180;

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(
    cx + Math.sin(end) * radius,
    cy - Math.cos(end) * radius,
    { steps: 12 },
  );
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
}

test.describe("tilting a block", () => {
  test("a block starts level and carries no rotate at all", async ({ page }) => {
    await setUpBoardWithShape(page, "rotlevel");
    // A board nobody has tilted renders exactly the element it did before
    // tilting existed.
    expect(await tilt(page)).toBe("");
  });

  test("dragging the handle tilts the block without moving it", async ({
    page,
  }) => {
    await setUpBoardWithShape(page, "rotdrag");
    const before = await placement(page);

    await dragHandle(page, 40);

    const rotated = await tilt(page);
    expect(rotated).not.toBe("");
    const degrees = Number.parseFloat(rotated);
    expect(Math.abs(degrees - 40)).toBeLessThan(8);

    // The cells it covers are unchanged: rotation is visual, and the board's
    // placement rules never see it.
    expect(await placement(page)).toBe(before);
  });

  test("Shift lands the spin on a fifteen degree detent", async ({ page }) => {
    await setUpBoardWithShape(page, "rotsnap");
    await dragHandle(page, 38, true);
    const degrees = Number.parseFloat(await tilt(page));
    expect(degrees % 15).toBe(0);
  });

  test("Alt and the arrows nudge, and do not navigate the browser", async ({
    page,
  }) => {
    await setUpBoardWithShape(page, "rotkeys");
    const url = page.url();
    const cell = page.locator("li[data-grid-cell]").first();
    // The TILE is the focusable element, not the cell around it: canvas keys
    // land on it and bubble up to the grid.
    await cell.locator("[data-block-tile]").focus();

    await page.keyboard.press("Alt+ArrowRight");
    expect(await tilt(page)).toBe("1deg");

    await page.keyboard.press("Alt+Shift+ArrowRight");
    expect(await tilt(page)).toBe("16deg");

    await page.keyboard.press("Alt+ArrowLeft");
    expect(await tilt(page)).toBe("15deg");

    // Alt+Arrow is Back and Forward in the browser. An editor that navigated
    // away here would take the unsaved board with it.
    expect(page.url()).toBe(url);
  });

  test("the panel reports the angle and levels the block again", async ({
    page,
  }) => {
    await setUpBoardWithShape(page, "rotpanel");

    await page
      .getByRole("button", { name: "Rotate to 90 degrees" })
      .click();
    expect(await tilt(page)).toBe("90deg");
    await expect(
      page.getByRole("slider", { name: "Block rotation" }),
    ).toHaveAttribute("aria-valuenow", "90");

    await page.getByRole("button", { name: "Level the block" }).click();
    // Levelling DROPS the tilt rather than storing a zero, so the element goes
    // back to carrying no rotate at all.
    expect(await tilt(page)).toBe("");
  });

  test("dragging a tilted tile still tracks the cursor in screen space", async ({
    page,
  }) => {
    // The whole reason the gesture painter writes `translate` and not
    // `transform`: folded into transform the offset is applied INSIDE the
    // rotation, and a tile tilted 45 degrees flies off at 45 degrees to the
    // cursor. Dragging one cell to the right must land one cell to the right.
    await setUpBoardWithShape(page, "rottrack");
    const cell = page.locator("li[data-grid-cell]").first();
    // The TILE is the focusable element, not the cell around it: canvas keys
    // land on it and bubble up to the grid.
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.keyboard.press("Alt+Shift+ArrowRight");
    expect(await tilt(page)).toBe("45deg");

    const box = (await cell.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + box.width, start.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    // Moved exactly one column across, and not a row down.
    expect(await placement(page)).toBe("2 / span 1|1 / span 1");
  });

  test("a tilt survives being dragged and being resized", async ({ page }) => {
    // The gesture painter writes `rotate` straight to the node, and React only
    // re-writes the style properties whose VALUE changed between renders. So
    // blanking the angle when a gesture ended STRAIGHTENED a tilted tile the
    // moment it was dragged, and left it straight: the block's rotation had
    // not changed, so React had nothing to put back. The teardown hands the
    // settled angle back instead.
    await setUpBoardWithShape(page, "rotkeep");
    const cell = page.locator("li[data-grid-cell]").first();
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.keyboard.press("Alt+Shift+ArrowRight");
    expect(await tilt(page)).toBe("30deg");

    // A real pointer drag, not an arrow key: only the gesture path touches the
    // element's inline style, so only a drag can lose the tilt.
    const box = (await cell.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + box.width, start.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await placement(page)).toBe("2 / span 1|1 / span 1");
    expect(await tilt(page)).toBe("30deg");

    // And through a resize, which straightened it for the same reason.
    const moved = (await cell.boundingBox())!;
    const handle = cell.getByRole("button", { name: /resize/i });
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      moved.x + moved.width * 1.5,
      moved.y + moved.height * 1.5,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await tilt(page)).toBe("30deg");
  });

  test("the corner handle stretches a turned tile the way the hand pulls", async ({
    page,
  }) => {
    // The seller's complaint that produced the local-frame resize: the handle
    // turns with the tile, so it drags the tile's OWN bottom-right corner —
    // which at a quarter turn is the corner at the bottom LEFT of the screen.
    // Pulling it down and left has to make the tile bigger down and left.
    // Working in board space instead resized the stored rect along the wrong
    // axis, so pulling the corner up made the tile wider rather than shorter.
    await setUpBoardWithShape(page, "rotcorner");
    const cell = page.locator("li[data-grid-cell]").first();
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await placement(page)).toBe("3 / span 1|3 / span 1");

    await page.getByRole("button", { name: "Rotate to 90 degrees" }).click();
    expect(await tilt(page)).toBe("90deg");

    const box = (await cell.boundingBox())!;
    const handle = cell.getByRole("button", { name: /resize/i });
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    // One cell left and two cells down: the tile's own far corner, two cells
    // out along each of its own axes.
    await page.mouse.move(box.x - box.width, box.y + box.height * 2, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Two by two, reaching a column left and a row down of where it started —
    // and the corner the hand was NOT holding has not moved.
    expect(await placement(page)).toBe("2 / span 2|3 / span 2");
  });

  test("an odd-dimensioned tile at -90 still lands on whole cells when a resize is clamped to the board edge", async ({
    page,
  }) => {
    // A wiring sanity check for the bug report that led to the fix in
    // boardInLocalFrame: a bar turned -90 and then expanded with the corner
    // handle landed offset from the grid instead of filling it (root cause —
    // and the exact geometry, including the half-cell drift this exercises —
    // is pinned in tests/unit/grid-edge-resize.test.ts, "an odd-dimensioned
    // origin at a quarter turn..."). clampToCanvas's own guarantee (whole
    // cells, inside the board) holds either way, so THIS test cannot fail on
    // the half-cell-vs-whole-cell drift itself — only on something worse
    // (a crash, a NaN, a placement the board cannot actually hold, or the
    // empty-cell guides disagreeing with what the tile now covers). It is
    // here to prove the fixed function is really wired into the live corner
    // drag, not standing in for the unit test above.
    await setUpBoardWithShape(page, "rotoddedge");
    const cell = page.locator("li[data-grid-cell]").first();
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowDown");
    expect(await placement(page)).toBe("1 / span 1|2 / span 1");
    // Grow it into a 2x1 bar WHILE STILL LEVEL.
    await page.keyboard.press("Shift+ArrowRight");
    expect(await placement(page)).toBe("1 / span 2|2 / span 1");

    await page.getByRole("button", { name: "Rotate to -90 degrees" }).click();
    expect(await tilt(page)).toBe("-90deg");
    // Rotation alone never moves or resizes a block.
    expect(await placement(page)).toBe("1 / span 2|2 / span 1");

    const box = (await cell.boundingBox())!;
    const handle = cell.getByRole("button", { name: /resize/i });
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    // Far past the board's own edge in every direction, so the clamp this
    // bug lived in is what actually gets exercised, not the ordinary
    // in-bounds path the other tests in this file already cover.
    await page.mouse.move(box.x + box.width * 6, box.y + box.height * 6, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Whole cells, inside the board, and — the part a half-cell drift broke —
    // the board's OWN bookkeeping (the empty-cell guides, which read the
    // tile's footprint) agrees that exactly this rect is what is covered:
    // 36 cells less however many the tile's area now claims.
    const match = /^(\d+) \/ span (\d+)\|(\d+) \/ span (\d+)$/.exec(
      await placement(page),
    )!;
    const [x1, w, y1, h] = match.slice(1).map(Number);
    expect(Number.isInteger(x1)).toBe(true);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(y1)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
    expect(x1 - 1 + w).toBeLessThanOrEqual(6);
    expect(y1 - 1 + h).toBeLessThanOrEqual(6);
    const freeCells = await page
      .locator("button[data-grid-empty]")
      .count();
    expect(freeCells).toBe(36 - w * h);
  });

  test("grabbing a turned tile's edge resizes the side under the hand", async ({
    page,
  }) => {
    // The edge under the hand is the tile's OWN border, found by un-rotating
    // the pointer into the tile's frame. Pull the side of a turned tile
    // outwards and it grows that way on screen, exactly as a level one would.
    // The stored rect follows, which for a tile stood on its side means its
    // rows grow where the seller saw columns.
    await setUpBoardWithShape(page, "rotedge");
    const cell = page.locator("li[data-grid-cell]").first();
    await cell.locator("[data-block-tile]").focus();
    // Away from the board's corner, so the tile has room to grow either way.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await placement(page)).toBe("3 / span 1|3 / span 1");

    await page.getByRole("button", { name: "Rotate to 90 degrees" }).click();
    expect(await tilt(page)).toBe("90deg");

    const box = (await cell.boundingBox())!;
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width + box.width,
      box.y + box.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Two cells wide on screen, so the STORED rect is one column by two rows:
    // the tile is stood on its side, and the box the seller dragged is that
    // rect the other way round. The cells it covers are the one it started on
    // and the one to its right, which is what the hand asked for.
    expect(await placement(page)).toBe("4 / span 1|3 / span 2");
  });

  test("a half-turned tile grows the way the hand pulls, not the other way", async ({
    page,
  }) => {
    // At half a turn the tile's own south edge is the one at the TOP of the
    // screen. Grabbing it and pulling up has to make the tile taller upwards:
    // the edge follows the hand, and the far side stays where it is.
    await setUpBoardWithShape(page, "rotflip");
    const cell = page.locator("li[data-grid-cell]").first();
    await cell.locator("[data-block-tile]").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await placement(page)).toBe("3 / span 1|3 / span 1");

    // 180 degrees: two quarter turns from the panel's own control.
    await page.getByRole("button", { name: "Rotate to 90 degrees" }).click();
    const slider = page.getByRole("slider", { name: "Block rotation" });
    await slider.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    expect(await tilt(page)).toBe("180deg");

    const box = (await cell.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 3);
    await page.mouse.down();
    // Straight up, by a whole cell.
    await page.mouse.move(box.x + box.width / 2, box.y - box.height + 3, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // It grew UPWARDS: a row taller, starting a row earlier.
    expect(await placement(page)).toBe("3 / span 1|2 / span 2");
  });

  test("the tilt survives a save, a reload, and the trip to a buyer", async ({
    page,
  }) => {
    await setUpBoardWithShape(page, "rotsave");
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];
    await page.getByRole("button", { name: "Rotate to 90 degrees" }).click();

    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
    expect(await tilt(page)).toBe("90deg");

    // And out to the buyer. The embed payload is an ALLOWLIST that drops
    // per-block fields by default, so a tilt reaching it is a deliberate act
    // that has to stay deliberate: without it every embed would quietly
    // straighten the seller's design.
    //
    // Embedding is off until a seller turns it on and names a host, which is
    // that feature's own contract rather than this one's, so it is seeded.
    const stored = (await serviceRest(
      `/storefronts?id=eq.${storefrontId}&select=embed_key,config`,
    )) as Array<{ embed_key: string; config: Record<string, unknown> }>;
    await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          ...stored[0].config,
          embed: { enabled: true, domains: ["example.com"] },
        },
      },
    });

    const response = await page.request.get(
      `/api/embed/${stored[0].embed_key}`,
      { headers: { origin: "https://example.com" } },
    );
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as {
      blocks: Array<Record<string, unknown>>;
    };
    expect(payload.blocks[0].rotation).toBe(90);
  });

  test("an untilted board sends a buyer no rotation at all", async ({
    page,
  }) => {
    // The other half of the optional-field contract: a payload for a board
    // nobody tilted has to stay byte-identical to the one the widget already
    // receives today.
    await setUpBoardWithShape(page, "rotembednone");
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);

    const stored = (await serviceRest(
      `/storefronts?id=eq.${storefrontId}&select=embed_key,config`,
    )) as Array<{ embed_key: string; config: Record<string, unknown> }>;
    await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          ...stored[0].config,
          embed: { enabled: true, domains: ["example.com"] },
        },
      },
    });

    const response = await page.request.get(
      `/api/embed/${stored[0].embed_key}`,
      { headers: { origin: "https://example.com" } },
    );
    const payload = (await response.json()) as {
      blocks: Array<Record<string, unknown>>;
    };
    expect("rotation" in payload.blocks[0]).toBe(false);
  });
});
