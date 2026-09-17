import { expect, test } from "@playwright/test";
import {
  createStorefrontViaUI,
  expectToast,
  expectTourStep,
  fillStable,
  freshUser,
  gotoApp,
  openSellerStep,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  TOUR_LAYER,
  tourButton,
  userIdByEmail,
  verificationLink,
  WELCOME_DIALOG,
} from "./helpers";

/**
 * ONBOARDING, end to end: the welcome flow a new seller meets on their first
 * Overview, the guided tour it hands over to, and the "Get set up" checklist
 * that stays with them afterwards.
 *
 * What matters here is the round trip through real data. The seller step saves
 * through the same action as Settings, and that action now writes only the
 * fields it is sent, so the partial save is proven against a column the step
 * never shows. The checklist is derived, never stored, so "done" is asserted
 * after the real change (a clicked confirmation link, a placed product) rather
 * than after anything the flow itself wrote. And "seen once" (the welcome, and
 * the finished card) is asserted by coming back. The tour's own walk through
 * every page is 63-guided-tour.
 */

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 0,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

type ProfileRow = {
  tax_business_name: string | null;
  seller_phone: string | null;
  onboarding_completed_at: string | null;
  setup_celebrated_at: string | null;
};

async function profile(sellerId: string): Promise<ProfileRow> {
  const rows = (await serviceRest(
    `/profiles?id=eq.${sellerId}&select=tax_business_name,seller_phone,onboarding_completed_at,setup_celebrated_at`,
  )) as ProfileRow[];
  return rows[0]!;
}

test.describe("onboarding", () => {
  test("a new seller is welcomed, adds their seller details and is handed to the tour", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = freshUser("welcome");
    await signUp(page, user, { welcome: "keep" });
    const sellerId = await userIdByEmail(user.email);
    // A phone number the flow never shows, so the partial save is provable.
    await seedSellerIdentity(sellerId, { phone: "+353 1 234 5678" });

    const dialog = page.getByRole("dialog");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toBeVisible({
      timeout: 20_000,
    });
    // The red strip is not what a new seller meets first any more.
    await expect(
      page.getByRole("note", { name: /seller details required/i }),
    ).toHaveCount(0);

    await openSellerStep(page);

    await dialog.getByLabel("Trader name").fill("Welcome Studio Ltd");
    await dialog.getByLabel("Business address").fill("12 Market Street\nDublin\nIreland");
    // squareshare.eu, because the save asks a resolver whether the domain takes
    // mail. (PUBLISHABLE_SELLER's .example address can be seeded, not typed.)
    const contact = "hello@squareshare.eu";
    await dialog.getByLabel("Contact email").fill(contact);
    await dialog.getByRole("button", { name: "Save and continue" }).click();

    // Confirmation is switched on in the stack, so a link is now on its way,
    // and the flow says where rather than moving on as if it were finished.
    await expectToast(page, /Check hello@squareshare\.eu for a link to confirm/i);
    await expect(dialog).toContainText(`Check ${contact} for a confirmation link.`);
    await dialog.getByRole("button", { name: "Continue" }).click();

    // Forward out of the welcome is into the guided tour, starting on this page.
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toHaveCount(0);
    await expectTourStep(page, "overview-nav");
    await expect(page).toHaveURL(/\/dashboard$/);
    await tourButton(page, "Skip tour");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    // The save wrote the three fields it was sent, and nothing it was not.
    const saved = await profile(sellerId);
    expect(saved.tax_business_name).toBe("Welcome Studio Ltd");
    expect(saved.seller_phone).toBe("+353 1 234 5678");
    expect(saved.onboarding_completed_at).not.toBeNull();

    // Seen once, never again; the checklist carries on without it.
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toHaveCount(0);
    const sellerStep = page.locator('[data-setup-step="seller-details"]');
    await expect(sellerStep).toHaveAttribute("data-setup-state", "todo");
    await expect(sellerStep).toContainText(/confirm/i);

    // Clicking the real link is what completes the step.
    await page.goto(await verificationLink(contact));
    await page.waitForURL(/\/settings\/tax/, { timeout: 30_000 });
    await gotoApp(page, "/dashboard");
    await expect(
      page.locator('[data-setup-step="seller-details"]'),
    ).toHaveAttribute("data-setup-state", "done");
  });

  test("closing the welcome flow at its first step counts as seen", async ({ page }) => {
    const user = freshUser("welcome-close");
    await signUp(page, user, { welcome: "keep" });
    const sellerId = await userIdByEmail(user.email);

    const welcome = page.getByRole("dialog", { name: WELCOME_DIALOG });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(welcome).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    // Closing is skipping: no tour follows.
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    // The write leaves as the dialog closes; wait for it before coming back.
    await expect
      .poll(async () => (await profile(sellerId)).onboarding_completed_at, {
        timeout: 15_000,
      })
      .not.toBeNull();
    await gotoApp(page, "/dashboard");
    await expect(page.locator("[data-setup-checklist]")).toBeVisible();
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toHaveCount(0);
  });

  test("Skip onboarding skips the welcome, the details and the tour, for good", async ({
    page,
  }) => {
    const user = freshUser("welcome-skip");
    await signUp(page, user, { welcome: "keep" });
    const sellerId = await userIdByEmail(user.email);

    const welcome = page.getByRole("dialog", { name: WELCOME_DIALOG });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    // Retried: a click that lands before hydration does nothing.
    await expect(async () => {
      await welcome.getByRole("button", { name: "Skip onboarding" }).click();
      await expect(welcome).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    await expect
      .poll(async () => (await profile(sellerId)).onboarding_completed_at, {
        timeout: 15_000,
      })
      .not.toBeNull();
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toHaveCount(0);
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
    // Skipping the guidance is not skipping the legal gate: the checklist stays.
    await expect(page.locator('[data-setup-step="seller-details"]')).toHaveAttribute(
      "data-setup-state",
      "todo",
    );
  });

  test("a finished setup hands over the live product page link, once", async ({ page }) => {
    const user = freshUser("welcome-done");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
    await seedProducts(sellerId, [
      { title: "Oak lamp", price_cents: 12900, purchase_url: "https://example.com/lamp" },
    ]);
    await seedStorefronts(sellerId, [{ name: "Done studio" }]);
    const [storefront] = (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    const [product] = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    await serviceRest(`/storefronts?id=eq.${storefront!.id}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: product!.id, x: 0, y: 0, w: 2, h: 2 }],
        },
      },
    });

    await gotoApp(page, "/dashboard");
    const card = page.locator("[data-setup-checklist]");
    await expect(card).toHaveAttribute("data-setup-complete", "true");
    await expect(card).toContainText("You're set up");

    // The link it offers is a page a buyer can actually open.
    const path = await card.getAttribute("data-setup-live-path");
    expect(path).toBe(`/s/${storefront!.id}/p/${product!.id}`);
    expect((await page.request.get(path!)).status()).toBe(200);

    // Shown once, recorded as soon as it rendered, with nothing clicked.
    await expect
      .poll(async () => (await profile(sellerId)).setup_celebrated_at, { timeout: 15_000 })
      .not.toBeNull();

    // Gone next visit, and not because of anything this browser remembers: with
    // its storage wiped it still does not come back. A person, not a device.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Recent orders" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("[data-setup-checklist]")).toHaveCount(0);
  });

  test("the guided tour replays from Settings, and search's link starts it too", async ({
    page,
  }) => {
    await signUp(page, freshUser("welcome-tour"));

    // Settings > Account is where the replay lives; the tour then takes over.
    await gotoApp(page, "/settings/account");
    const card = page.locator("#tour");
    await expect(card).toContainText("Guided tour");
    await card.getByRole("button", { name: "Start the tour" }).click();
    await expectTourStep(page, "overview-nav");
    await expect(page).toHaveURL(/\/dashboard$/);
    // A replay is the tour alone: no welcome, no form to fill in again.
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);

    // Search's "Show me around" links here. The query is dropped, so a refresh
    // does not start it over.
    await gotoApp(page, "/dashboard?tour=1");
    await expectTourStep(page, "overview-nav");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
  });

  test("adding a first product from an empty designer comes straight back to it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signUp(page, freshUser("welcome-designer"));
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
    const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.getByRole("button", { name: /^add product$/i }).first().click();
    await page.getByRole("button", { name: "Add your first product" }).click();
    await page.waitForURL(/\/products\/new\?next=/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});

    await fillStable(page, "Title", "Walnut stool");
    await fillStable(page, /price/i, "85.00");
    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(new RegExp(`/storefront/${storefrontId}$`), {
      timeout: 30_000,
    });
  });
});
