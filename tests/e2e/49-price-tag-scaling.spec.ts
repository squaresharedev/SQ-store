import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  seedProducts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * The price tag on a product tile: sized against the tile, never invisible,
 * and a route into its own settings.
 *
 * WHAT ONLY THIS CAN PROVE. The scaling is a CSS clamp of container-query
 * units, so its value exists nowhere but a real layout engine looking at a
 * real cell — jsdom sees the expression and no browser resolves it there. And
 * the legibility rule is about a state the tag passes THROUGH: the blank white
 * chip that prompted this appeared while a price was being dragged out of the
 * title band, when the ink and the backing were briefly resolved from two
 * different placements. Only a real pointer drag crosses that state.
 *
 * The units guarantee is pinned in tests/unit/price-tag-legibility.test.ts and
 * the resolvers in tests/component/storefront-tile-style.test.tsx; this is the
 * running editor.
 */

const PHOTO = "https://images.e2e.invalid/price-tag-scaling.jpg";

async function setUp(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [
    { title: "Larder Oak Sideboard", price_cents: 4200, image_key: PHOTO },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /larder oak/i })
    .first()
    .click();
  // The picker is a multi-select: tapping a product arms it, a second press
  // puts the armed ones on the board.
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator("li[data-grid-cell] img")).toBeVisible();
}

/** The chip as PAINTED: its resolved size and the two colours that decide
 *  whether anyone can read it. Computed styles, never the config, because the
 *  bug was a config the browser then resolved into an empty rectangle. */
async function chip(page: Page) {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>("li[data-grid-cell]");
    if (!cell) return null;
    const node = [...cell.querySelectorAll<HTMLElement>("span")].find((span) =>
      /[\d.,]+\s*€|€\s*[\d.,]+/.test(span.textContent ?? ""),
    );
    if (!node) return null;
    const style = getComputedStyle(node);
    const title = [...cell.querySelectorAll<HTMLElement>("span")].find((span) =>
      (span.textContent ?? "").includes("Larder Oak"),
    );
    return {
      fontPx: parseFloat(style.fontSize),
      titlePx: title ? parseFloat(getComputedStyle(title).fontSize) : null,
      color: style.color,
      background: style.backgroundColor,
      cellPx: Math.round(cell.getBoundingClientRect().width),
    };
  });
}

/** WCAG contrast between two rendered `rgb(...)` colours. */
async function inkContrast(page: Page, ink: string, backing: string) {
  return page.evaluate(
    ([text, fill]) => {
      const lum = (value: string) => {
        const [r, g, b] = (value.match(/[\d.]+/g) ?? ["0", "0", "0"])
          .slice(0, 3)
          .map((part) => {
            const s = Number(part) / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const a = lum(text);
      const b = lum(fill);
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return (hi + 0.05) / (lo + 0.05);
    },
    [ink, backing] as const,
  );
}

test.describe("price tag scaling and legibility", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a tag on a fresh 1x1 tile is small, and grows with the block", async ({
    page,
  }) => {
    await setUp(page, "tag-scale");

    // THE CASE THE FEATURE EXISTS FOR. A product dropped on the board takes
    // ONE cell, the smallest tile there is, and its price used to render at a
    // flat px sized for nothing in particular — a chip taking a quarter of the
    // picture it was pricing.
    const small = await chip(page);
    expect(small).not.toBeNull();
    expect(small!.fontPx).toBeLessThanOrEqual(9);

    // The name beside it scales by the SAME rule, so the band keeps its
    // proportions rather than the price towering over what it prices.
    expect(small!.titlePx).not.toBeNull();
    expect(Math.abs(small!.titlePx! - small!.fontPx)).toBeLessThan(4);

    // Grow the block to 3x3 with the keyboard. Nothing about the tag's
    // SETTINGS changes here: only the tile it is drawn on.
    await page.locator("li[data-grid-cell]").first().click();
    for (const key of ["Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowDown", "Shift+ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect
      .poll(async () => (await chip(page))?.cellPx ?? 0)
      .toBeGreaterThan(small!.cellPx * 2);

    const big = await chip(page);
    expect(big!.fontPx).toBeGreaterThan(small!.fontPx * 1.5);
    expect(Math.abs(big!.titlePx! - big!.fontPx)).toBeLessThan(6);
  });

  test("dragging the price out of the band never paints a blank chip", async ({
    page,
  }) => {
    // THE REPORTED BUG. Mid-drag the tag wore the white backing a floated tag
    // gets while still holding ink resolved from the placement it was leaving,
    // and the chip rendered as an empty white rectangle over the picture. A
    // price a buyer cannot read is the one failure this tile may not have, so
    // the contrast is asserted at every step of the gesture, not just at rest.
    await setUp(page, "tag-drag");
    const tile = page.locator("li[data-grid-cell]").first();
    await tile.click();

    // A `shadow` title is the setting that made the two halves disagree: its
    // band needs WHITE ink for the price, and a tag lifted onto the picture is
    // given a WHITE backing. Reproduced exactly rather than approximated,
    // because the pairing is the bug.
    const style = page.getByRole("button", { name: /^Tile style/ }).first();
    if ((await style.getAttribute("aria-expanded")) !== "true") await style.click();
    // Title style lives under Fine tuning, which starts collapsed.
    const fine = page.getByRole("button", { name: /^Fine tuning/ }).first();
    if ((await fine.getAttribute("aria-expanded")) !== "true") await fine.click();
    await page
      .getByRole("group", { name: "Title style" })
      .getByRole("button", { name: "Shadow" })
      .click();
    await page.waitForTimeout(200);

    /**
     * The price must be drawn, and must carry against its own backing.
     *
     * The contrast is asserted against the chip's OWN FILL, which is the whole
     * of the reported bug: a tag on the picture always has one (that is what a
     * backing is for), and both halves of that white-on-white chip were the
     * chip's own. A tag with NO fill is read against whatever it sits on, and
     * there the right answer varies — white over the dark gradient of a
     * `shadow` band is correct and would read as a failure here — so that case
     * is left to tests/unit/price-tag-legibility.test.ts, which can state the
     * backdrop rather than having to infer it from painted pixels.
     */
    const legible = async (when: string) => {
      const painted = await chip(page);
      expect(painted, `${when}: no price is drawn at all`).not.toBeNull();
      if (/,\s*0\s*\)$/.test(painted!.background)) return;
      const ratio = await inkContrast(page, painted!.color, painted!.background);
      expect(
        ratio,
        `${when}: ${painted!.color} on ${painted!.background} is unreadable`,
      ).toBeGreaterThanOrEqual(3);
    };

    await legible("at rest");

    const token = tile.getByRole("button", { name: /^Price / }).first();
    const from = await token.boundingBox();
    const box = await tile.boundingBox();
    expect(from).not.toBeNull();
    expect(box).not.toBeNull();

    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    // Across the picture, pausing at each spot the tag resolves through.
    for (const [fx, fy] of [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.7, 0.25],
    ] as const) {
      await page.mouse.move(box!.x + box!.width * fx, box!.y + box!.height * fy, {
        steps: 8,
      });
      await legible(`mid-drag at ${fx}/${fy}`);
    }
    await page.mouse.up();
    await legible("after the drop");

    // And it really did move: the tag is over the picture now, with the
    // backing that placement gives it.
    const dropped = await chip(page);
    expect(dropped!.background).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("pressing a label opens the controls that shape it", async ({ page }) => {
    // Pointing at the thing you want to change beats hunting the panel for the
    // section that owns it — the same bargain the product page artboard makes.
    await setUp(page, "tag-settings");
    const tile = page.locator("li[data-grid-cell]").first();
    await tile.click();

    await tile.getByRole("button", { name: /^Price / }).first().click();
    const priceSection = page.getByRole("button", { name: /^Price tag/ }).first();
    await expect(priceSection).toBeInViewport();
    expect(await priceSection.getAttribute("aria-expanded")).toBe("true");

    // The tile is still the selection: a press on a label is the LABEL's, and
    // must never reach the tile underneath and toggle it away.
    const titleToken = tile.getByRole("button", { name: /^Title / }).first();
    await expect(titleToken).toBeVisible();

    await titleToken.click();
    const styleSection = page.getByRole("button", { name: /^Tile style/ }).first();
    await expect(styleSection).toBeInViewport();
    expect(await styleSection.getAttribute("aria-expanded")).toBe("true");

    // A press that MOVED the label is the drag doing its work, not a request
    // to open anything, so the panel stays where the seller left it.
    await page.getByRole("button", { name: /^Price tag/ }).first().click();
    const box = await tile.boundingBox();
    const from = await tile
      .getByRole("button", { name: /^Price / })
      .first()
      .boundingBox();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3, {
      steps: 10,
    });
    await page.mouse.up();
    expect(
      await page
        .getByRole("button", { name: /^Price tag/ })
        .first()
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
