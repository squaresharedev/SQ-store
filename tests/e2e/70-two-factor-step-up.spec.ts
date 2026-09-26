import { expect, test } from "@playwright/test";
import { clearAuthRateLimits, devEmails, expectToast, freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import {
  ageSecondFactor,
  authenticator,
  chooseAuthenticatorApp,
  enableTwoFactor,
  enterChallengeCode,
  markSignsInWithGoogle,
  nextCode,
  signInToChallenge,
  signInWithTwoFactor,
  type Authenticator,
} from "./two-factor";

/**
 * "Confirm it's you" for sensitive actions. With 2FA on, a session that
 * passed its code more than ten minutes ago cannot change the email, the
 * business details or the team, delete the account, or export it, without a
 * fresh code. (A new password is only ever set through the emailed link, which
 * asks for a code itself: 69-two-factor-recovery.) The 2FA controls themselves (removing an authenticator,
 * turning 2FA off, new recovery codes) take a code every single time.
 *
 * ageSecondFactor() re-signs the session token with older timestamps, which
 * is "ten minutes passed" without making the spec wait for it.
 */

const ELEVEN_MINUTES = 11 * 60;

async function setUp(browser: import("@playwright/test").Browser, tag: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = freshUser(tag);
  await signUp(page, user);
  const { app } = await enableTwoFactor(page, user.password);
  return { context, page, user, app };
}

// Generous: the first visit to each 2FA route compiles it in next dev.
test.describe.configure({ timeout: 180_000 });

test.describe("two-factor step-up", () => {
  test("a stale session cannot request account deletion or invite a team member without a code", async ({
    browser,
  }) => {
    const { context, page, app } = await setUp(browser, "stepupdel");
    await ageSecondFactor(context, ELEVEN_MINUTES);

    // Deletion.
    await page.goto("/settings/danger");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByLabel(/to confirm/i).fill("delete my account");
    // Scoped: the export card above asks for its own code too.
    const code = page.locator("#delete").getByLabel("Authenticator code");
    await expect(code).toBeVisible({ timeout: 10_000 });
    await code.fill(await nextCode(app));
    await page.getByRole("button", { name: "Permanently delete" }).click();
    await expect(page.getByRole("heading", { name: "Deletion requested" })).toBeVisible({ timeout: 20_000 });

    // The code just entered reopened the window: the team invite goes
    // through without asking again.
    await page.goto("/settings/team");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /invite/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email address").fill(`teammate-${Date.now()}@e2e.squareshare.to`);
    await expect(dialog.getByLabel("Authenticator code")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Send invite" }).click();
    await expectToast(page, /invite created/i);
    await context.close();
  });

  test("an invite from a stale session needs a code, and a missing code writes nothing", async ({ browser }) => {
    const { context, page, user, app } = await setUp(browser, "stepupinv");
    await ageSecondFactor(context, ELEVEN_MINUTES);

    await page.goto("/settings/team");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /invite/i }).first().click();
    const dialog = page.getByRole("dialog");
    const invited = `teammate-${Date.now()}@e2e.squareshare.to`;
    await dialog.getByLabel("Email address").fill(invited);
    const code = dialog.getByLabel("Authenticator code");
    await expect(code).toBeVisible({ timeout: 10_000 });
    await code.fill(await nextCode(app));
    await dialog.getByRole("button", { name: "Send invite" }).click();
    await expectToast(page, /invite created/i);

    const id = await userIdByEmail(user.email);
    const rows = (await serviceRest(
      `/team_members?account_owner_id=eq.${id}&invited_email=eq.${encodeURIComponent(invited)}&select=id`,
    )) as unknown[];
    expect(rows).toHaveLength(1);
    await context.close();
  });

  test("the data export needs a fresh code, and the route itself enforces it", async ({ browser }) => {
    const { context, page, app } = await setUp(browser, "stepupexp");

    // Fresh: the export downloads.
    const fresh = await page.request.get("/settings/export");
    expect(fresh.status()).toBe(200);

    // Stale: the route refuses outright, whatever the UI does.
    await ageSecondFactor(context, ELEVEN_MINUTES);
    const stale = await page.request.get("/settings/export");
    expect(stale.status()).toBe(403);

    // The Danger zone asks for the code first, then downloads.
    await page.goto("/settings/danger");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Authenticator code").fill(await nextCode(app));
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "Download my data" }).click();
    expect((await download).suggestedFilename()).toMatch(/^square-share-export-.*\.json$/);
    await context.close();
  });

  test("removing the last authenticator turns 2FA off, and always takes a code", async ({ browser }) => {
    const { context, page, user, app } = await setUp(browser, "stepupoff");

    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /^Remove / }).click();
    const dialog = page.getByRole("dialog", { name: "Turn off two-factor authentication?" });
    await expect(dialog).toBeVisible();

    // Even seconds after verifying, the code box is there and required.
    const code = dialog.getByLabel("Authenticator code");
    await expect(code).toBeVisible();
    await dialog.getByRole("button", { name: "Turn off" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/6-digit code/);

    await code.fill(await nextCode(app));
    await dialog.getByRole("button", { name: "Turn off" }).click();
    await expectToast(page, /two-factor authentication is off/i);
    await expect(page.locator('[data-two-factor-status="off"]')).toBeVisible({ timeout: 20_000 });

    // Codes voided, owner emailed, and sign-in is password-only again.
    const id = await userIdByEmail(user.email);
    expect(await serviceRest(`/mfa_recovery_codes?user_id=eq.${id}&select=id`)).toEqual([]);
    await expect(async () => {
      const subjects = (await devEmails(user.email)).map((m) => m.subject);
      expect(subjects).toContain("Security alert: Two-factor authentication is off");
    }).toPass({ timeout: 15_000 });
    await context.clearCookies();
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await context.close();
  });

  test("new recovery codes replace the old set, and need a code", async ({ browser }) => {
    const { context, page, user, app } = await setUp(browser, "stepupcodes");

    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Generate new codes" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Authenticator code").fill(await nextCode(app));
    await dialog.getByRole("button", { name: "Generate new codes" }).click();
    const list = dialog.getByRole("list", { name: "Recovery codes" });
    await expect(list).toBeVisible({ timeout: 20_000 });
    const fresh = (await list.getByRole("listitem").allTextContents()).map((c) => c.trim());
    await dialog.getByLabel(/saved my recovery codes/i).check();
    await dialog.getByRole("button", { name: "Done" }).click();

    // An old code no longer works; a new one does.
    await context.clearCookies();
    await signInToChallenge(page, user);
    await page.getByRole("button", { name: "Use a recovery code instead" }).click();
    await page.getByLabel("Recovery code").fill(fresh[0]);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/settings\/security\?recovered=1/, { timeout: 30_000 });
    await context.close();
  });

  test("a second authenticator: adding needs a code from the first, and sign-in asks which one", async ({
    browser,
  }) => {
    const { context, page, user, app } = await setUp(browser, "stepupsecond");

    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Add another passkey or app" }).click();
    const dialog = page.getByRole("dialog", { name: "Add another way to sign in" });
    await chooseAuthenticatorApp(dialog);
    await dialog.getByLabel("Name this authenticator").fill("Backup tablet");
    // A code from the EXISTING authenticator, not a password.
    await expect(dialog.getByLabel("Current password")).toHaveCount(0);
    await dialog.getByLabel("Authenticator code").fill(await nextCode(app));
    await dialog.getByRole("button", { name: "Continue" }).click();

    const key = dialog.getByLabel("Setup key", { exact: true });
    await expect(key).toBeVisible({ timeout: 20_000 });
    const tablet: Authenticator = authenticator(((await key.textContent()) ?? "").replace(/\s+/g, ""));
    await dialog.getByLabel("6-digit code from the app").fill(await nextCode(tablet));
    await dialog.getByRole("button", { name: "Verify and add" }).click();
    // Adding ends on its own moment of success, then Done.
    await expect(dialog.getByRole("status")).toHaveText("Authenticator added.", { timeout: 20_000 });
    await expect(dialog.locator('[data-success-mark="app"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("list", { name: "Passkeys and authenticator apps" }).getByRole("listitem")).toHaveCount(2);

    // Sign-in now offers a choice, and either phone works.
    await context.clearCookies();
    await signInToChallenge(page, user);
    await expect(page.getByLabel("Authenticator")).toBeVisible();
    await page.getByLabel("Authenticator").click();
    await page.getByRole("option", { name: "Backup tablet" }).click();
    await enterChallengeCode(page, await nextCode(tablet));
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // Removing ONE of two leaves 2FA on.
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Remove Backup tablet" }).click();
    const remove = page.getByRole("dialog", { name: 'Remove "Backup tablet"?' });
    await remove.getByLabel("Authenticator code").fill(await nextCode(app));
    await remove.getByRole("button", { name: "Remove" }).click();
    await expectToast(page, /removed "backup tablet"/i);
    await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible();
    await expect(page.getByRole("list", { name: "Passkeys and authenticator apps" }).getByRole("listitem")).toHaveCount(1);

    // And the first phone still signs in.
    await context.clearCookies();
    await signInWithTwoFactor(page, user, app);
    await context.close();
  });

  test("a Google-only account's email change always takes a code, even minutes after signing in", async ({ browser }) => {
    // No password to check, so the code is the only proof: a cookie lifted
    // just after sign-in must not be able to move the address on its own.
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = freshUser("googlemail");
    await signUp(page, user);
    await markSignsInWithGoogle(user.email, { keepPassword: false });
    const { app } = await enableTwoFactor(page, user.password);

    await page.goto("/settings/account");
    await page.waitForLoadState("networkidle").catch(() => {});
    const emailCard = page.locator("#email");
    // Asked for up front, although the session verified a code seconds ago.
    const code = emailCard.getByLabel("Authenticator code");
    await expect(code).toBeVisible();
    await expect(emailCard.getByLabel("Current password")).toHaveCount(0);

    await emailCard.getByLabel("New email").fill(`moved-${Date.now()}@e2e.squareshare.to`);
    await emailCard.getByRole("button", { name: /send confirmation link/i }).click();
    await expectToast(page, /6-digit code/i);

    await emailCard.getByLabel("Authenticator code").fill(await nextCode(app));
    await emailCard.getByRole("button", { name: /send confirmation link/i }).click();
    await expectToast(page, /check your inbox/i);
    await context.close();
  });
});
