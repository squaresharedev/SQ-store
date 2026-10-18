import { expect, test } from "@playwright/test";
import { devEmails, expectToast, freshUser, gotoApp, signUp } from "./helpers";

/**
 * DEAD ENDS, closed. Each test here is a place where the app used to leave
 * someone with the wrong page or no word at all:
 *
 *   - a buyer on an address under /s/ that is not a page was shown the SELLER
 *     dashboard's 404, with "Back to dashboard" and a line about their account;
 *   - the sign-in page told a newcomer to "Request access" on another domain,
 *     with open sign-up sitting on the tab beside it;
 *   - a seller whose session had ended elsewhere was shown empty lists, as if
 *     their store had no orders, rather than the sign-in page;
 *   - a team invite was a row nobody was told about, behind a success message.
 *
 * Runs in the default stack. The two things it cannot reach from a browser (a
 * failed database read, a spent rate limit) are pinned at the loader instead:
 * tests/unit/product-page-public.test.ts.
 */

/** A well-formed id that belongs to nothing. */
const NOBODY = "00000000-0000-4000-8000-000000000000";

test.describe("buyer pages speak to buyers", () => {
  test("an address under /s/ that is no page gets the buyer's own 404", async ({ page }) => {
    const response = await page.goto(`/s/${NOBODY}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page isn't available" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
    // Nothing on a buyer's page may talk about a dashboard or an account.
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);
    await expect(page.getByText(/your account/i)).toHaveCount(0);
  });

  test("find-your-order on a shop that does not exist gets it too", async ({ page }) => {
    await page.goto(`/s/${NOBODY}/orders`);
    await expect(page.getByRole("heading", { name: "This page isn't available" })).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);
  });

  test("an unknown product keeps its own, more specific, 404", async ({ page }) => {
    const response = await page.goto(`/s/${NOBODY}/p/${NOBODY}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This product isn't available" })).toBeVisible();
  });
});

test.describe("the way in", () => {
  test("'No account yet?' opens sign-up on this page, not a waitlist elsewhere", async ({ page }) => {
    await gotoApp(page, "/login");
    await expect(page.locator('input[name="confirm_password"]')).toHaveCount(0);

    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/login\?mode=signup$/);
    // The sign-up tab's own fields: the form opened on the right tab.
    await expect(page.locator('input[name="confirm_password"]')).toBeVisible();
    // Already there, so the note that offers it stands down.
    await expect(page.getByRole("link", { name: "Create one" })).toHaveCount(0);
  });
});

test.describe("a session that ended elsewhere", () => {
  test("moving between sections lands on sign-in, not on an empty list", async ({ page, context }) => {
    await signUp(page, freshUser("deadsess"));
    await gotoApp(page, "/dashboard");

    // What a password change on another device does to this tab: the session
    // is gone, and nothing on this page knows yet.
    await context.clearCookies();
    await page.getByRole("link", { name: "Orders", exact: true }).first().click();

    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.locator('button[name="intent"]')).toBeVisible();
  });
});

test.describe("a team invite", () => {
  test("is emailed to the person invited, and the inviter is told it was", async ({ page }) => {
    const owner = freshUser("inviter");
    await signUp(page, owner);
    const invitee = `invitee-${Date.now()}@e2e.squareshare.to`;

    await gotoApp(page, "/settings/team");
    await page.getByRole("button", { name: /invite member/i }).click();
    await page.getByLabel(/email address/i).fill(invitee);
    await page.getByRole("button", { name: /send invite/i }).click();
    await expectToast(page, /Invite sent\. We've emailed them how to accept\./);

    await expect(async () => {
      const [mail] = await devEmails(invitee);
      expect(mail, "no invite email in the outbox").toBeTruthy();
      expect(mail.subject).toBe(`${owner.username} invited you to their team on Square Share`);
      expect(mail.text).toContain("Your role:");
      // How to accept names the address to sign in with, and the link goes
      // through sign-in on to the Team page.
      expect(mail.text).toContain(invitee);
      expect(mail.text).toContain("/login?next=%2Fsettings%2Fteam");
    }).toPass({ timeout: 15_000 });
  });
});
