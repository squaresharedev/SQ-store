import AxeBuilder from "@axe-core/playwright";
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
 * Placing a tile's two labels, and zooming its picture — the two things a
 * seller does to a product tile that had no route in but a drag.
 *
 * WHAT ONLY THIS CAN PROVE. The resolvers are pinned in
 * tests/unit/storefront-card-style.test.ts and the board in
 * tests/component/card-style-controls.test.tsx, but neither can see the thing
 * that was actually broken: the panel offering a spot and the TILE then
 * drawing the chip somewhere else. Every assertion here reads the rendered
 * tile, not the control that asked for it.
 *
 * Run at three sizes because the panel is a column on a desktop and a bottom
 * sheet on a phone, and a control that is only reachable on one of them is not
 * reachable.
 */

const PHOTO = "https://images.e2e.invalid/label-placement.jpg";

async function setUp(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [
    { title: "Label Print", price_cents: 4200, image_key: PHOTO },
  ]);

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});

  // Two of these once the board has settled: the empty state's own call to
  // action and the toolbar's. Either opens the same picker.
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /label print/i })
    .first()
    .click();
  // The picker is a multi-select: tapping a product arms it, and a second
  // press puts the armed ones on the board.
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell] img")).toBeVisible();
}

/** Open the selected tile's own style controls, where the layout board lives. */
async function openTileStyle(page: Page) {
  const tile = page.locator("li[data-grid-cell]").first();
  await tile.click();
  const section = page.getByRole("button", { name: /^Tile style/ });
  await expect(section).toBeVisible();
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
  await expect(page.getByRole("group", { name: "Label positions" })).toBeVisible();
}

/**
 * Where the price chip sits inside the tile, as fractions of the tile's box.
 *
 * Read off the RENDERED tile rather than off the config, because the bug was
 * exactly a config the tile then declined to honour. Null when no chip is
 * drawn at all.
 */
async function chipSpot(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>("li[data-grid-cell]");
    if (!cell) return null;
    const chip = [...cell.querySelectorAll<HTMLElement>("span")].find((span) =>
      /^\s*[€$£]?\s*[\d.,]+\s*€?\s*$/.test(span.textContent ?? ""),
    );
    if (!chip) return null;
    const box = chip.getBoundingClientRect();
    const frame = cell.getBoundingClientRect();
    return {
      x: (box.left + box.width / 2 - frame.left) / frame.width,
      y: (box.top + box.height / 2 - frame.top) / frame.height,
    };
  });
}

/** The tile's own zoom, straight off the picture's inline transform. */
async function pictureScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const face = [
      ...document.querySelectorAll<HTMLImageElement>("li[data-grid-cell] img"),
    ].find((img) => !img.closest('[data-testid="tile-image-ghost"]'));
    const match = face?.style.transform.match(/scale\(([\d.]+)\)/);
    return match ? Number(match[1]) : 1;
  });
}

/** A device descriptor a describe block may take. `defaultBrowserType` would
 *  force a new worker, which Playwright forbids below file scope — and this
 *  file is about viewport and touch, not about which engine renders it. */
function sized(device: (typeof devices)[string]) {
  const { defaultBrowserType: _engine, ...rest } = device;
  return rest;
}

/** The three sizes this has to work at. The panel is a column on the first
 *  two and a bottom sheet on the last. */
const SIZES = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "tablet", use: sized(devices["iPad (gen 7)"]) },
  { name: "phone", use: sized(devices["iPhone 13"]) },
] as const;

for (const size of SIZES) {
  test.describe(`placing tile labels on ${size.name}`, () => {
    test.use(size.use);

    test("the bare layout takes the price to all three bottom spots", async ({
      page,
    }) => {
      // THE BUG. `bare` is an overlay title with the title switched off, so
      // the tile paints nothing over the picture — but the collision rule was
      // reading the title's STYLE rather than what is drawn, and lifted every
      // bottom spot to the opposite row. The board offered them and the tile
      // then put the chip at the top, which reads as a drag that will not land.
      await setUp(page, `bare-${size.name}`);
      await openTileStyle(page);

      await page
        .getByRole("group", { name: "Layout" })
        .getByRole("button", { name: "Bare" })
        .click();

      const board = page.getByRole("group", { name: "Label positions" });
      // Only one label is on a bare tile, so the board needs no switch and
      // every spot can only mean the price.
      const place = async (spot: string) => {
        await board
          .getByRole("button", { name: `Move the price to the ${spot}` })
          .click();
        await page.waitForTimeout(150);
        const at = await chipSpot(page);
        expect(at, `${spot}: the tile draws no price chip at all`).not.toBeNull();
        return at!;
      };

      // The top row first, as the thing the bottom row has to differ from.
      // Distances are read as fractions of the tile rather than in pixels: the
      // chip's inset follows the tile's roundness, so a threshold in pixels
      // would be a threshold on the theme.
      const top = await place("top center");
      expect(top.y).toBeLessThan(0.5);

      for (const spot of ["bottom left", "bottom center", "bottom right"]) {
        const at = await place(spot);
        // The bug rendered these three AT THE TOP — identical to the row
        // above, and nowhere near the spot the board had just offered.
        expect(at.y, `${spot} rendered at y=${at.y}`).toBeGreaterThan(0.5);
        expect(at.y).toBeGreaterThan(top.y);
      }
      // ...and the columns are honoured too, not just the row.
      const left = await place("bottom left");
      const right = await place("bottom right");
      expect(left.x).toBeLessThan(right.x);
    });

    test("a click places a label, without ever dragging one", async ({ page }) => {
      await setUp(page, `click-${size.name}`);
      await openTileStyle(page);

      // Caption: name over the picture, price in the far corner. Both labels
      // are on the tile, so the board has to be told which one a spot means.
      await page
        .getByRole("group", { name: "Layout" })
        .getByRole("button", { name: "Caption" })
        .click();

      const board = page.getByRole("group", { name: "Label positions" });
      await page.getByRole("button", { name: "Price", exact: true }).click();
      await board
        .getByRole("button", { name: "Move the price to the top left" })
        .click();
      await page.waitForTimeout(120);

      const at = await chipSpot(page);
      expect(at).not.toBeNull();
      // It started in the far corner (Caption's own spot), so both halves of
      // the answer changed.
      expect(at!.x).toBeLessThan(0.5);
      expect(at!.y).toBeLessThan(0.5);

      // And the title, which is the other half of the same switch.
      await page.getByRole("button", { name: "Title", exact: true }).click();
      await board
        .getByRole("button", { name: "Move the title to the top center" })
        .click();
      await expect(
        board.getByRole("button", { name: /^Title at top center/ }),
      ).toBeVisible();
    });
  });

  test.describe(`framing a tile picture on ${size.name}`, () => {
    test.use(size.use);

    test("a corner handle zooms a picture that already fits", async ({ page }) => {
      // The other half of the report: at 100% the picture exactly covers the
      // tile, so there is no overhang to pan and the surface reads as inert.
      // Wheel, pinch and +/- all worked, and all had to be known about first.
      await setUp(page, `crop-${size.name}`);
      const tile = page.locator("li[data-grid-cell]").first();
      await tile.click();
      await page.getByRole("button", { name: /frame the image for/i }).click();

      const framer = page.getByTestId("tile-image-framer");
      await expect(framer).toBeVisible();
      expect(await pictureScale(page)).toBe(1);

      const handle = page.getByTestId("tile-zoom-handle-bottom-right");
      await expect(handle).toBeVisible();

      // A tap: the whole gesture on a phone, where there is no wheel and
      // pinching a thumbnail-sized tile is awkward.
      await handle.click();
      await page.waitForTimeout(120);
      const tapped = await pictureScale(page);
      expect(tapped).toBeGreaterThan(1);

      // And a pull, which is the gesture the arrows are drawn for. Away from
      // the middle of the frame makes the picture bigger.
      const box = (await handle.boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y + 60, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(120);
      expect(await pictureScale(page)).toBeGreaterThan(tapped);
    });
  });
}

test.describe("the new controls, scanned", () => {
  test("the board and the framer carry no serious axe violations", async ({
    page,
  }) => {
    // Seven spot buttons and four corner handles is a lot of new interactive
    // surface on two very small elements. The handles are deliberately not tab
    // stops (zooming is on the framer's own keyboard and in its label), which
    // is exactly the kind of decision worth having a scanner watch.
    await setUp(page, "axe");
    await openTileStyle(page);
    // Settled: axe reads contrast mid-fade as a failure it invented.
    await page.waitForTimeout(600);

    const board = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    expect(
      board.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);

    await page.getByRole("button", { name: /frame the image for/i }).click();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();
    await page.waitForTimeout(600);

    const framing = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      .analyze();
    expect(
      framing.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
  });
});
