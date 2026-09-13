import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  createProductViaUI,
  createStorefrontViaUI,
  expectToast,
  freshUser,
  gotoApp,
  seedSellerIdentity,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * Add one of the shapes the Element menu carries itself. The full library is a
 * panel away and this row holds the two nobody wants to open a panel for (see
 * EditorToolbar), which is all these cases need.
 */
async function addElement(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Add element" }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name })
    .click();
  // Closing the menu makes the board step back out from under it; a click
  // aimed before that settles lands where the tile WAS.
  await canvasStill(page);
}

/**
 * A save going through.
 *
 * TWO WORDINGS, because a board holding a DRAFT product says so instead (see
 * SF-01 in StorefrontDesigner): the save still succeeded, and the seller is
 * told the tile leads nowhere for buyers yet. Both of these cases place a
 * product straight from the picker, which is a draft until it is published, so
 * the confirmation they get is the second one.
 */
const SAVED = /storefront saved|saved, but some products are still drafts/i;

/**
 * Add one product from the picker.
 *
 * Choosing a product MARKS it; the picker commits the whole choice in one
 * press afterwards, so a spec that clicks the row and walks away adds nothing
 * to the board. (The confirm is skipped when the picker has none, which keeps
 * this honest if the flow ever goes back to adding on the spot.)
 */
async function addProduct(page: Page, title: RegExp) {
  await page
    .getByRole("button", { name: "Add product", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: title }).first().click();
  const confirm = page.getByRole("button", { name: /^Add \d+ selected/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

/** A block's own surface on the board.
 *
 *  NOT `getByRole("button")`: the tile is a plain focusable container by
 *  design, so that the Remove and Frame buttons inside it are not
 *  interactive-in-interactive (see PLT-02 in BlockTile). `data-block-tile`
 *  pins the surface itself, apart from the handles that hang off it and carry
 *  the block's name in their labels too. */
function tile(page: Page, name: string) {
  return page.locator(
    `li[data-grid-cell] [data-block-tile][aria-label*="${name}"]`,
  );
}

test.describe("storefront designer", () => {
  test("create → add blocks → save → embed snippet + settings", async ({ page }) => {
    const user = freshUser("storefront");
    await signUp(page, user);
    // Turning embedding ON is gated on the trader details a seller must
    // publish under (see SellerDetailsNotice on the embed modal, and
    // 50-publish-gate for the gate itself). This case is about the snippet and
    // its settings, so the seller arrives having already filled them in rather
    // than reaching a switch it cannot move.
    await seedSellerIdentity(await userIdByEmail(user.email), {
      businessName: "Grid Goods",
      address: "1 Test Way, Testville",
      email: "grid-goods@example.com",
    });

    // Create a product so the designer has something to place.
    await createProductViaUI(page, { title: "Grid piece", price: "9.00" });

    // --- create a storefront ---
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];

    // --- add a text block via the toolbar ---
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    // --- add a product block ---
    await addProduct(page, /add grid piece|grid piece/i);

    // --- save ---
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, SAVED, 15_000);

    // --- reload: config persisted ---
    await page.reload();
    await expect(page.getByText("Your text here").first()).toBeVisible({ timeout: 20_000 });

    // --- embed modal from the storefront list ---
    await page.goto("/storefront");
    await page.getByRole("button", { name: /^Embed / }).first().click();
    const snippet = page.locator("pre");
    // The snippet carries the storefront's rotatable EMBED KEY, never its id.
    // Publishing the id would make the embed impossible to revoke without
    // deleting the storefront, and would leak the dashboard's own identifier
    // into every page that embeds it.
    await expect(snippet).toContainText("embed.squareshare.to/widget.js");
    await expect(snippet).toContainText(
      /data-squareshare-storefront="[0-9a-f-]{36}"/,
    );
    await expect(snippet).not.toContainText(storefrontId);

    // Embed settings: enable + set a domain, save.
    await page.locator("#embed-enabled").click();
    await page.locator("#embed-domains").fill("myblog.example.com");
    await page.getByRole("button", { name: /save/i }).last().click();
    await expectToast(page, /embed settings saved/i, 10_000);

    // Pasting a URL is normalized (scheme/path stripped), not rejected.
    await page.locator("#embed-domains").fill("https://pasted.example.com/shop");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.locator("#embed-domains")).toHaveValue("pasted.example.com");

    // A genuinely invalid domain (wildcard) is rejected with a visible error.
    await page.locator("#embed-domains").fill("*.wildcard.example.com");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /bare lowercase domains/i }),
    ).toBeVisible();
  });

  test("copy/paste duplicates shapes and text, never products", async ({ page }) => {
    const user = freshUser("copypaste");
    await signUp(page, user);
    await createProductViaUI(page, { title: "Uncopyable", price: "5.00" });

    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
    const cells = page.locator("li[data-grid-cell]");

    // --- product blocks have no copy path ---
    await addProduct(page, /add uncopyable|uncopyable/i);
    await expect(cells).toHaveCount(1);
    await tile(page, "Uncopyable").click();
    await page.keyboard.press("ControlOrMeta+c");
    await expect(page.getByText(/block copied/i)).not.toBeVisible();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(1);

    // --- keyboard copy/paste on a shape ---
    await addElement(page, /^Add square$/);
    await expect(cells).toHaveCount(2);
    // Inserting selects the new block, so it is ready to copy.
    await page.keyboard.press("ControlOrMeta+c");
    await expect(page.getByText(/block copied/i)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(3);
    // Paste again: the clipboard survives and keeps stamping copies.
    await page.keyboard.press("ControlOrMeta+v");
    await expect(cells).toHaveCount(4);

    // --- Duplicate button on a text block (the no-keyboard path) ---
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(cells).toHaveCount(5);
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(cells).toHaveCount(6);
    // Scoped to the board: both the block and its copy carry this text.
    await expect(cells.getByText("Your text here")).toHaveCount(2);

    // --- copies are real blocks: they survive a save + reload ---
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, SAVED, 15_000);
    await page.reload();
    await expect(cells).toHaveCount(6, { timeout: 20_000 });
  });

  test("multi-select: shift-click, marquee, group edit, group delete", async ({ page }) => {
    const user = freshUser("multi");
    await signUp(page, user);
    await createProductViaUI(page, { title: "Solo", price: "3.00" });

    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
    const cells = page.locator("li[data-grid-cell]");

    // --- shift-click builds a selection; the group editor edits BOTH ---
    await addElement(page, /^Add square$/);
    await addElement(page, /^Add square$/);
    await expect(cells).toHaveCount(2);

    const squares = tile(page, "square shape");
    await squares.first().click();
    await squares.nth(1).click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 blocks", { exact: true })).toBeVisible();

    // One change in the group editor lands on every selected block.
    await page
      .getByRole("group", { name: "Shape kind" })
      .getByRole("button", { name: "Circle", exact: true })
      .click();
    await expect(tile(page, "circle shape")).toHaveCount(2);

    // Group delete removes the whole selection at once.
    await page.keyboard.press("Delete");
    await expect(cells).toHaveCount(0);

    // --- marquee selects everything it touches, products included ---
    await addProduct(page, /add solo|solo/i);
    await addElement(page, /^Add square$/);
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(cells).toHaveCount(3);
    // Inserting a block selects it, which opens the inspector — and the board
    // EASES out from under the panel. Measuring before that settles gives a
    // rectangle the board has already left, so the drag below starts on the
    // panel instead of on the frame.
    await canvasStill(page);

    const board = page.locator('ul[aria-label="Storefront canvas"]');
    const box = (await board.boundingBox())!;

    /**
     * Where a marquee may begin.
     *
     * ON A FREE CELL, not on "somewhere near the right edge". The free cells
     * are buttons covering most of the open board and the marquee explicitly
     * hosts its starts on them (see startMarquee in DesignerCanvas); a press
     * that misses them lands on the workspace, which PANS, or on the frame's
     * own text, which selects — and either way no band is ever drawn. Taking
     * the last free cell of the top row aims at the same place the old
     * arithmetic was reaching for, off the board's real geometry rather than
     * off a guess about its edge.
     */
    async function sweepTopRow() {
      const from = await page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>(
          'ul[aria-label="Storefront canvas"]',
        )!;
        const free = [
          ...grid.querySelectorAll<HTMLElement>("button[data-grid-empty]"),
        ]
          .map((cell) => cell.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const top = Math.min(...free.map((r) => r.top));
        const row = free.filter((r) => Math.abs(r.top - top) < 2);
        const last = row[row.length - 1];
        return { x: last.left + last.width / 2, y: last.top + last.height / 2 };
      });
      // Back across the row, like selecting text: the band takes every block
      // it touches.
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 8, box.y + 8, { steps: 8 });
      await page.mouse.up();
    }

    await sweepTopRow();
    await expect(page.getByText("3 blocks", { exact: true })).toBeVisible();
    // Mixed selection: settings differ per type, so group actions only.
    await expect(page.getByText(/different types/i)).toBeVisible();

    // Duplicate covers the copyable blocks (the product is excluded)...
    await page.getByRole("button", { name: /duplicate 2 blocks/i }).click();
    await expect(cells).toHaveCount(5);
    // ...and the fresh copies become the selection; Delete removes them.
    await expect(page.getByText("2 blocks", { exact: true })).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(cells).toHaveCount(3);

    // Marquee again over everything, then delete the lot (product included).
    await sweepTopRow();
    await expect(page.getByText("3 blocks", { exact: true })).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(cells).toHaveCount(0);
  });

  test("undo/redo works from the toolbar", async ({ page }) => {
    const user = freshUser("undo");
    await signUp(page, user);

    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("Your text here")).not.toBeVisible();

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();
  });
});
