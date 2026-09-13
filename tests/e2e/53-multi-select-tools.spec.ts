import { expect, test, type Page } from "@playwright/test";
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
 * THE SELECTION TOOLBAR, WITH SEVERAL BLOCKS SELECTED.
 *
 * The bar used to fall back to Delete alone the moment a second block joined
 * the selection, which said something untrue about the editor: the inspector
 * beside it has always edited a same-type selection through the very editor a
 * single block uses, so the colour, the stroke, the corners and the opacity
 * were all there — the bar simply stopped offering the route to them.
 *
 * What a component test cannot answer, and this can:
 *
 *   - pressing one of the four really does change EVERY selected block on the
 *     board, not just the one whose values the panel is showing;
 *   - the colour panel opened from a group paints the group;
 *   - several products open several pages, side by side rather than stacked in
 *     one spot;
 *   - and the divider before Duplicate/Delete has something on both sides of
 *     it, which is the whole reason it was drawn wrong.
 */

const MUG = "https://images.e2e.invalid/multi-mug.jpg";
const TOTE = "https://images.e2e.invalid/multi-tote.jpg";

async function newStorefront(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await seedProducts(ownerId, [
    { title: "Enamel Mug", image_key: MUG },
    { title: "Canvas Tote", image_key: TOTE },
  ]);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
}

/** The Element menu carries the common shapes itself; the library behind it is
 *  a panel away and not needed for a square. */
async function addShape(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name })
    .click();
  // Closing the menu makes the board step back out from under it; a click
  // aimed before that settles lands where the tile WAS.
  await canvasStill(page);
}

/** Both products in one visit to the picker: pressing "Add product" a second
 *  time toggles the picker rather than reopening it. */
async function addProducts(page: Page, titles: RegExp[]) {
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  for (const title of titles) {
    await page.getByRole("button", { name: title }).first().click();
  }
  await page.getByRole("button", { name: /^Add \d+ selected/ }).click();
}

const bar = (page: Page) => page.locator("[data-selection-toolbar]");

/** The tile's own surface. Pinned by `data-block-tile`, because the resize and
 *  rotate handles that hang off it carry the block's name in their labels too. */
const tile = (page: Page, name: string) =>
  page.locator(`li[data-grid-cell] [data-block-tile][aria-label*="${name}"]`);

/**
 * What each shape on the board is actually painting: the element the tile
 * gives an inline background to is the shape itself (see ShapeTileContent),
 * and every one of the four controls lands on it.
 */
async function painted(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("li[data-grid-cell]")].flatMap(
      (cell) => {
        const shape = [
          ...cell.querySelectorAll<HTMLElement>("[aria-hidden='true']"),
        ].find((el) => el.style.backgroundColor !== "");
        if (!shape) return [];
        const style = getComputedStyle(shape);
        return [
          {
            key: cell.dataset.gridKey!,
            background: style.backgroundColor,
            radius: style.borderTopLeftRadius,
            opacity: style.opacity,
          },
        ];
      },
    ),
  );
}

test.describe("tools for a multiple selection", () => {
  test("a selection of shapes gets the four, and each lands on all of it", async ({
    page,
  }) => {
    await newStorefront(page, "multitools");
    await addShape(page, /^Add square$/);
    await addShape(page, /^Add square$/);
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);

    // Shift-click builds the selection, the same gesture 03-storefront uses.
    const tiles = tile(page, "square shape");
    await tiles.first().click();
    await tiles.nth(1).click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 blocks", { exact: true })).toBeVisible();

    // CANVA'S FOUR, for a group, in Canva's order — and named for the group
    // rather than for whichever block happens to be first.
    await expect(
      bar(page)
        .locator("button")
        .evaluateAll((els) =>
          els
            .map((el) => el.getAttribute("aria-label") ?? "")
            .filter((name) => !/remove|duplicate/i.test(name)),
        ),
    ).resolves.toEqual([
      "Change the colour of 2 elements",
      "Edit the stroke of 2 elements",
      "Edit the corner roundness of 2 elements",
      "Edit the opacity of 2 elements",
    ]);

    // THE COLOUR PANEL THAT IS ALREADY OPEN. Selecting the first shape opened
    // it on that one shape, before there was a selection to speak of — and it
    // is still pointing at it. A pick has to paint the group the seller can
    // see is selected, so a target that remembered "just this block" from back
    // then would colour one of the two.
    const standard = page.getByRole("group", { name: /standard colors/i });
    await standard.getByRole("button", { name: "Red (#ef4444)" }).click();
    await expect
      .poll(async () => (await painted(page)).map((s) => s.background))
      .toEqual(["rgb(239, 68, 68)", "rgb(239, 68, 68)"]);

    // OPACITY. The bar points at the inspector's own slider rather than
    // opening one over the board — with several selected, the inspector
    // showing it is the group editor, so the summons has to reach in there.
    await bar(page).getByRole("button", { name: /edit the opacity/i }).click();
    await expect(
      page.locator("[data-block-field='opacity'] [role='slider'][data-highlighted]"),
    ).toBeVisible();
    await page
      .getByRole("spinbutton", { name: /shape opacity/i })
      .fill("40");
    await expect
      .poll(async () => (await painted(page)).map((s) => s.opacity))
      .toEqual(["0.4", "0.4"]);

    // CORNERS, the same way.
    await bar(page).getByRole("button", { name: /corner roundness/i }).click();
    await expect(
      page.locator("[data-block-field='corners'] [role='slider'][data-highlighted]"),
    ).toBeVisible();
    await page
      .getByRole("spinbutton", { name: /corner roundness/i })
      .fill("40");
    await expect
      .poll(async () => (await painted(page)).every((s) => s.radius !== "0px"))
      .toBe(true);

    // AND THE BAR'S OWN COLOUR BUTTON aims the panel at the same group, which
    // is the route a seller has on a phone (where selecting a block opens no
    // panel at all) and after the panel has been sent somewhere else.
    await bar(page).getByRole("button", { name: /change the colour/i }).click();
    await standard.getByRole("button", { name: "White (#ffffff)" }).click();
    await expect
      .poll(async () => (await painted(page)).map((s) => s.background))
      .toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)"]);

    // And it is still ONE act: undo takes the whole group's colour back.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () =>
        new Set((await painted(page)).map((s) => s.background)).size,
      )
      .toBe(1);
    await expect
      .poll(async () => (await painted(page)).map((s) => s.background))
      .not.toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)"]);
  });

  test("a circle among the squares withholds the control it cannot answer", async ({
    page,
  }) => {
    // The tests are over the WHOLE selection: a circle has no corner to round,
    // so a group containing one has no corners either — while everything the
    // two really do share stays on the bar.
    await newStorefront(page, "multimixed");
    await addShape(page, /^Add square$/);
    await addShape(page, /^Add circle$/);
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);

    await tile(page, "square shape").first().click();
    await tile(page, "circle shape")
      .first()
      .click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 blocks", { exact: true })).toBeVisible();

    await expect(
      bar(page).getByRole("button", { name: /corner roundness/i }),
    ).toHaveCount(0);
    await expect(
      bar(page).getByRole("button", { name: /change the colour/i }),
    ).toBeVisible();
    await expect(
      bar(page).getByRole("button", { name: /edit the opacity/i }),
    ).toBeVisible();
  });

  test("several products keep their door, and the pages land side by side", async ({
    page,
  }) => {
    await newStorefront(page, "multipages");
    await addProducts(page, [/^Select Enamel Mug$/, /^Select Canvas Tote$/]);
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);

    await tile(page, "Enamel Mug").click();
    await tile(page, "Canvas Tote").click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 blocks", { exact: true })).toBeVisible();

    // THE DIVIDER. With two products the left-hand group is the page door and
    // nothing else, so the seam has something on both sides of it — and the
    // bar never opens with a line drawn beside nothing.
    const firstChild = await bar(page).evaluate(
      (el) => el.firstElementChild?.tagName ?? "",
    );
    expect(firstChild, "the bar opens with a divider").toBe("BUTTON");

    const open = bar(page).getByRole("button", {
      name: /open the product pages for 2 products/i,
    });
    await expect(open).toBeVisible();
    await open.click();

    // Both pages are out, and they are NOT in the same spot: the canvas lays
    // every open artboard out in one row beside the board.
    const boxes = await page
      .locator("[data-artboard-id]")
      .evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().x)),
      );
    expect(boxes).toHaveLength(2);
    expect(new Set(boxes).size, "two pages opened on top of each other").toBe(2);

    // And it is a toggle for the group: pressing it again puts them all away.
    await bar(page)
      .getByRole("button", { name: /close the product pages for 2 products/i })
      .click();
    await expect(page.locator("[data-artboard-id]")).toHaveCount(0);
  });
});
