import { expect, test } from "@playwright/test";
import { clearAuthRateLimits, devEmails, freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import {
  accessToken,
  claimsOf,
  enableTwoFactor,
  enterChallengeCode,
  nextCode,
  recoveryLinkFor,
  signInToChallenge,
} from "./two-factor";

/**
 * The ways back in, and the ways NOT back in: a recovery code works once and
 * turns 2FA off (so it can be set up on a new phone), while a password-reset
 * link, which only proves control of the inbox, still has to pass the second
 * factor before it may set a new password.
 */

// Generous: the first visit to each 2FA route compiles it in next dev.
test.describe.configure({ timeout: 180_000 });

test.describe("two-factor recovery", () => {
  test("a recovery code signs in once, turns 2FA off, signs out other devices, and lands on setup", async ({
    browser,
  }) => {
    const user = freshUser("recover");
    const mine = await browser.newContext();
    const page = await mine.newPage();
    await signUp(page, user);
    const { recoveryCodes } = await enableTwoFactor(page, user.password);

    // Still signed in on the laptop the phone was lost next to.
    const laptop = await browser.newContext();
    const other = await laptop.newPage();
    await clearAuthRateLimits();
    await other.goto("/login");
    await other.locator('input[name="identifier"]').fill(user.email);
    await other.locator('input[name="password"]').fill(user.password);
    await other.locator('button[name="intent"]').click();
    await other.waitForURL(/\/login\/two-factor/);

    // Phone gone: sign in with a recovery code instead.
    await mine.clearCookies();
    await signInToChallenge(page, user);
    await page.getByRole("button", { name: "Use a recovery code instead" }).click();
    // Typed the way people type things: capitals, spaces instead of dashes.
    await page.getByLabel("Recovery code").fill(recoveryCodes[3].toUpperCase().replace(/-/g, " "));
    await page.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(/\/settings\/security\?recovered=1/, { timeout: 30_000 });
    await expect(page.getByRole("status")).toContainText("Two-factor authentication is off.");
    // Setup is already open in front of them.
    await expect(page.getByRole("dialog", { name: "Turn on two-factor authentication" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-two-factor-status="off"]')).toBeVisible();

    // Every factor and every remaining code is gone.
    const id = await userIdByEmail(user.email);
    expect(await serviceRest(`/mfa_recovery_codes?user_id=eq.${id}&select=id`)).toEqual([]);

    // The other device was signed out.
    await other.goto("/dashboard");
    await expect(other).toHaveURL(/\/login(\?|$)/, { timeout: 30_000 });

    // And the owner is told, in the log and by email.
    const events = (await serviceRest(`/security_events?user_id=eq.${id}&select=event`)) as { event: string }[];
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(["mfa.recovery_code_used", "mfa.disabled"]),
    );
    await expect(async () => {
      const mail = await devEmails(user.email);
      expect(mail.map((m) => m.subject)).toContain("Security alert: A recovery code was used to sign in");
    }).toPass({ timeout: 15_000 });

    // Signing in now needs only the password (until 2FA is set up again).
    await mine.clearCookies();
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await mine.close();
    await laptop.close();
  });

  test("a wrong or reused recovery code does not get in", async ({ browser }) => {
    const user = freshUser("badrecov");
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUp(page, user);
    const { app, recoveryCodes } = await enableTwoFactor(page, user.password);

    await context.clearCookies();
    await signInToChallenge(page, user);
    await page.getByRole("button", { name: "Use a recovery code instead" }).click();

    // Not a code at all, and a well-formed one that is not this account's.
    for (const attempt of ["123456", "zzzz-zzzz-zzzz-zzzz"]) {
      await page.getByLabel("Recovery code").fill(attempt);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(/didn't work/i);
    }
    await expect(page).toHaveURL(/\/login\/two-factor/);

    // A code spent in the database cannot be spent again.
    const id = await userIdByEmail(user.email);
    await serviceRest(`/rpc/mfa_consume_recovery_code`, {
      method: "POST",
      body: {
        p_user_id: id,
        p_hash: await (async () => {
          const { hashRecoveryCode, normalizeRecoveryCode } = await import("../../src/lib/auth/recovery-codes");
          return hashRecoveryCode(id, normalizeRecoveryCode(recoveryCodes[0])!);
        })(),
      },
    });
    await page.getByLabel("Recovery code").fill(recoveryCodes[0]);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/didn't work/i);

    // The authenticator still works, and 2FA is still on.
    await page.getByRole("button", { name: "Use your authenticator app instead" }).click();
    await enterChallengeCode(page, await nextCode(app));
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await page.goto("/settings/security");
    await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible();
    await context.close();
  });

  test("a password-reset link is NOT a way around the second factor", async ({ browser }) => {
    const user = freshUser("resetlink");
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUp(page, user);
    const { app } = await enableTwoFactor(page, user.password);

    // Someone with the inbox (but not the phone) asks for a reset link.
    await context.clearCookies();
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.getByRole("button", { name: "Forgot?" }).click();
    const resetDialog = page.getByRole("dialog");
    await expect(resetDialog).toBeVisible();
    await resetDialog.getByLabel("Email").fill(user.email);
    await resetDialog.getByRole("button", { name: "Send reset link" }).click();
    await expect(resetDialog.getByText(/reset link is on its way/i)).toBeVisible({ timeout: 20_000 });

    // ...and opens it. The link exchanges for a session, but an aal1 one:
    const link = await recoveryLinkFor(user.email);
    await page.goto(link);
    await page.waitForURL(/\/login\/two-factor\?next=%2Freset-password/, { timeout: 30_000 });
    expect(claimsOf(await accessToken(context)).aal).toBe("aal1");

    // The reset form is out of reach until the code is entered.
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login\/two-factor\?next=%2Freset-password/);

    // With the phone, it proceeds to the form, which works.
    await enterChallengeCode(page, await nextCode(app));
    await page.waitForURL(/\/reset-password/, { timeout: 30_000 });
    await page.locator('input[name="password"]').fill("Brand-New-Pass-42");
    await page.locator('input[name="confirm_password"]').fill("Brand-New-Pass-42");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // The new password works (and still needs the second factor).
    await context.clearCookies();
    await signInToChallenge(page, { email: user.email, password: "Brand-New-Pass-42" });
    await context.close();
  });
});
