import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectToast, fillStable, freshUser, gotoApp, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * AI WRITING HELP (lib/suggestions, a Pro perk) as a seller meets it: "Write
 * with AI" under a new product's description once there is a fact to write
 * from, its undo arrow, "Improve with AI" on words already there, on the edit
 * page too, and what a failure says. The stack answers with the stand-in
 * (describeListingForTest), so the text is predictable and nothing leaves the
 * machine; the real model is measured in tests/unit/describe-listing.live.
 * The plan, role and budget gates are in tests/unit/actions/describe-actions.
 */

/** A seller on Pro, the way a paid checkout leaves them. */
async function proSeller(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await serviceRest(`/rpc/billing_apply_snapshot`, {
    method: "POST",
    body: {
      p_owner: sellerId,
      p_customer: `cus_e2e${sellerId.replace(/-/g, "")}`,
      p_subscription: null,
      p_plan: "pro",
      p_interval: "month",
      p_status: "active",
      p_price_cents: 4000,
      p_currency: "EUR",
      p_current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      p_cancel_at_period_end: false,
      p_canceled_at: null,
      p_paid_until: new Date(Date.now() + 31 * 86_400_000).toISOString(),
      p_livemode: false,
      p_synced_at: new Date().toISOString(),
    },
  });
  return sellerId;
}

const aiChip = (page: Page) => page.locator("[data-description-ai]");
const description = (page: Page) => page.locator("[data-product-field='description']");

test.describe("AI writing help", () => {
  test("a Pro seller writes a description, takes it back, improves their own and saves it", async ({ page }) => {
    const sellerId = await proSeller(page, "ai-write");
    await gotoApp(page, "/products/new");
    await fillStable(page, "Title", "Linen shirt");
    await fillStable(page, /price/i, "40");
    // A title alone has nothing a draft could honestly add.
    await expect(aiChip(page)).toHaveCount(0);

    await page.locator("[data-product-starters]").getByRole("button", { name: /^Sizes/ }).click();
    const write = aiChip(page).getByRole("button", { name: "Write with AI" });
    await expect(write).toHaveClass(/suggestion-surface/);
    await expect(write).toHaveAccessibleDescription(/adds nothing of its own/);
    const axe = await new AxeBuilder({ page }).include("[data-fix-field-block='description']").analyze();
    expect(axe.violations).toEqual([]);

    await write.click();
    await expect(description(page)).toHaveValue("A test description of Linen shirt: XS, S, M, L, XL, XXL.");
    await expect(aiChip(page).getByText("Written by AI")).toBeVisible();
    await aiChip(page).getByRole("button", { name: "Undo" }).click();
    await expect(description(page)).toHaveValue("");

    await description(page).fill("Relaxed linen shirt");
    await aiChip(page).getByRole("button", { name: "Improve with AI" }).click();
    await expect(description(page)).toHaveValue("Relaxed linen shirt (improved)");
    await expect(aiChip(page).getByText("Improved by AI")).toBeVisible();

    // What the AI wrote is saved like anything else the seller typed.
    await page.getByRole("button", { name: /save product|save as draft/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });
    const [row] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=title,description`)) as Array<{
      title: string;
      description: string;
    }>;
    expect(row).toEqual({ title: "Linen shirt", description: "Relaxed linen shirt (improved)" });
  });

  test("the edit page improves a stored description, and a failure says why", async ({ page }) => {
    const sellerId = await proSeller(page, "ai-edit");
    await seedProducts(sellerId, [{ title: "Mug [[unavailable]]", description: "nice mug" }]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as Array<{ id: string }>;

    await gotoApp(page, `/products/${product!.id}/edit`);
    await aiChip(page).getByRole("button", { name: "Improve with AI" }).click();
    await expectToast(page, "AI writing help isn't available right now.");
    await expect(description(page)).toHaveValue("nice mug");
    await expect(aiChip(page).getByRole("button", { name: "Improve with AI" })).toBeVisible();
  });

  test("a Free seller is shown what Pro would do there, and nothing that writes", async ({ page }) => {
    const user = freshUser("ai-free");
    await signUp(page, user);
    await gotoApp(page, "/products/new");
    await fillStable(page, "Title", "Linen shirt");
    // Nothing to write from yet: no upsell either.
    await expect(page.locator("[data-description-ai-upsell]")).toHaveCount(0);
    await page.locator("[data-product-starters]").getByRole("button", { name: /^Sizes/ }).click();
    await expect(aiChip(page)).toHaveCount(0);
    const upsell = page.locator("[data-description-ai-upsell]").getByRole("link", { name: /Write with AI/ });
    await expect(upsell).toHaveAttribute("href", /\/plans\?from=ai_writing/);
    await expect(upsell).toHaveAttribute("target", "_blank");
    await expect(upsell).toHaveAccessibleDescription(/Comes with Pro/);
    // No grey words, no "Turn off": the field is a plain field.
    await description(page).click();
    await expect(page.locator("[data-suggest-hint]")).toHaveCount(0);

    await gotoApp(page, "/settings/billing");
    const card = page.locator("#ai");
    await expect(card.getByText("Suggests the next words as you write a description")).toBeVisible();
    await expect(card.getByRole("link", { name: "See Pro" })).toHaveAttribute("href", /from=ai_writing/);
  });
});

const suggestion = (page: Page) => page.locator("[data-next-words]");
const hint = (page: Page) => page.locator("[data-suggest-hint]");
/** The credit's month, as the usage row keys it (UTC). */
const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** A new product with sizes, ready to have its description typed. */
async function shirtWithSizes(page: Page) {
  await gotoApp(page, "/products/new");
  await fillStable(page, "Title", "Linen shirt");
  await page.locator("[data-product-starters]").getByRole("button", { name: /^Sizes/ }).click();
}

test.describe("AI writing help as you type", () => {
  test("grey words follow a pause, Tab adds them, Ctrl+Z takes them back", async ({ page }) => {
    await proSeller(page, "ai-type");
    await shirtWithSizes(page);
    await description(page).click();
    await expect(hint(page)).toHaveText("AI suggests the next words as you type.");
    await description(page).pressSequentially("Comes in sizes ");
    await expect(suggestion(page)).toHaveText("XS, S, M, L, XL, XXL.", { timeout: 15_000 });
    await expect(hint(page)).toHaveAttribute("data-suggest-hint", "offered");
    await expect(description(page)).toHaveAccessibleDescription(/Tab adds the grey text/);
    const axe = await new AxeBuilder({ page }).include("[data-fix-field-block='description']").analyze();
    expect(axe.violations).toEqual([]);

    await page.keyboard.press("Tab");
    await expect(description(page)).toHaveValue("Comes in sizes XS, S, M, L, XL, XXL.");
    await expect(description(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(description(page)).toHaveValue("Comes in sizes ");

    // Typing something else makes them go; Esc hides them.
    await description(page).pressSequentially("and ");
    await expect(suggestion(page)).toHaveText("XS, S, M, L, XL, XXL.", { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(suggestion(page)).toHaveCount(0);
  });

  test("Turn off is one tap from the field, and Settings turns it back on", async ({ page }) => {
    await proSeller(page, "ai-off");
    await shirtWithSizes(page);
    await description(page).click();
    await page.getByRole("button", { name: "Turn off" }).click();
    await expectToast(page, "Suggestions as you type are off.");
    await expect(hint(page)).toHaveCount(0);

    // Saved: a fresh form asks nothing either.
    await shirtWithSizes(page);
    await description(page).click();
    await description(page).pressSequentially("Comes in sizes ");
    await page.waitForTimeout(1_500);
    await expect(suggestion(page)).toHaveCount(0);
    await expect(hint(page)).toHaveCount(0);

    await gotoApp(page, "/settings/billing");
    const toggle = page.getByRole("switch", { name: "Suggest the next words as I type" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.waitForLoadState("networkidle");
    await shirtWithSizes(page);
    await description(page).click();
    await expect(hint(page)).toHaveText("AI suggests the next words as you type.");
  });

  test("Settings shows the month's credit, and a spent credit stops AI until the 1st", async ({ page }) => {
    const sellerId = await proSeller(page, "ai-credit");
    await gotoApp(page, "/settings/billing");
    const card = page.locator("#ai");
    await expect(card.getByText("€0.00 of €10.00 used this month")).toBeVisible();
    await expect(card.getByText(/^Renews /)).toBeVisible();

    await serviceRest("/ai_credit_usage", {
      method: "POST",
      body: { owner_id: sellerId, period: thisMonth(), used_micros: 2_500_000, calls: 40 },
    });
    await gotoApp(page, "/settings/billing");
    await expect(card.getByText("€2.50 of €10.00 used this month")).toBeVisible();

    await serviceRest(`/ai_credit_usage?owner_id=eq.${sellerId}&period=eq.${thisMonth()}`, {
      method: "PATCH",
      body: { used_micros: 10_000_000 },
    });
    await gotoApp(page, "/settings/billing");
    await expect(card.locator("[data-ai-credit='used']")).toBeVisible();
    await expect(card.getByText(/This month's credit is used up/)).toBeVisible();

    await shirtWithSizes(page);
    await aiChip(page).getByRole("button", { name: "Write with AI" }).click();
    await expectToast(page, "This month's AI credit is used up.");
    await expect(description(page)).toHaveValue("");
  });
});
