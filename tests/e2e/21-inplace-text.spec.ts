import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * A text block's WORDS are typed on the block itself, at the size, font and
 * colour they will really have — there is no text field in the side panel.
 *
 * What these cover is the handover: while the caret is in a tile, the canvas
 * has to give up the gestures it normally owns (click selects, arrows move,
 * Backspace deletes, a drag rubber-bands), and take them all back the moment
 * the edit ends. The panel keeps everything ABOUT the words (style, font,
 * size, colour) and gains only a way back into the editor.
 *
 * The second half covers formatting PART of the text: Ctrl+B / I / U and the
 * colour picker act on the selected characters, and the block ends up holding
 * runs rather than one uniform style. The span maths itself is unit-tested
 * (tests/unit/text-spans.test.ts); what needs a browser is that the DOM and
 * the model stay in step through typing, undo and leaving the editor.
 *
 * ONE account, ONE page, shared across the file (sign-ups are rate limited);
 * serial because the page is shared, and every test leaves the canvas empty.
 */

test.describe.configure({ mode: "serial" });

let page: Page;

/** The block's words, as an editable field on the canvas. */
const canvasText = () => page.getByRole("textbox", { name: "Block text" });

/** The selected block's inspector card. */
const inspector = () =>
  page.getByRole("button", { name: /close text block panel/i });

/** Add a block, give it words, and leave the caret. */
async function addText(words: string) {
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(canvasText()).toBeFocused();
  await page.keyboard.type(words);
  await page.keyboard.press("Escape");
  const tile = page.getByText(words, { exact: true }).first();
  await expect(tile).toBeVisible();
  return tile;
}

/** Remove whatever is selected, so the next test starts on a clear board. */
async function clearBoard(tile: ReturnType<Page["getByText"]>) {
  await page.keyboard.press("Delete");
  await expect(tile).toBeHidden();
}

/**
 * Select characters `[start, end)` inside the editor. Done through the DOM
 * because a drag over rendered glyphs cannot name an exact offset, and these
 * assertions are about exact offsets.
 */
async function selectRange(start: number, end: number) {
  await canvasText().evaluate(
    (node, [from, to]) => {
      const positionAt = (offset: number) => {
        let remaining = offset;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        while (walker.nextNode()) {
          const text = walker.currentNode as Text;
          if (remaining <= text.data.length) {
            return { node: text as Node, offset: remaining };
          }
          remaining -= text.data.length;
          last = text;
        }
        return last
          ? { node: last as Node, offset: last.data.length }
          : { node, offset: 0 };
      };
      const from_ = positionAt(from);
      const to_ = positionAt(to);
      const range = document.createRange();
      range.setStart(from_.node, from_.offset);
      range.setEnd(to_.node, to_.offset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [start, end],
  );
  // The editor picks the selection up from `selectionchange`.
  await expect
    .poll(async () =>
      canvasText().evaluate(() => (window.getSelection()?.toString() ?? "").length),
    )
    .toBe(end - start);
}

/** The editor's rendered runs: what the words actually look like right now. */
function runs() {
  return canvasText().evaluate((node) =>
    Array.from(node.childNodes).map((child) => {
      const element = child as HTMLElement;
      const computed = getComputedStyle(element);
      return {
        text: element.textContent ?? "",
        color: computed.color,
        weight: computed.fontWeight,
        style: computed.fontStyle,
      };
    }),
  );
}

/** The same, once the edit has ended and React owns the paragraph again. */
function staticRuns(text: string) {
  return page
    .getByText(text, { exact: true })
    .first()
    .evaluate((node) =>
      Array.from(node.childNodes).map((child) => ({
        text: child.textContent ?? "",
        color:
          child.nodeType === Node.TEXT_NODE
            ? null
            : getComputedStyle(child as HTMLElement).color,
      })),
    );
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signUp(page, freshUser("inplace-text"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("storefront text, edited in place", () => {
  test("a fresh block opens ready to type, and the panel has no field", async () => {
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    // Inserted straight into typing, with the placeholder selected — "add
    // text" means the seller has words in mind.
    await expect(canvasText()).toBeFocused();
    await page.keyboard.type("Spring drop");
    await expect(page.getByText("Spring drop", { exact: true })).toBeVisible();
    await expect(page.getByText("Your text here")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(canvasText()).toBeHidden();
    // Escape leaves the caret, NOT the selection.
    await expect(inspector()).toBeVisible();

    // The panel offers the way back in rather than a field of its own.
    await expect(page.getByRole("textbox", { name: "Text" })).toBeHidden();
    await page.getByRole("button", { name: /edit text on the canvas/i }).click();
    await expect(canvasText()).toBeFocused();
    // Coming back puts the caret at the end: typing appends, it never wipes
    // words the seller already has.
    await page.keyboard.type(" 26");
    await expect(page.getByText("Spring drop 26", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await clearBoard(page.getByText("Spring drop 26", { exact: true }));
  });

  test("clicking a selected block puts the caret in it", async () => {
    const tile = await addText("Hello");
    // Click to select, click to type. Not double-click: selecting a text
    // block opens the colour panel, which slides the board out from under a
    // double-click's second press.
    await tile.click();
    await expect(canvasText()).toBeFocused();

    await page.keyboard.press("End");
    await page.keyboard.type(" there");
    await expect(page.getByText("Hello there", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await clearBoard(page.getByText("Hello there", { exact: true }));
  });

  test("the tile's own Type button opens the editor", async () => {
    // The route that matters on touch, where double-tap is not a gesture to
    // hand a text field to.
    const tile = await addText("Touch me");
    await page
      .getByRole("button", { name: /edit the text of text: touch me/i })
      .click();
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Replaced");
    await expect(page.getByText("Replaced", { exact: true })).toBeVisible();
    await expect(tile).toBeHidden();

    await page.keyboard.press("Escape");
    await clearBoard(page.getByText("Replaced", { exact: true }));
  });

  test("styling from the panel applies to the words being typed", async () => {
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page.keyboard.type("Styled");
    // Reaching for a panel control ends the edit; the words survive it.
    await page.getByLabel("Size", { exact: true }).fill("53");
    const styled = page.getByText("Styled", { exact: true }).first();
    await expect
      .poll(async () =>
        styled.evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("53px");
    await page.getByRole("button", { name: "Bold" }).click();

    // Back into the editor: the caret sits in text at the real size and
    // weight, which is the whole point of editing in place.
    await styled.click();
    await expect(canvasText()).toBeFocused();
    expect(
      await canvasText().evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe("53px");
    expect(
      await canvasText().evaluate((node) => getComputedStyle(node).fontWeight),
    ).toBe("700");

    await page.keyboard.press("Escape");
    await clearBoard(styled);
  });

  test("a long paste is capped at what the config stores", async () => {
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    // 400 characters, over the 300 TEXT_MAX_LENGTH allows.
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("x".repeat(400));
    });
    await page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () =>
        canvasText().evaluate((node) => (node as HTMLElement).innerText.length),
      )
      .toBe(300);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-grid-cell]")).toHaveCount(0);
  });

  test("a multi-selection keeps the toggle instead of typing", async () => {
    const first = await addText("One");
    const second = await addText("Two");

    // Shift-click builds a selection of two; no caret goes anywhere.
    await first.click({ modifiers: ["Shift"] });
    await expect(canvasText()).toBeHidden();
    // Clicking a member of a multi-selection narrows to it — still choosing a
    // block, not editing one.
    await second.click();
    await expect(canvasText()).toBeHidden();
    // Now that it IS the sole selection, the next click types.
    await second.click();
    await expect(canvasText()).toBeFocused();

    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    await first.click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-grid-cell]")).toHaveCount(0);
  });

  test("typed words save and come back", async () => {
    await addText("Everything must go");
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.reload();
    await expect(
      page.getByText("Everything must go", { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // And are still editable after the round trip.
    const tile = page.getByText("Everything must go", { exact: true }).first();
    await tile.click(); // select
    await tile.click(); // type
    await expect(canvasText()).toBeFocused();
    await page.keyboard.press("Escape");
    await clearBoard(tile);
  });
});

test.describe("formatting part of a text block", () => {
  test("Ctrl+B bolds the selected characters and nothing else", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(0, 5);
    await page.keyboard.press("ControlOrMeta+b");

    // The heading variant is already semibold (600); the selection goes to a
    // real bold (700), and only the selection does.
    await expect
      .poll(async () => (await runs()).map((run) => [run.text, run.weight]))
      .toEqual([
        ["Hello", "700"],
        [" world", "600"],
      ]);

    await page.keyboard.press("Escape");
    await clearBoard(tile);
  });

  test("Ctrl+I toggles the same selection back off", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(6, 11);
    await page.keyboard.press("ControlOrMeta+i");
    await expect
      .poll(async () => (await runs()).map((run) => [run.text, run.style]))
      .toEqual([
        ["Hello ", "normal"],
        ["world", "italic"],
      ]);

    // The selection survives the repaint, so the same key is the way back.
    await page.keyboard.press("ControlOrMeta+i");
    await expect
      .poll(async () => (await runs()).map((run) => [run.text, run.style]))
      .toEqual([["Hello world", "normal"]]);

    await page.keyboard.press("Escape");
    await clearBoard(tile);
  });

  test("with only a caret, Ctrl+B is the whole block", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(11, 11);
    await page.keyboard.press("ControlOrMeta+b");

    await expect
      .poll(async () =>
        canvasText().evaluate((node) => getComputedStyle(node).fontWeight),
      )
      .toBe("700");
    // It IS the block's own flag, so the panel's Format button shows it.
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.keyboard.press("Escape");
    await clearBoard(tile);
  });

  test("Ctrl+B on a selected tile, with no caret in it, formats the block", async () => {
    const tile = await addText("Hello world");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await clearBoard(tile);
  });

  test("two colours in one sentence, kept after the edit ends", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(0, 5);
    // The panel says what a colour would land on.
    await expect(page.getByText(/colouring the 5 selected/i)).toBeVisible();

    // Reaching into the colour panel keeps the words selected instead of
    // ending the edit — which is the whole reason this can work at all.
    await page.getByRole("button", { name: /^Red \(#/ }).first().click();
    await expect.poll(async () => (await runs()).length).toBe(2);
    const coloured = await runs();
    expect(coloured[0].text).toBe("Hello");
    expect(coloured[0].color).not.toBe(coloured[1].color);

    // Leaving the editor hands the paragraph back to React, still in two runs.
    await page.keyboard.press("Escape");
    const settled = await staticRuns("Hello world");
    expect(settled.map((run) => run.text)).toEqual(["Hello", " world"]);
    expect(settled[0].color).not.toBe(settled[1].color);

    await clearBoard(tile);
  });

  test("typing inside a formatted run stays inside it", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(0, 5);
    await page.keyboard.press("ControlOrMeta+b");
    // Caret in the middle of the bold run.
    await selectRange(3, 3);
    await page.keyboard.type("XX");

    await expect
      .poll(async () => (await runs()).map((run) => [run.text, run.weight]))
      .toEqual([
        ["HelXXlo", "700"],
        [" world", "600"],
      ]);

    await page.keyboard.press("Escape");
    await clearBoard(page.getByText("HelXXlo world", { exact: true }).first());
  });

  test("a format is its own undo step, not part of the typing", async () => {
    await addText("Hello world");
    const tile = page.getByText("Hello world", { exact: true }).first();
    await tile.click();
    await selectRange(0, 5);
    await page.keyboard.press("ControlOrMeta+b");
    await expect.poll(async () => (await runs()).length).toBe(2);
    await page.keyboard.press("Escape");

    // One undo takes back the bold and leaves the sentence alone.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await staticRuns("Hello world")).length).toBe(1);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await staticRuns("Hello world")).length).toBe(2);

    // Still selected across the undo/redo, so Delete alone clears the board —
    // clicking it again would only put the caret back in.
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-grid-cell]")).toHaveCount(0);
  });

  test("part-coloured text saves and comes back", async () => {
    await addText("Half and half");
    const tile = page.getByText("Half and half", { exact: true }).first();
    await tile.click();
    await selectRange(0, 4);
    await page.getByRole("button", { name: /^Red \(#/ }).first().click();
    await expect.poll(async () => (await runs()).length).toBe(2);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^save$/i }).click();
    await page.reload();
    await expect(
      page.getByText("Half and half", { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    const reloaded = await staticRuns("Half and half");
    expect(reloaded.map((run) => run.text)).toEqual(["Half", " and half"]);
    expect(reloaded[0].color).not.toBe(reloaded[1].color);

    await page.getByText("Half and half", { exact: true }).first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-grid-cell]")).toHaveCount(0);
  });
});
