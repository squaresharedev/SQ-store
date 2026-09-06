import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  freshUser,
  gotoApp,
  seedProducts,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * HOW THE CANVAS IS ARRANGED once product pages are open on it, at every
 * width the editor is used at.
 *
 * Six things, all of them geometry rather than content (spec 30 covers what
 * a page SAYS):
 *
 *  1. Grabbing the empty space between the board and a page drags the
 *     workspace. That gap is inside the stage's own flex box, so the "did the
 *     press land on the workspace element" test used to say no there and the
 *     most obvious place to grab the canvas did nothing.
 *  2. Pages sit SIDE BY SIDE. Stacked, the second page starts a whole page
 *     height below the board, where nothing about the storefront is on screen.
 *  3. A page's own top lines up with the STOREFRONT's own top: it reads as
 *     belonging to the board it opened from, not as a separate thing hanging
 *     lower on the workspace.
 *  4. A connector leaves the STOREFRONT's own top-right corner heading UP,
 *     not the tile whose page it is, arcs over, and comes back DOWN into the
 *     top-centre of its page's own card: one smooth arch, with no straight
 *     segment or joint partway along it.
 *  5. The FURTHER OUT a page is, the HIGHER its arch rises: every line shares
 *     one origin and leaves it heading the same way, so two lines of equal
 *     height would run together near the top instead of just meeting once.
 *  6. Each page's own card renders at three-quarters size on the canvas, so
 *     it takes up less room, but the page underneath it still lays out at
 *     its full, real width exactly as a buyer's browser would, just shrunk
 *     in paint, not in layout.
 */

/** The default theme, spelled out: the spec must not reach into src/. */
const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 0,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

type Seeded = { storefrontId: string; lamp: string; stool: string };

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const storefrontId = (
    (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[]
  )[0]!.id;

  await seedProducts(sellerId, [
    { title: "Oak lamp", price_cents: 12900, description: "Warm light." },
    { title: "Oak stool", price_cents: 8900, description: "Three legs." },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const byTitle = (title: string) => products.find((p) => p.title === title)!.id;
  const seeded = { storefrontId, lamp: byTitle("Oak lamp"), stool: byTitle("Oak stool") };

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [
          // Deliberately NOT at the board's own top-right corner: the point
          // of assertion 3 is that the line ignores where the tile sits.
          { type: "product", productId: seeded.lamp, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.stool, x: 0, y: 2, w: 2, h: 2 },
        ],
      },
    },
  });
  return seeded;
}

/**
 * Put the settings panel away if it is up.
 *
 * On a phone it is a bottom sheet standing on most of the workspace, and
 * selecting a tile opens it, so leaving it there would hide the NEXT tile
 * this spec has to reach. Harmless on desktop, where the panel is docked
 * beside the canvas and never covers a tile.
 */
async function dismissPanel(page: Page) {
  const close = page.getByRole("button", { name: /^close .+ panel$/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await canvasStill(page);
  }
}

/**
 * Press a control on the canvas.
 *
 * A real click wherever one lands, which is everywhere on a desktop. On a
 * PHONE it can't always: a board plus a full-width product page is far wider
 * than 390px even at the zoom floor, so the board (and the tiles on it) end up
 * outside the window, and reaching them is a matter of panning, which this
 * spec tests directly further down and has no business re-testing on every
 * control it has to press. So the fallback dispatches the click straight at
 * the element.
 */
async function pressCanvasButton(page: Page, name: string | RegExp) {
  const button = page.getByRole("button", { name }).first();
  await expect(button).toBeAttached();
  await button.click({ timeout: 5_000 }).catch(() => button.dispatchEvent("click"));
}

/** Open one product's page from its own tile: select the tile, then press the
 *  node that appears on it. */
async function openPageFor(page: Page, title: string) {
  await dismissPanel(page);
  await pressCanvasButton(page, `Select ${title}`);
  await canvasStill(page);
  await pressCanvasButton(
    page,
    new RegExp(`^open the product page for ${title}$`, "i"),
  );
}

/**
 * The stage's live pan, read off the transform the viewport writes there.
 * (State, not React state: see useCanvasViewport, so this is the only place
 * it can be read from.)
 */
async function stagePan(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const stage = document.querySelector("[data-canvas-stage]") as HTMLElement | null;
    const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(
      stage?.style.transform ?? "",
    );
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
  });
}

/** Where every end of every connector is, plus the board and the pages it
 *  joins, all in the stage's own untransformed coordinates, so the numbers
 *  mean the same thing at any zoom. */
async function connectorGeometry(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector("[data-canvas-stage]") as HTMLElement;
    const board = stage.querySelector("[data-canvas-board]") as HTMLElement;
    const svg = stage.querySelector("[data-page-connectors]") as SVGSVGElement | null;
    const box = (node: HTMLElement) => ({
      left: node.offsetLeft,
      top: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
    // Each connector is one <g> holding the path and its two end dots, in
    // the same order as the open pages.
    const ends = [...(svg?.querySelectorAll("g") ?? [])].map((group) => {
      const [start, finish] = [...group.querySelectorAll("circle")];
      const path = group.querySelector("path")!;
      return {
        start: { x: Number(start.getAttribute("cx")), y: Number(start.getAttribute("cy")) },
        finish: { x: Number(finish.getAttribute("cx")), y: Number(finish.getAttribute("cy")) },
        d: path.getAttribute("d") ?? "",
      };
    });
    return {
      board: box(board),
      artboards: [...stage.querySelectorAll("[data-artboard-id]")].map((node) => ({
        id: (node as HTMLElement).dataset.artboardId!,
        ...box(node as HTMLElement),
        // The visible card inside the artboard, below its own label row:
        // what a connector actually lands on (see data-artboard-card).
        card: box(
          (node as HTMLElement).querySelector("[data-artboard-card]") as HTMLElement,
        ),
      })),
      tiles: Object.fromEntries(
        [...stage.querySelectorAll("[data-grid-key]")].map((node) => [
          (node as HTMLElement).dataset.gridKey!,
          box(node as HTMLElement),
        ]),
      ),
      ends,
    };
  });
}

/**
 * A point in the empty space between the board and the first page, in client
 * coordinates, or null if there isn't one on screen.
 *
 * Found by hit-testing rather than by arithmetic, because "empty" is exactly
 * the question the pan gesture itself asks: what is actually on top at this
 * pixel. On a phone the design panel is a bottom sheet standing on part of
 * the workspace, so the search walks down the gap until it finds a row the
 * sheet is not covering.
 */
async function gapPoint(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector("[data-canvas-stage]") as HTMLElement;
    const main = stage.parentElement as HTMLElement;
    const board = stage.querySelector("[data-canvas-board]")!.getBoundingClientRect();
    const artboard = stage
      .querySelector("[data-artboard-id]")!
      .getBoundingClientRect();
    const x = (board.right + artboard.left) / 2;
    const room = main.getBoundingClientRect();
    if (x <= room.left + 2 || x >= room.right - 2) return null;
    for (let y = room.top + 8; y < room.bottom - 8; y += 8) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !hit.closest("[data-canvas-stage]")) continue;
      if (hit.closest("[data-canvas-board], [data-artboard-id]")) continue;
      if (hit.closest("button, a, input, select, textarea")) continue;
      return { x, y };
    }
    return null;
  });
}

/**
 * The same point, after scrolling the canvas until it is actually on screen.
 *
 * On a phone the gap starts off past the left edge of the window (the board
 * plus a page is far wider than the window even at the zoom floor), so a
 * seller reaches it by scrolling first. The wheel is the right way to do that
 * here: it is a different route into the viewport than the grab-drag under
 * test, so using it cannot make that assertion pass on its own.
 */
async function reachableGapPoint(page: Page) {
  const room = page.viewportSize()!;
  await page.mouse.move(room.width / 2, room.height / 2);
  for (let i = 0; i < 24; i += 1) {
    const point = await gapPoint(page);
    if (point) return point;
    await page.mouse.wheel(-200, 0);
    await canvasStill(page);
  }
  return null;
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`canvas with pages open, ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("pages sit side by side and level with the board, joined to its top-right corner by an arch, and the gap between them drags the canvas", async ({
      page,
    }) => {
      const s = await seed(page, `canvas-${viewport.name}`);
      await gotoApp(page, `/storefront/${s.storefrontId}`);
      await expect(
        page.getByRole("button", { name: "Add product", exact: true }),
      ).toBeVisible();

      await openPageFor(page, "Oak lamp");
      await expect(page.locator(`[data-artboard-id="${s.lamp}"]`)).toBeVisible();
      await openPageFor(page, "Oak stool");
      await expect(page.locator(`[data-artboard-id="${s.stool}"]`)).toBeVisible();
      // The phone's bottom sheet stands on the workspace: with it up there is
      // no empty gap to grab, which is a fact about the sheet rather than
      // about the canvas.
      await dismissPanel(page);
      await canvasStill(page);

      const geometry = await connectorGeometry(page);
      expect(geometry.artboards.map((a) => a.id)).toEqual([s.lamp, s.stool]);
      const [first, second] = geometry.artboards;

      // 2. SIDE BY SIDE. The second page starts to the RIGHT of where the
      // first one ends, and the two share a row rather than a column.
      expect(second.left).toBeGreaterThanOrEqual(first.left + first.width);
      expect(second.top).toBe(first.top);

      // 3. LEVEL WITH THE BOARD. Each page's own card starts at the same
      // height as the board's own card, not lower on the workspace.
      for (const artboard of geometry.artboards) {
        expect(artboard.card.top).toBeCloseTo(geometry.board.top, 0);
      }

      // 4. ONE ORIGIN, ON THE BOARD'S TOP-RIGHT CORNER. Every line leaves
      // that exact point...
      const boardCorner = {
        x: geometry.board.left + geometry.board.width,
        y: geometry.board.top,
      };
      expect(geometry.ends).toHaveLength(2);
      for (const end of geometry.ends) {
        expect(end.start.x).toBeCloseTo(boardCorner.x, 0);
        expect(end.start.y).toBeCloseTo(boardCorner.y, 0);
      }
      // ...and not from the tile, which is what it used to do: both tiles are
      // over on the board's left, and the stool's is lower than the lamp's.
      const lampTile = geometry.tiles[`p_${s.lamp}`]!;
      const stoolTile = geometry.tiles[`p_${s.stool}`]!;
      expect(lampTile.left + lampTile.width).toBeLessThan(boardCorner.x - 20);
      expect(stoolTile.top).toBeGreaterThan(lampTile.top);

      // Each line lands on the TOP-CENTRE of its own page's card, not
      // partway down its side and not on the label row above the card.
      geometry.ends.forEach((end, index) => {
        const card = geometry.artboards[index]!.card;
        expect(end.finish.x).toBeCloseTo(card.left + card.width / 2, 0);
        expect(end.finish.y).toBeCloseTo(card.top, 0);
      });

      // AN ARCH, NOT A SWOOP: one cubic Bézier (one "C", nothing else, so no
      // straight "L" segment or second curve joined onto it), whose control
      // points sit directly above their own endpoint (a straight-up tangent
      // leaving the corner, a straight-down one arriving at the page) at the
      // SAME height as each other, above both ends: the line climbs, levels
      // off into the turn, then comes back down, rather than swooping across.
      //
      // 5. TALLER THE FURTHER OUT, too: each arch's apex (its flat top, read
      // off either control point) sits HIGHER than the one before it, so the
      // stool's line (further from the board) clears the lamp's rather than
      // running flush against it near the top.
      const apexes: number[] = [];
      for (const end of geometry.ends) {
        const match =
          /^M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)$/.exec(
            end.d,
          );
        expect(match, `unexpected path shape: ${end.d}`).not.toBeNull();
        const [, , , c1x, c1y, c2x, c2y] = match!.map(Number);
        expect(c1x).toBeCloseTo(end.start.x, 0);
        expect(c2x).toBeCloseTo(end.finish.x, 0);
        expect(c1y).toBeCloseTo(c2y, 0);
        expect(c1y).toBeLessThan(end.start.y);
        expect(c1y).toBeLessThan(end.finish.y);
        apexes.push(c1y);
      }
      // Smaller y is higher on screen, so the stool's apex (opened, and laid
      // out, further from the board) must be the lesser of the two.
      expect(apexes[1]).toBeLessThan(apexes[0] - 20);

      // 6. SCALED DOWN ON THE CANVAS, FULL SIZE UNDERNEATH: the card takes a
      // three-quarters footprint, but the page inside it still measures
      // itself at the real desktop width (1280, the default device — see
      // PRODUCT_PAGE_DESKTOP_WIDTH in DesignerCanvas) and is only shrunk by a
      // paint-only transform, never a narrower layout.
      const pageScale = await page.evaluate((artboardIds: string[]) =>
        artboardIds.map((id) => {
          const card = document.querySelector(
            `[data-artboard-id="${id}"] [data-artboard-card]`,
          ) as HTMLElement;
          const inner = card.firstElementChild as HTMLElement;
          return {
            cardWidth: card.offsetWidth,
            innerWidth: inner.offsetWidth,
            transform: getComputedStyle(inner).transform,
          };
        }),
        [s.lamp, s.stool],
      );
      for (const { cardWidth, innerWidth, transform } of pageScale) {
        expect(innerWidth).toBe(1280);
        expect(cardWidth).toBeCloseTo(1280 * 0.75, 0);
        // matrix(a, b, c, d, tx, ty): a and d are the x/y scale factors, and
        // a plain scale() sets both to the same value.
        const matrix = /matrix\(([-\d.]+),/.exec(transform);
        expect(matrix, `unexpected transform: ${transform}`).not.toBeNull();
        expect(Number(matrix![1])).toBeCloseTo(0.75, 2);
      }

      // 1. GRAB THE GAP, DRAG THE CANVAS.
      const gap = await reachableGapPoint(page);
      expect(gap, "no reachable empty space between the board and the pages").not.toBeNull();
      const before = await stagePan(page);
      await page.mouse.move(gap!.x, gap!.y);
      await page.mouse.down();
      await page.mouse.move(gap!.x - 60, gap!.y - 40, { steps: 8 });
      await page.mouse.up();
      const after = await stagePan(page);
      expect(after.x).toBeLessThan(before.x - 20);
      expect(after.y).toBeLessThan(before.y - 10);

      // The drag moved the WORKSPACE, not a block: both pages are still open
      // and the board still holds both tiles where they were.
      const settled = await connectorGeometry(page);
      expect(settled.artboards.map((a) => a.id)).toEqual([s.lamp, s.stool]);
      expect(settled.tiles[`p_${s.lamp}`]).toEqual(lampTile);
      expect(settled.tiles[`p_${s.stool}`]).toEqual(stoolTile);
    });
  });
}
