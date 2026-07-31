import { expect, test, type Page } from "@playwright/test";
import { fillStable, freshUser, gotoApp, signUp } from "./helpers";

/** Open the profile menu and switch to a teammate's store; verified via the
 *  ViewingBanner ("Back to your store"), which only renders on foreign stores. */
async function switchToStore(page: Page, storeName: RegExp) {
  await expect(async () => {
    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("button", { name: /switch accounts/i }).click();
    await page.getByRole("button", { name: storeName }).first().click({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: /back to your store/i }),
    ).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 60_000 });
}

/** Accept the first pending invite (the prompt modal auto-opens on /settings/team). */
async function acceptFirstInvite(page: Page) {
  await gotoApp(page, "/settings/team");
  const accept = page.getByRole("button", { name: /^accept$/i }).first();
  await expect(accept).toBeVisible({ timeout: 20_000 });
  await accept.click();
  // Success shows either as the "Accepted" label or the row revalidating away.
  await expect(async () => {
    const pending = await page.getByRole("button", { name: /^accept$/i }).count();
    const accepted = await page.getByRole("button", { name: /^accepted$/i }).count();
    if (pending > 0 && accepted === 0) throw new Error("invite still pending");
  }).toPass({ timeout: 20_000 });
  // The prompt modal closes itself shortly after; dismiss if still open.
  const close = page.getByRole("button", { name: /^close$/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
  }
}

async function inviteByEmail(ownerPage: Page, email: string, role?: "editor" | "viewer") {
  await gotoApp(ownerPage, "/settings/team");
  await ownerPage.getByRole("button", { name: /invite member/i }).click();
  await ownerPage.getByLabel(/email address/i).fill(email);
  if (role) {
    // Custom combobox (role=combobox button + listbox options).
    await ownerPage.getByRole("combobox").click();
    await ownerPage
      .getByRole("option", { name: new RegExp(`^${role}`, "i") })
      .click();
  }
  await ownerPage.getByRole("button", { name: /send invite/i }).click();
  await expect(ownerPage.getByText(email).first()).toBeVisible({ timeout: 15_000 });
  // Close the invite modal so it doesn't trap focus for later steps.
  const close = ownerPage.getByRole("button", { name: /^close$/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
  }
}

test.describe("team & access + notifications", () => {
  test("invite → accept → member sees store → owner notified in the bell", async ({
    browser,
  }) => {
    const owner = freshUser("team-owner");
    const member = freshUser("team-member");
    const storeName = `OwnerStore${Date.now() % 100000}`;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signUp(ownerPage, owner);

    // Name the store (display name doubles as store name in the switcher).
    await gotoApp(ownerPage, "/settings/account");
    await fillStable(ownerPage, /^name$/i, storeName);
    await ownerPage.getByRole("button", { name: /^save$/i }).first().click();
    await expect(ownerPage.getByText(/saved|updated/i).first()).toBeVisible({ timeout: 10_000 });

    // Owner creates a product the member should later see.
    await gotoApp(ownerPage, "/products/new");
    await fillStable(ownerPage, "Title", "Team-visible product");
    await fillStable(ownerPage, /price/i, "12.00");
    await ownerPage.getByRole("button", { name: /save product/i }).click();
    await ownerPage.waitForURL(/\/products$/);

    // Member signs up (invite will target an existing account).
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signUp(memberPage, member);

    await inviteByEmail(ownerPage, member.email, "editor");
    await acceptFirstInvite(memberPage);

    // Member switches to the owner's store and sees its products.
    await switchToStore(memberPage, new RegExp(storeName, "i"));
    await gotoApp(memberPage, "/products");
    await expect(memberPage.getByText("Team-visible product")).toBeVisible({
      timeout: 20_000,
    });

    // Editor CAN add products on the owner's store.
    await expect(
      memberPage.getByRole("link", { name: /add product/i }).first(),
    ).toBeVisible();

    // Owner's bell shows the acceptance notification.
    await gotoApp(ownerPage, "/dashboard");
    const bell = ownerPage.getByRole("button", { name: /notifications/i }).first();
    await expect(bell).toHaveAccessibleName(/unread/i, { timeout: 20_000 });
    await bell.click();
    await expect(
      ownerPage.getByText(/joined|accepted/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await ownerCtx.close();
    await memberCtx.close();
  });

  test("a viewer invite yields read-only access (no add-product CTA)", async ({
    browser,
  }) => {
    const owner = freshUser("view-owner");
    const viewer = freshUser("view-member");
    const storeName = `ViewStore${Date.now() % 100000}`;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signUp(ownerPage, owner);
    await gotoApp(ownerPage, "/settings/account");
    await fillStable(ownerPage, /^name$/i, storeName);
    await ownerPage.getByRole("button", { name: /^save$/i }).first().click();
    await expect(ownerPage.getByText(/saved|updated/i).first()).toBeVisible({ timeout: 10_000 });

    const viewerCtx = await browser.newContext();
    const viewerPage = await viewerCtx.newPage();
    await signUp(viewerPage, viewer);

    await inviteByEmail(ownerPage, viewer.email, "viewer");
    await acceptFirstInvite(viewerPage);

    await switchToStore(viewerPage, new RegExp(storeName, "i"));

    // The banner marks it read-only and /products offers no Add CTA.
    await expect(viewerPage.getByText(/read-only/i).first()).toBeVisible({ timeout: 10_000 });
    await gotoApp(viewerPage, "/products");
    await expect(
      viewerPage.getByRole("link", { name: /add product/i }),
    ).toHaveCount(0, { timeout: 20_000 });

    await ownerCtx.close();
    await viewerCtx.close();
  });
});
