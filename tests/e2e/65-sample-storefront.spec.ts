import { expect, test } from "@playwright/test";
import {
  expectSpotlightOn,
  expectTourStep,
  freshUser,
  gotoApp,
  serviceRest,
  signUp,
  TOUR_LAYER,
  tourButton,
  userIdByEmail,
} from "./helpers";

/**
 * THE SAMPLE STOREFRONT, end to end: the card a new seller finds on the
 * storefront list, the designer it opens in (where nothing saves), and the short
 * designer tour that runs the first time they open it.
 *
 * The promises worth guarding: the sample is never a storefront row (so nothing
 * that counts storefronts can see it), trying things in it writes nothing and
 * never asks about unsaved changes, the tour starts once per person, and hiding
 * the sample sticks until they bring it back.
 */

async function profileFlags(email: string) {
  const id = await userIdByEmail(email);
  const rows = (await serviceRest(
    `/profiles?id=eq.${id}&select=sample_storefront_hidden_at,editor_tour_seen_at`,
  )) as { sample_storefront_hidden_at: string | null; editor_tour_seen_at: string | null }[];
  return rows[0];
}

async function storefrontRows(email: string) {
  const id = await userIdByEmail(email);
  return (await serviceRest(`/storefronts?owner_id=eq.${id}&select=id`)) as unknown[];
}

test.describe("sample storefront", () => {
  test("a new seller opens the sample, gets the designer tour once, and nothing is saved", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = freshUser("sample-tour");
    await signUp(page, user);

    await gotoApp(page, "/storefront");
    const sample = page.locator("main [data-storefront-sample]");
    await expect(sample).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("No storefronts yet")).toBeVisible();
    await expect(page.getByRole("button", { name: /create your first storefront/i })).toBeVisible();

    await sample.getByRole("link", { name: "Open the sample storefront" }).click();
    await page.waitForURL(/\/storefront\/sample$/, { timeout: 60_000 });

    // The tour starts by itself, and says so on the profile straight away.
    const stops = [
      { id: "editor-add", target: '[role="toolbar"][aria-label="Editor tools"]' },
      { id: "editor-design", target: "[data-design-panel] [data-panel-menu]" },
      {
        id: "editor-page",
        target: '[role="toolbar"][aria-label="Editor tools"] button[aria-label="Show the product page"]',
      },
      { id: "editor-finish", target: "[data-sample-create]" },
    ];
    for (const [index, stop] of stops.entries()) {
      await expectTourStep(page, stop.id);
      const layer = page.locator(TOUR_LAYER);
      await expect(layer).toHaveAttribute("data-tour-index", String(index + 1));
      await expect(layer).toHaveAttribute("data-tour-total", "4");
      await expectSpotlightOn(page, page.locator(stop.target));
      if (index === 0) {
        await expect
          .poll(async () => (await profileFlags(user.email)).editor_tour_seen_at, { timeout: 15_000 })
          .not.toBeNull();
      }
      await tourButton(page, index < stops.length - 1 ? "Next" : "Done");
    }
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    // Try something: it lands on the board and goes nowhere.
    await page.getByRole("button", { name: "Add text" }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

    // Leaving asks nothing, because there is nothing to save.
    await page.getByRole("link", { name: "Back to storefronts" }).click();
    await page.waitForURL(/\/storefront$/, { timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Save your changes?" })).toHaveCount(0);
    expect(await storefrontRows(user.email)).toHaveLength(0);

    // Second visit: no tour by itself, but the sample's own button replays it.
    await gotoApp(page, "/storefront/sample");
    await expect(page.locator("[data-sample-notice]")).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
    await page.getByRole("button", { name: "Take the tour" }).click();
    await expectTourStep(page, "editor-add");
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });

  test("hiding the sample sticks until it is brought back", async ({ page }) => {
    test.setTimeout(150_000);
    const user = freshUser("sample-hide");
    await signUp(page, user);
    await gotoApp(page, "/storefront");

    const sample = page.locator("main [data-storefront-sample]");
    await expect(sample).toBeVisible({ timeout: 30_000 });
    await sample.getByRole("button", { name: "Hide the sample storefront" }).click();
    await expect(sample).toHaveCount(0);
    await expect
      .poll(async () => (await profileFlags(user.email)).sample_storefront_hidden_at, { timeout: 15_000 })
      .not.toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { name: "No storefronts yet" })).toBeVisible({ timeout: 30_000 });
    await expect(sample).toHaveCount(0);

    await page.getByRole("button", { name: "Show the sample storefront" }).click();
    await expect(sample).toBeVisible();
    await expect
      .poll(async () => (await profileFlags(user.email)).sample_storefront_hidden_at, { timeout: 15_000 })
      .toBeNull();
    await page.reload();
    await expect(sample).toBeVisible({ timeout: 30_000 });
  });

  test("Create your own opens the setup flow over the sample, and lands in a real storefront", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const user = freshUser("sample-create");
    await signUp(page, user);
    // Past the designer tour already, so the header is not under it.
    await serviceRest(`/profiles?id=eq.${await userIdByEmail(user.email)}`, {
      method: "PATCH",
      body: { editor_tour_seen_at: new Date().toISOString() },
    });

    await gotoApp(page, "/storefront/sample");
    const create = page.locator("[data-sample-create]");
    await expect(create).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
    // Retried: a click that lands before hydration does nothing.
    const flow = page.getByRole("dialog");
    await expect(async () => {
      await create.click();
      await expect(flow).toContainText("Step 1 of 4", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/storefront\/sample$/);
    // Opening it creates nothing; finishing it does.
    expect(await storefrontRows(user.email)).toHaveLength(0);

    await flow.getByRole("button", { name: /skip setup/i }).click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    expect(await storefrontRows(user.email)).toHaveLength(1);
    // A real storefront saves, so Save is back and the sample notice is gone.
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(page.locator("[data-sample-notice]")).toHaveCount(0);
  });
});
