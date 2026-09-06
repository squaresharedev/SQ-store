import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  seedProducts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * Framing a product's photo inside its own tile: double-click the tile, drag
 * the picture, and the tile keeps the framing through a save, a reload, and
 * out into the buyer-facing embed payload.
 *
 * The maths is pinned in tests/unit/image-placement.test.ts. What can only be
 * proven here is the WIRING — that a drag on a framed tile moves the picture
 * and not the block, that the mode owns its gestures, and that the framing
 * survives every hop to the buyer.
 */

/** The picture. A URL rather than an R2 key: the e2e stack has no R2
 *  credentials, and presignGetUrl serves an https:// value straight through,
 *  which is how the dev seed data gives products photos. It never loads (the
 *  host does not resolve), which is fine — an <img> with a src is all the
 *  framing surface needs, and the unloaded path is a real one worth covering. */
const PHOTO = "https://images.e2e.invalid/framing-fixture.jpg";

async function productTile(page: Page) {
  return page.locator("li[data-grid-cell]").first();
}

/**
 * The framed picture's inline object-position, or "" when unframed.
 *
 * Explicitly NOT the first img in the tile: while framing there are two, and
 * the dimmed copy showing the rest of the picture comes first in the DOM (it
 * has to, so the face paints over it). This reads the face.
 */
async function objectPosition(page: Page) {
  return page.evaluate(() => {
    const face = [
      ...document.querySelectorAll<HTMLImageElement>("li[data-grid-cell] img"),
    ].find((img) => !img.closest('[data-testid="tile-image-ghost"]'));
    return face?.style.objectPosition ?? "";
  });
}

/** The block's grid placement, so a drag can be proven NOT to have moved it. */
async function placement(page: Page) {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>("li[data-grid-cell]");
    return `${cell?.style.gridColumn ?? ""}|${cell?.style.gridRow ?? ""}`;
  });
}

async function setUpStorefrontWithPhoto(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [{ title: "Framed Print", image_key: PHOTO }]);

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];

  // Two of these once the board has settled: the empty state's own call to
  // action and the toolbar's. Either opens the same picker, which is a
  // multi-select — arming a product, then confirming, puts it on the board.
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /add framed print|framed print/i })
    .first()
    .click();
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell] img")).toBeVisible();
  return { storefrontId, user };
}

/** Enter frame mode, then drag the picture by (dx, dy) from the tile centre. */
async function frameAndDrag(page: Page, dx: number, dy: number) {
  const tile = await productTile(page);
  await tile.dblclick();
  const framer = page.getByTestId("tile-image-framer");
  await expect(framer).toBeVisible();

  const box = (await framer.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe("framing a product image in its tile", () => {
  test("double-click, drag, and the picture moves inside the tile", async ({
    page,
  }) => {
    await setUpStorefrontWithPhoto(page, "frame");

    // Unframed tiles carry no inline placement at all, so a storefront nobody
    // has framed renders exactly as it did before this feature existed.
    expect(await objectPosition(page)).toBe("");

    const before = await placement(page);
    await frameAndDrag(page, -60, 0);

    // The picture moved...
    const framed = await objectPosition(page);
    expect(framed).not.toBe("");
    const [x] = framed.split(" ");
    // Dragging LEFT reveals more of the picture's right side: a larger x.
    expect(Number.parseInt(x, 10)).toBeGreaterThan(50);

    // ...and the BLOCK did not. This is the whole risk of putting a drag
    // surface on a tile the grid already drags.
    expect(await placement(page)).toBe(before);
  });

  test("selecting the tile does not shift the picture inside it", async ({
    page,
  }) => {
    await setUpStorefrontWithPhoto(page, "framesel");

    // The photo's offset INSIDE its own tile, which is the invariant: opening
    // the inspector may step the whole board out from under the panel, so the
    // picture's absolute position is allowed to change and its place in the
    // tile is not.
    const inset = () =>
      page.evaluate(() => {
        const img = [
          ...document.querySelectorAll<HTMLImageElement>(
            "li[data-grid-cell] img",
          ),
        ].find((i) => !i.closest('[data-testid="tile-image-ghost"]'))!;
        const tile = img.closest<HTMLElement>("[data-block-tile]")!;
        const a = img.getBoundingClientRect();
        const b = tile.getBoundingClientRect();
        return {
          top: Math.round(a.top - b.top),
          // How far the picture's bottom edge falls short of the tile's. A
          // positive number here is the picture hanging out of the tile.
          spill: Math.round(a.bottom - b.bottom),
        };
      });

    const before = await inset();
    const tile = await productTile(page);
    await tile.click();
    // Selecting draws the page node on the tile. Chrome left in the tile's own
    // flow gives it a line box, and everything after it — the face, and the
    // photo with it — slides down and out of the bottom.
    await expect(page.locator("[data-page-node]")).toBeVisible();

    expect(await inset()).toEqual(before);
  });

  test("Escape leaves the mode, and the framing stays", async ({ page }) => {
    await setUpStorefrontWithPhoto(page, "frameesc");
    await frameAndDrag(page, -50, -30);
    const framed = await objectPosition(page);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tile-image-framer")).toBeHidden();
    expect(await objectPosition(page)).toBe(framed);
  });

  test("Delete cannot destroy the tile being framed", async ({ page }) => {
    // The framed block is always the selected one, so without an explicit
    // guard the key that should nudge nothing would delete the work.
    await setUpStorefrontWithPhoto(page, "framedel");
    const tile = await productTile(page);
    await tile.dblclick();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  });

  test("arrow keys nudge the picture, never the block", async ({ page }) => {
    await setUpStorefrontWithPhoto(page, "framekeys");
    const tile = await productTile(page);
    await tile.dblclick();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();

    const before = await placement(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);

    expect(await objectPosition(page)).not.toBe("");
    // The grid moves and resizes blocks on these very same arrows.
    expect(await placement(page)).toBe(before);
  });

  test("a click on the empty workspace lets go of everything", async ({
    page,
  }) => {
    await setUpStorefrontWithPhoto(page, "frameaway");
    const tile = await productTile(page);
    await tile.dblclick();
    await expect(page.getByTestId("tile-image-framer")).toBeVisible();

    // The workspace AROUND the board, not the board itself. A press there
    // that never travels is a click on nothing, which drops the selection
    // and the framing with it. Top-left rather than bottom-left: the dev
    // build parks its indicator badge in that corner.
    const workspace = page.locator("main");
    const area = (await workspace.boundingBox())!;
    await page.mouse.click(area.x + 32, area.y + 32);

    await expect(page.getByTestId("tile-image-framer")).toBeHidden();
    await expect(
      page.getByRole("button", { name: /close .* settings/i }),
    ).toHaveCount(0);
  });

  test("a click inside the frame brings that spot to the middle", async ({
    page,
  }) => {
    await setUpStorefrontWithPhoto(page, "frameclick");
    const tile = await productTile(page);
    await tile.dblclick();
    const framer = page.getByTestId("tile-image-framer");
    await expect(framer).toBeVisible();

    const box = (await framer.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    const [x] = (await objectPosition(page)).split(" ");
    // Clicking left of centre pulls that part inward, revealing more of the
    // picture's left: a smaller x.
    expect(Number.parseInt(x, 10)).toBeLessThan(50);
  });

  test("the framing survives save, reload, and reaches the buyer", async ({
    page,
  }) => {
    const { storefrontId } = await setUpStorefrontWithPhoto(page, "framesave");
    await frameAndDrag(page, -70, -40);
    const framed = await objectPosition(page);
    expect(framed).not.toBe("");

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);

    await page.reload();
    await expect(page.locator("li[data-grid-cell] img")).toBeVisible({
      timeout: 20_000,
    });
    expect(await objectPosition(page)).toBe(framed);

    // The point of all this is what a BUYER sees. The embed payload is an
    // allowlist that drops per-tile fields by default, so framing reaching it
    // is a deliberate act that has to stay deliberate.
    // Embedding is off until a seller turns it on and names a host. That is
    // the embed feature's own contract, not this one's, so it is seeded
    // rather than clicked through.
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
    const rows = stored;
    // The embed route lives on the app, not on PostgREST, so this goes
    // through Playwright's request context at the configured baseURL.
    const response = await page.request.get(
      `/api/embed/${rows[0].embed_key}`,
      { headers: { origin: "https://example.com" } },
    );
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as {
      blocks: Array<Record<string, unknown>>;
    };
    const product = payload.blocks.find((b) => b.type === "product");
    expect(product?.imagePlacement).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        scale: expect.any(Number),
      }),
    );
  });
});
