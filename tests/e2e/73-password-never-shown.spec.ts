import { expect, test } from "@playwright/test";
import { expectToast, freshUser, gotoApp, signIn, signUp } from "./helpers";
import { recoveryLinkFor } from "./two-factor";

/**
 * Settings never shows the account's current password, and never even holds
 * it on the way to a new one.
 *
 * The password card used to open a "change" form whose first field was the
 * current password: a browser fills that on open, and its show/hide toggle
 * then displayed it to whoever was at the screen. Now the card only emails a
 * link to the account's own address, and the new password is set on
 * /reset-password. The re-authentication fields that remain elsewhere in
 * Settings (changing the email) are masked with no toggle at all.
 */

test.describe("the password in Settings", () => {
  test("is only ever reset by emailed link, and the reset works", async ({ page, context }) => {
    test.setTimeout(120_000);
    const user = freshUser("pw-reset-only");
    await signUp(page, user);

    await gotoApp(page, "/settings/account");
    const card = page.locator("#password");
    await expect(card).toContainText("never shown");
    await card.getByRole("button", { name: "Reset password" }).click();

    const dialog = page.getByRole("dialog", { name: "Reset your password" });
    await expect(dialog).toBeVisible();
    // Nothing in it that could hold a password, filled or typed.
    await expect(dialog.locator("input")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /show password/i })).toHaveCount(0);
    await expect(dialog).toContainText(user.email);

    await dialog.getByRole("button", { name: "Email me a link" }).click();
    await expectToast(page, /reset link sent/i);

    // The link lands on the reset form, which sets the new one.
    await page.goto(await recoveryLinkFor(user.email));
    await page.waitForURL(/\/reset-password/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.locator('input[name="password"]').fill("Kettle-Boat-Lamp-42");
    await page.locator('input[name="confirm_password"]').fill("Kettle-Boat-Lamp-42");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // The new password is the one that signs in.
    await context.clearCookies();
    await signIn(page, { ...user, password: "Kettle-Boat-Lamp-42" });
  });

  test("the email change's password field is masked with no way to reveal it", async ({ page }) => {
    await signUp(page, freshUser("pw-masked"));
    await gotoApp(page, "/settings/account");

    const email = page.locator("#email");
    const field = email.getByLabel("Current password");
    await expect(field).toHaveAttribute("type", "password");
    await expect(email.getByRole("button", { name: /show password/i })).toHaveCount(0);
  });
});
