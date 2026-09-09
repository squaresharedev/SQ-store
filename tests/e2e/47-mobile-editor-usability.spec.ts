import { devices, expect, test, type Page } from "@playwright/test";
import { canvasStill, createStorefrontViaUI, freshUser, gotoApp, signUp } from "./helpers";

/**
 * THE PHONE AS THE ONLY DEVICE.
 *
 * 08-storefront-mobile covers reachability: every control exists and can be
 * pressed at 390px. This file covers the next question, which is whether the
 * editor is usable for a seller who has no desktop to move to: the advisory
 * banner can be put away, the board can be moved by hand, the Element menu
 * opens on screen rather than half off the left edge, and the floating toolbar
 * stops sitting on top of whichever bottom sheet is open.
 */

test.use({ ...devices["iPhone 13"] });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function openDesigner(page: Page) {
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await page.waitForTimeout(1_000);
}

/** The stage's live transform: the only place pan and zoom are written. */
function stageTransform(page: Page) {
  return page.evaluate(
    () =>
      (document.querySelector("[data-canvas-stage]") as HTMLElement | null)
        ?.style.transform ?? "",
  );
}

/**
 * A one-finger drag, dispatched as real pointer events at a real point.
 *
 * The workspace sets `touch-action: none` and drives everything off pointer
 * events, so this is exactly the sequence a finger produces, including the
 * click the browser synthesises afterwards on the element the touch began on,
 * which is the whole reason the pan has to swallow one.
 */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { clickAfter = true }: { clickAfter?: boolean } = {},
) {
  await page.evaluate(
    ({ from, to, clickAfter }) => {
      const start = document.elementFromPoint(from.x, from.y);
      if (!start) throw new Error(`nothing at ${from.x},${from.y}`);
      const base = {
        pointerId: 91,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
      };
      start.dispatchEvent(
        new PointerEvent("pointerdown", { ...base, clientX: from.x, clientY: from.y }),
      );
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...base,
            clientX: from.x + ((to.x - from.x) * i) / steps,
            clientY: from.y + ((to.y - from.y) * i) / steps,
          }),
        );
      }
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          ...base,
          clientX: to.x,
          clientY: to.y,
          buttons: 0,
        }),
      );
      if (clickAfter) {
        start.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: to.x,
            clientY: to.y,
          }),
        );
      }
    },
    { from, to, clickAfter },
  );
  await page.waitForTimeout(200);
}

/**
 * The centre of a free cell a finger could actually land on: on screen, inside
 * the workspace, and the topmost thing at that point. Taking the first free
 * cell in the DOM is not enough: most of the board is scrolled out of the
 * strip a phone leaves, and a point outside it hit-tests to something else.
 */
async function freeCellCentre(page: Page) {
  const point = await page.evaluate(() => {
    const main = document.querySelector("main")?.getBoundingClientRect();
    if (!main) return null;
    for (const cell of document.querySelectorAll<HTMLElement>(
      "button[data-grid-empty]",
    )) {
      const box = cell.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < main.left + 4 || x > main.right - 4) continue;
      if (y < main.top + 4 || y > main.bottom - 4) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && cell.contains(hit)) return { x, y };
    }
    return null;
  });
  if (!point) throw new Error("no reachable free cell on the board");
  return point;
}

/** Put one shape on the board. Free cells are only drawn once the grid has
 *  something in it; an empty storefront shows its empty state instead. */
async function addSquare(page: Page) {
  await page.getByRole("button", { name: "Add element", exact: true }).click();
  await page
    .getByRole("menu", { name: "Elements" })
    .getByRole("menuitem", { name: "All shapes" })
    .click();
  await page.getByRole("button", { name: "Add square" }).click();
  await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close library panel" }).click();
  // Inserting selects the new shape, so its inspector has the slot now. Clear
  // it too: every sheet costs the board 55vh of the room this drag needs.
  await page.getByRole("button", { name: /close shape panel/i }).click();
}

const NOTICE = /For the best editing experience/;
const DISMISS = "Dismiss the small-screen editing notice";

test.describe("the storefront editor as a phone-only surface", () => {
  test("the small-screen notice can be put away, and stays away", async ({ page }) => {
    await signUp(page, freshUser("mobile-notice"));
    await settle(page);
    await openDesigner(page);

    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole("button", { name: DISMISS }).click();
    await expect(page.getByText(NOTICE)).toBeHidden();

    // Advice that comes back on every load is not advice. Remembered per
    // browser, so a reload does not re-levy the two lines it costs.
    await page.reload();
    await settle(page);
    await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
    await expect(page.getByText(NOTICE)).toBeHidden();
  });

  test("a one-finger drag on the board moves the whole workspace", async ({ page }) => {
    await signUp(page, freshUser("mobile-pan"));
    await settle(page);
    await openDesigner(page);
    await addSquare(page);
    await canvasStill(page);

    // The board is fitted to the strip a phone has left over, so it IS the
    // workspace: there is no bare margin beside it to grab, and free cells
    // (which are buttons) cover almost all of what is left. A drag starting on
    // one has to pan, or panning is unreachable on a phone.
    const start = await freeCellCentre(page);
    const before = await stageTransform(page);
    await touchDrag(page, start, { x: start.x, y: start.y - 90 });
    const after = await stageTransform(page);
    expect(after).not.toBe(before);

    // And the press was spent on the pan: the click the browser synthesises
    // after a touch drag must NOT also open the product picker that a free
    // cell opens when it is genuinely tapped.
    const picker = page.getByRole("button", { name: /close add product panel/i });
    await expect(picker).toHaveCount(0);

    // A press that never travels is still a tap, which is the other half of
    // the bargain: the pan only commits once the finger has actually moved.
    await canvasStill(page);
    const tapPoint = await freeCellCentre(page);
    await touchDrag(page, tapPoint, tapPoint);
    await expect(picker).toBeVisible();
  });

  test("the Element menu opens fully on screen", async ({ page }) => {
    await signUp(page, freshUser("mobile-elmenu"));
    await settle(page);
    await openDesigner(page);

    await page.getByRole("button", { name: "Add element", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Elements" });
    await expect(menu).toBeVisible();

    // Centred on the BUTTON (third of eight controls) the row's left edge
    // landed at roughly x=-4 on a 390px screen, putting Upload half off the
    // display. It is centred on the bar now, which is itself centred.
    const box = (await menu.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // ...and centred, not merely nudged inside the edge.
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(8);

    // Upload is the leftmost item and the one that used to fall off the edge.
    for (const name of ["Upload", "All shapes"]) {
      await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
    }

    // No tooltip on the Element button, alone among the insert tools: it would
    // pop into the space this menu already fills, and the menu is drawn on top
    // of it. A label nobody can read is not a label.
    const tips = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[aria-label="Add element"]');
      return button ? button.querySelectorAll("span[aria-hidden='true']").length : -1;
    });
    expect(tips).toBe(0);
  });

  test("the bar stays inside its own pill at the narrow end of phones", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-barfit"));
    await settle(page);
    await openDesigner(page);

    // 390px cleared by 18px and 360px missed by 12, and the child that hangs
    // out of a `shrink-0` row capped at `100vw-2rem` is whichever is last:
    // More, drawn outside the surface it belongs to. Checked at the widths a
    // real phone actually reports, not just the one the suite emulates.
    for (const width of [390, 375, 360]) {
      await page.setViewportSize({ width, height: 664 });
      await page.waitForTimeout(300);
      const bar = await page.evaluate(() => {
        const toolbar = document.querySelector('[role="toolbar"]');
        if (!toolbar) return null;
        const pill = toolbar.getBoundingClientRect();
        // The bar's OWN controls. The Element menu is a descendant of it (and
        // laid out even while hidden), so its rows would otherwise count as
        // toolbar buttons that are both short and, being centred on the pill
        // rather than inside it, sometimes past its edge.
        const controls = [...toolbar.querySelectorAll<HTMLElement>("button[aria-label]")]
          .filter((b) => b.closest("[role='menu']") === null)
          .map((b) => ({ label: b.getAttribute("aria-label"), r: b.getBoundingClientRect() }))
          .filter((c) => c.r.width > 0);
        return {
          outside: controls
            .filter((c) => c.r.left < pill.left - 0.5 || c.r.right > pill.right + 0.5)
            .map((c) => c.label),
          shortTargets: controls.filter((c) => c.r.height < 44).map((c) => c.label),
        };
      });
      expect(bar, `toolbar missing at ${width}px`).not.toBeNull();
      expect(bar!.outside, `controls outside the pill at ${width}px`).toEqual([]);
      // Narrower, never shorter: height is what a thumb aims with here.
      expect(bar!.shortTargets, `sub-44px targets at ${width}px`).toEqual([]);
    }
  });

  test("the toolbar stands down while a bottom sheet is open", async ({ page }) => {
    await signUp(page, freshUser("mobile-sheettoolbar"));
    await settle(page);
    await openDesigner(page);

    const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
    await expect(toolbar).toBeVisible();

    // Global settings: the sheet takes 55vh off the bottom of the screen, which
    // is the exact strip this bar floats over.
    await page.getByRole("button", { name: "Design settings" }).click();
    const closeSettings = page.getByRole("button", { name: /close design settings/i });
    await expect(closeSettings).toBeVisible();
    await expect(toolbar).toBeHidden();

    await closeSettings.click();
    await expect(toolbar).toBeVisible();

    // Same for a sheet nobody pressed a toolbar button to get: inserting a
    // block selects it, and the selection raises the block's own inspector.
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();
    const closeInspector = page.getByRole("button", { name: /close text block panel/i });
    await expect(closeInspector).toBeVisible();
    await expect(toolbar).toBeHidden();

    // Only when the last sheet is gone does the bar come back.
    await closeInspector.click();
    await expect(toolbar).toBeVisible();
  });

  test("selecting a block opens no colour sheet; the toolbar's button does", async ({
    page,
  }) => {
    await signUp(page, freshUser("mobile-nocolour"));
    await settle(page);
    await openDesigner(page);
    await addSquare(page);
    await canvasStill(page);

    // Touching a block is how you move it, and on a phone that used to cost
    // 55vh of screen to a colour picker nobody asked for. The block's own
    // inspector is what a selection raises now.
    await page.locator("li[data-grid-cell]").first().click();
    await expect(page.getByRole("button", { name: /close shape panel/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close color panel" })).toHaveCount(0);

    // Colour is still one press away, from the bar that floats over the
    // selected tile. This is the route the auto-open was standing in for.
    await page.getByRole("button", { name: /change the colour of/i }).click();
    await expect(page.getByRole("button", { name: "Close color panel" })).toBeVisible();
  });

  test("a press on bare canvas puts the open sheet away", async ({ page }) => {
    await signUp(page, freshUser("mobile-dismiss"));
    await settle(page);
    await openDesigner(page);

    await page.getByRole("button", { name: "Design settings" }).click();
    await expect(
      page.getByRole("button", { name: /close design settings/i }),
    ).toBeVisible();

    // Looking away from a sheet has to be enough to close it. Pressing near the
    // top of the workspace lands on bare canvas, well clear of the board and of
    // the sheet's own 55vh at the bottom.
    const main = (await page.locator("main").boundingBox())!;
    await page.mouse.click(main.x + main.width / 2, main.y + 12);

    await expect(
      page.getByRole("button", { name: /close design settings/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  });

  test("the bar never stands down on a wide screen", async ({ page }) => {
    await signUp(page, freshUser("mobile-widebar"));
    await settle(page);
    await openDesigner(page);

    // Above `lg` the panels are columns, not sheets: they cover nothing, so
    // the same open panels that hide the bar on a phone must leave it alone
    // here. Worth its own assertion because the two states are one flag, and
    // getting the breakpoint wrong takes the whole toolbar off a desktop.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    const toolbar = page.getByRole("toolbar", { name: "Editor tools" });
    await expect(toolbar).toBeVisible();

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(page.getByText("Your text here").first()).toBeVisible();
    // And the colour panel DOES still open on a selection up here, where it is
    // a column beside the board rather than a sheet on top of it.
    await expect(page.getByRole("button", { name: "Close color panel" })).toBeVisible();
    await expect(toolbar).toBeVisible();

    // The same flag also decides whether the inspector draws, and the stack
    // takes the whole panel body when it is open. Both are one answer now
    // (activeMobileSheet), so this checks the desktop column still shows the
    // selected block's editor rather than being hidden by the phone's rule.
    await expect(
      page.getByRole("button", { name: /close text block panel/i }),
    ).toBeVisible();
  });
});
