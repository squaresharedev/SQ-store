import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  createProductViaUI,
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  signUp,
} from "./helpers";

/**
 * The shared "?" info tip, exercised where it first ships: the product tile's
 * inspector in the storefront designer.
 *
 * Three things are being proven, and the third is the one a jsdom test cannot
 * reach: a REAL touch pointer must not be read as a hover. Chromium fires
 * pointerover before the tap, so a component that opens on any pointerover
 * would open and then be closed by its own tap — the tip would flicker and
 * never stay. Hence `hasTouch` and `page.tap()` here.
 *
 * ONE account and ONE page for the file: sign-ups are rate limited per client,
 * so a signup per test starts failing partway down.
 */

test.use({ hasTouch: true });
test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const tip = (name: string) => page.getByRole("button", { name });
const bubble = () => page.getByRole("tooltip");

test.beforeAll(async ({ browser }) => {
  // An explicit context, not browser.newPage(): AxeBuilder refuses to run
  // against a page created straight off the browser.
  context = await browser.newContext({ hasTouch: true });
  page = await context.newPage();
  await signUp(page, freshUser("info-tip"));
  await page.waitForLoadState("networkidle").catch(() => {});

  await createProductViaUI(page, { title: "Tip piece", price: "12.00" });

  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();

  // Place the product, then select its tile: adding leaves the picker open,
  // and it is the TILE's inspector that carries the tips.
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page
    .getByRole("button", { name: /add tip piece|tip piece/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Edit Tip piece" }).click();
  await expect(tip("Where a name or price change lands")).toBeVisible();
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("info tip", () => {
  test("the hint paragraphs are gone from the panel", async () => {
    for (const gone of [
      /Name and price belong to the product/i,
      /Style this tile on its own/i,
      /The price stays hidden until a buyer hovers/i,
    ]) {
      await expect(page.getByText(gone)).toHaveCount(0);
    }
  });

  test("every hint that survived is behind a ? button", async () => {
    await expect(tip("Where a name or price change lands")).toBeVisible();
    await expect(tip("How this tile's style relates to the theme")).toBeVisible();
    await expect(bubble()).toHaveCount(0);
  });

  test("hovering reveals the copy and leaving hides it", async () => {
    await tip("Where a name or price change lands").hover();
    await expect(bubble()).toContainText(
      "Name and price belong to the product",
    );

    // Park the pointer somewhere inert.
    await page.mouse.move(0, 0);
    await expect(bubble()).toHaveCount(0);
  });

  test("the bubble is placed against its trigger, inside the viewport", async () => {
    const trigger = tip("How this tile's style relates to the theme");
    await trigger.hover();
    await expect(bubble()).toBeVisible();

    const anchor = (await trigger.boundingBox())!;
    const box = (await bubble().boundingBox())!;
    const viewport = page.viewportSize()!;

    // Not clipped by the designer's scrolling side panel, and not off-screen.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    // Sits against the trigger rather than floating off somewhere.
    expect(Math.abs(box.y - (anchor.y + anchor.height))).toBeLessThan(24);

    await page.mouse.move(0, 0);
    await expect(bubble()).toHaveCount(0);
  });

  test("keyboard focus reveals it and Escape closes it", async () => {
    await tip("Where a name or price change lands").focus();
    await expect(bubble()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(bubble()).toHaveCount(0);
  });

  test("a tap reveals it, and it stays up with no pointer on it", async () => {
    await tip("How this tile's style relates to the theme").tap();
    await expect(bubble()).toContainText("keeps following the theme");

    // No hover to hold it open on touch: it must survive on its own.
    await page.waitForTimeout(300);
    await expect(bubble()).toBeVisible();
  });

  test("a tap elsewhere closes it", async () => {
    await expect(bubble()).toBeVisible();
    await page.getByRole("toolbar", { name: "Editor tools" }).tap();
    await expect(bubble()).toHaveCount(0);
  });

  test("the tip describes its trigger for screen readers", async () => {
    const trigger = tip("Where a name or price change lands");
    await trigger.hover();
    const described = await trigger.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    await expect(page.locator(`#${described}`)).toHaveRole("tooltip");
    await page.mouse.move(0, 0);
  });

  test("no serious axe violations with a tip open", async () => {
    await tip("Where a name or price change lands").hover();
    await expect(bubble()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .exclude("nextjs-portal")
      // The canvas is out of scope here and carries a pre-existing
      // nested-interactive of its own: a SELECTED tile is a div[role=button]
      // wrapping its own remove button. Unrelated to the tip, and scanning it
      // would only make this spec fail for someone else's reason.
      .exclude('[aria-label="Storefront canvas"]')
      .analyze();
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(
      serious.map(
        (violation) =>
          `${violation.id} @ ${violation.nodes
            .map((node) => node.target.join(" "))
            .join(" | ")}`,
      ),
    ).toEqual([]);

    await page.mouse.move(0, 0);
  });
});
