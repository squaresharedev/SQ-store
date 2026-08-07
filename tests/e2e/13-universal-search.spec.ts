import { expect, test, type Page } from "@playwright/test";
import {
  createProductViaUI,
  freshUser,
  gotoApp,
  seedStorefronts,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * UNIVERSAL SEARCH, end to end (desktop).
 *
 * What no unit test can prove: the palette reaches real rows from the real
 * database, scoped to the signed-in account, and stays usable when the search
 * API is unreachable. The phone half lives in 14-universal-search-mobile.spec,
 * because `test.use(devices[...])` has to be top level in its own file.
 */

/** `signUp` resolves while the /dashboard navigation is still in flight. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * Open the palette with the keyboard.
 *
 * Retried, because the shortcut is registered in an effect: a press that lands
 * before hydration reaches no listener and is simply lost. Same hydration race
 * the sign-up helper handles the same way — a single press would make every
 * spec here flaky on the heavier pages.
 */
async function openWithShortcut(page: Page) {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused({
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
}

function combobox(page: Page) {
  return page.getByRole("combobox", { name: "Search" });
}

test.describe("universal search — desktop", () => {
  let user: ReturnType<typeof freshUser>;

  test.beforeEach(async ({ page }) => {
    user = freshUser("search");
    await signUp(page, user);
    await settle(page);
  });

  test("the top bar carries a search trigger that opens the palette", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    const trigger = page.getByRole("button", { name: /^search/i }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(combobox(page)).toBeFocused();
  });

  test("Cmd+K opens it from anywhere, and again to close", async ({ page }) => {
    for (const path of ["/dashboard", "/products", "/orders", "/settings/tax"]) {
      await gotoApp(page, path);
      await openWithShortcut(page);
      await page.keyboard.press("ControlOrMeta+k");
      await expect(combobox(page)).toBeHidden();
    }
  });

  test("pages and settings are findable with no network round trip", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    // Block the search API outright: the local half must still answer.
    await page.route("**/api/search**", (route) => route.abort());
    await openWithShortcut(page);
    await combobox(page).fill("analytics");
    await expect(
      page.getByRole("option").filter({ hasText: "Analytics" }).first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/analytics/);
  });

  test("a product is findable by title and opens its editor", async ({ page }) => {
    const title = `Lantern ${Date.now()}`;
    await createProductViaUI(page, { title, price: "12.50" });
    await settle(page);

    await openWithShortcut(page);
    await combobox(page).fill("lantern");
    const hit = page.getByRole("option").filter({ hasText: title }).first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/edit/);
  });

  test("arrow keys move the highlight and Enter opens it", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await openWithShortcut(page);
    await combobox(page).fill("settings");

    const first = await combobox(page).getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    const second = await combobox(page).getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    // The highlighted row is the selected one, and there is exactly one.
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings/);
  });

  test("a settings field deep-links to the control, not the top of the page", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    await openWithShortcut(page);
    await combobox(page).fill("handle");
    await page
      .getByRole("option")
      .filter({ hasText: "Username" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/settings\/account#username/);
    // The anchor resolves to exactly ONE element — the handle input itself. A
    // second element sharing the id would break that field's <label for>.
    await expect(page.locator("#username")).toHaveCount(1);
    await expect(page.locator("input#username")).toBeVisible();
  });

  test("Escape clears, then closes, and focus goes back to the trigger", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    const trigger = page.getByRole("button", { name: /^search/i }).first();
    await trigger.click();
    await combobox(page).fill("lantern");

    await page.keyboard.press("Escape");
    await expect(combobox(page)).toHaveValue("");
    await expect(combobox(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(combobox(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("clicking outside closes it", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await openWithShortcut(page);
    // The scrim covers the whole viewport behind the panel.
    await page.mouse.click(5, 5);
    await expect(combobox(page)).toBeHidden();
  });

  test("a dead end says so instead of going blank", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await openWithShortcut(page);
    await combobox(page).fill("zzzzqqqqnothing");
    await expect(page.getByText(/Nothing matches/i)).toBeVisible();
  });

  test("it survives a failing search API", async ({ page }) => {
    await gotoApp(page, "/dashboard");
    await page.route("**/api/search**", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await openWithShortcut(page);
    // A term the LOCAL index knows, which is the whole point: the remote half
    // is dead, and the palette is still answering.
    await combobox(page).fill("orders");
    await expect(page.getByText(/Can't reach the server/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("option").filter({ hasText: "Orders" }).first(),
    ).toBeVisible();
  });

  test("the panel opens anchored under the trigger, not floating mid-screen", async ({
    page,
  }) => {
    await gotoApp(page, "/dashboard");
    const trigger = page.getByRole("button", { name: /^search/i }).first();
    const triggerBox = (await trigger.boundingBox())!;
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    const panelBox = (await dialog.boundingBox())!;

    // The panel's top row overlays the trigger — the bar expands in place.
    expect(Math.abs(panelBox.y - triggerBox.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(4);
    // And it is emphatically NOT the old centered layout at 10vh.
    const viewport = page.viewportSize()!;
    expect(panelBox.y).toBeLessThan(viewport.height * 0.1 - 10);
  });

  test("a storefront is findable WITHOUT ever visiting the storefront tab, even with live search dead", async ({
    page,
  }) => {
    // The reported complaint, verbatim: content search must not depend on
    // having loaded that section this session. The snapshot answers it.
    const name = `Beacon shop ${Date.now()}`;
    await seedStorefronts(await userIdByEmail(user.email), [{ name }]);

    // A fresh page load; wait for the snapshot warm-up fetch to complete
    // rather than sleeping (deterministic under slow CI).
    const warmed = page.waitForResponse("**/api/search/snapshot", {
      timeout: 30_000,
    });
    await gotoApp(page, "/dashboard");
    await warmed;

    // Now kill the LIVE endpoint. Only the snapshot can answer.
    await page.route("**/api/search?*", (route) => route.abort());

    await openWithShortcut(page);
    await combobox(page).fill("beacon");
    await expect(
      page.getByRole("option").filter({ hasText: name }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("a 1-character query answers from the snapshot with no network call", async ({
    page,
  }) => {
    const name = `Xylophone shop ${Date.now()}`;
    await seedStorefronts(await userIdByEmail(user.email), [{ name }]);

    const warmed = page.waitForResponse("**/api/search/snapshot", {
      timeout: 30_000,
    });
    await gotoApp(page, "/dashboard");
    await warmed;

    let liveCalls = 0;
    await page.route("**/api/search?*", (route) => {
      liveCalls++;
      return route.abort();
    });

    await openWithShortcut(page);
    await combobox(page).fill("x"); // below the remote threshold
    await expect(
      page.getByRole("option").filter({ hasText: name }).first(),
    ).toBeVisible({ timeout: 3_000 });
    expect(liveCalls).toBe(0);
  });

  test("it works inside the full-screen storefront designer", async ({ page }) => {
    // The designer renders outside the dashboard shell, so it mounts its own
    // provider — this is the regression guard for that.
    await gotoApp(page, "/storefront");
    await page
      .getByRole("button", { name: /new storefront|create storefront/i })
      .first()
      .click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await settle(page);

    // The editor has no dashboard chrome, so it carries its own trigger.
    const trigger = page.getByRole("button", { name: "Search" }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await combobox(page).fill("orders");
    await expect(page.getByRole("option").first()).toBeVisible();

    // ...and the shortcut reaches it here too, which is the part that would
    // silently break if the provider stopped being mounted on this route.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(combobox(page)).toBeHidden();
    await openWithShortcut(page);
  });
});
