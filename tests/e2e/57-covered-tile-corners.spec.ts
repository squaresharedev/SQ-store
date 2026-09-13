import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  clearAuthRateLimits,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A shape layered UNDER a product on the same cells is part of that tile, so
 * nothing of it may show past the card.
 *
 * Two leaks used to get through. A sharp square under a card rounded past the
 * theme kept its corners, because each block was clipped to its own
 * roundness. And at matching corners, two identical antialiased edges stacked
 * let a rim of the lower colour through. The rules are pinned in
 * tests/unit/storefront-tile-covers.test.ts; what only the canvas can show is
 * the pixels, and what happens while the card is dragged off the shape (the
 * placement stays committed for the whole gesture, so a stale cover would keep
 * rounding a square that is now in plain view).
 *
 * At 1.25x device pixels, the scaling most Windows laptops ship with, because
 * that is where the rim shows along straight edges as well as round ones.
 */
test.use({ deviceScaleFactor: 1.25 });

const SHAPE_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

/** A black 2x2 square with a product card rounded at 24 stacked on it. */
async function setUpStack(page: Page, tag: string) {
  // Every localhost sign-up shares one rate-limit bucket, so the second test
  // in a run can be refused before it reaches the canvas.
  await clearAuthRateLimits();
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [{ title: "Stacked mug" }]);
  const [{ id: productId }] = (await serviceRest(
    `/products?owner_id=eq.${ownerId}&select=id`,
  )) as Array<{ id: string }>;

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];
  const stored = (await serviceRest(
    `/storefronts?id=eq.${storefrontId}&select=config`,
  )) as Array<{ config: { theme: { cornerRadius: number } } & Record<string, unknown> }>;
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        ...stored[0].config,
        blocks: [
          { type: "shape", id: SHAPE_ID, kind: "square", color: "#000000", x: 0, y: 0, w: 2, h: 2, z: 0 },
          { type: "product", productId, x: 0, y: 0, w: 2, h: 2, z: 1, style: { cornerRadius: 24 } },
        ],
      },
    },
  });
  await page.reload();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
  await canvasStill(page);
  // The square's own clip, scaled by its 2-cell span.
  return { ownRadius: `${stored[0].config.theme.cornerRadius * 2}px` };
}

const shapeCell = (page: Page) => page.locator('li[data-grid-key^="s_"]');
const productCell = (page: Page) => page.locator('li[data-grid-key^="p_"]');

/** What the square's cell is clipped to, off the inline style the canvas writes. */
function clipOf(page: Page) {
  return shapeCell(page).evaluate((cell: HTMLElement) => ({
    radius: cell.style.borderRadius,
    cover: cell.style.getPropertyValue("--tile-cover-clip"),
  }));
}

/**
 * Pixels in and just around the card that change when the square under it is
 * hidden. Anything at all is the square showing through.
 */
async function leakedPixels(page: Page): Promise<number> {
  // Off the board, so no hover outline is drawn into either capture.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
  const box = (await productCell(page).boundingBox())!;
  const clip = { x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 };
  const capture = async () => (await page.screenshot({ clip })).toString("base64");

  const withShape = await capture();
  await shapeCell(page).evaluate((cell: HTMLElement) => {
    cell.style.visibility = "hidden";
  });
  const without = await capture();
  await shapeCell(page).evaluate((cell: HTMLElement) => {
    cell.style.visibility = "";
  });

  return page.evaluate(async ([a, b]) => {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = `data:image/png;base64,${src}`;
      });
    const [first, second] = await Promise.all([load(a), load(b)]);
    const canvas = document.createElement("canvas");
    canvas.width = first.width;
    canvas.height = first.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(first, 0, 0);
    const pa = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(second, 0, 0);
    const pb = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const delta = Math.max(
        Math.abs(pa[i] - pb[i]),
        Math.abs(pa[i + 1] - pb[i + 1]),
        Math.abs(pa[i + 2] - pb[i + 2]),
      );
      if (delta > 2) changed += 1;
    }
    return changed;
  }, [withShape, without] as const);
}

test.describe("a shape layered under a product", () => {
  test("shows nothing past the card", async ({ page }) => {
    await setUpStack(page, "coverpx");

    // The square takes the card's corners and pulls its face in past the edge.
    const productRadius = await productCell(page).evaluate(
      (cell: HTMLElement) => cell.style.borderRadius,
    );
    const clip = await clipOf(page);
    expect(clip.radius).toBe(productRadius);
    expect(clip.cover).toMatch(/^inset\(\d+px round \d+px\)$/);

    expect(await leakedPixels(page)).toBe(0);

    // THE CONTROL, so the zero above means something: strip the cover off by
    // hand and the same measurement has to see the square's corners.
    await shapeCell(page).evaluate((cell: HTMLElement) => {
      cell.style.removeProperty("--tile-cover-clip");
      cell.style.borderRadius = "0px";
    });
    expect(await leakedPixels(page)).toBeGreaterThan(0);
  });

  test("gets its own corners back the moment the card is dragged off it", async ({
    page,
  }) => {
    const { ownRadius } = await setUpStack(page, "covergesture");
    await expect.poll(async () => (await clipOf(page)).cover).not.toBe("");

    const box = (await productCell(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 1.6, box.y + box.height / 2, {
      steps: 12,
    });

    // MID-DRAG: the card's committed placement has not changed yet, and the
    // square is already out from under it.
    await expect.poll(() => clipOf(page)).toEqual({ radius: ownRadius, cover: "" });

    await page.mouse.up();
    await page.waitForTimeout(300);
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].map(
        (cell) => cell.style.gridColumn,
      ),
    );
    expect(cells[0]).not.toBe(cells[1]);
    expect(await clipOf(page)).toEqual({ radius: ownRadius, cover: "" });

    // And putting the card back puts the cover back.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await clipOf(page)).cover).not.toBe("");
  });
});
