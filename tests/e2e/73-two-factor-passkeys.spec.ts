import { expect, test, type Page } from "@playwright/test";
import { freshUser, signUp, userIdByEmail } from "./helpers";
import { accessToken, ageSecondFactor, claimsOf, signInToChallenge, sql } from "./two-factor";

/**
 * Two-factor authentication with a PASSKEY instead of an authenticator app,
 * end to end: turning it on, signing in with it, and confirming a sensitive
 * change with it (removing it, which turns 2FA off).
 *
 * Chromium's virtual authenticator plays the part of the phone: a real
 * WebAuthn authenticator with user verification, driven through CDP, so the
 * browser runs genuine create()/get() ceremonies against the app's options
 * and the server verifies genuine signatures. The factor behind the passkey
 * is a real (mock-GoTrue) TOTP factor completed by the server.
 */

// Generous: the first visit to each 2FA route compiles it in next dev.
test.describe.configure({ timeout: 180_000 });

/** A platform authenticator with Face ID/fingerprint that always says yes. */
async function addPhone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.describe("two-factor with a passkey", () => {
  test("turn it on, sign in with it, confirm a sensitive change with it", async ({ page, context }) => {
    const user = freshUser("passkey");
    await signUp(page, user);
    await addPhone(page);
    const userId = await userIdByEmail(user.email);

    // ---- Turn it on: a passkey is the default, and nothing is installed ----
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await expect(dialog.getByRole("radio", { name: /Passkey/ })).toBeChecked();
    await expect(dialog.getByText("Recommended")).toBeVisible();
    await expect(dialog.getByLabel("Name this authenticator")).toHaveValue("Passkey");
    // Signed up a moment ago: that is the proof, nothing else is asked.
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("dialog", { name: "Create your passkey" })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Create passkey" }).click();

    const codes = dialog.getByRole("list", { name: "Recovery codes" });
    await expect(codes).toBeVisible({ timeout: 30_000 });
    await expect(codes.getByRole("listitem")).toHaveCount(10);
    // The moment of success: the print recorded, above the codes.
    await expect(dialog.locator('[data-success-mark="passkey"]')).toBeVisible();
    await dialog.getByLabel(/saved my recovery codes/i).check();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-factor-type="passkey"]')).toContainText("Passkey · Added");

    // What it did underneath: a verified GoTrue factor marked as a passkey,
    // and a stored passkey whose sealed secret is not the factor's secret.
    const factors = await sql(
      `select id, friendly_name, status, secret from auth.mfa_factors where user_id = $1`,
      [userId],
    );
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({ friendly_name: "passkey:Passkey", status: "verified" });
    const stored = await sql(
      `select factor_id, sealed_secret, transports from public.mfa_passkeys where user_id = $1`,
      [userId],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].factor_id).toBe(factors[0].id);
    expect(stored[0].sealed_secret).not.toContain(factors[0].secret);
    // This session was upgraded on the spot.
    expect(claimsOf(await accessToken(context)).aal).toBe("aal2");

    // ---- Sign in: password, then the passkey (no code, no app) ----
    await context.clearCookies();
    await signInToChallenge(page, user);
    await expect(page.getByText("Use your passkey to finish signing in as")).toBeVisible();
    // No code box: this account has no app to read one from.
    await expect(page.getByLabel("Authentication code")).toHaveCount(0);
    const usePasskey = page.getByRole("button", { name: "Use your passkey" });
    // Enabled once the options have arrived (fetched as the page opens).
    await expect(usePasskey).toBeEnabled({ timeout: 20_000 });
    await usePasskey.click();
    // Verified: a beat of success on the challenge page, then the dashboard.
    await expect(page.getByRole("status")).toHaveText("Signing you in…", { timeout: 20_000 });
    await expect(page.locator('[data-success-mark="passkey"]')).toBeVisible();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    const signedIn = claimsOf(await accessToken(context));
    expect(signedIn.aal).toBe("aal2");

    // ---- A sensitive change, long after sign-in: confirmed with the passkey ----
    await ageSecondFactor(context, 60 * 60);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Remove Passkey" }).click();
    const remove = page.getByRole("dialog", { name: "Turn off two-factor authentication?" });
    await expect(remove).toBeVisible();
    await expect(remove.getByText("This is a sensitive change. Confirm it's you with your passkey.")).toBeVisible();
    const confirm = remove.getByRole("button", { name: "Confirm with passkey" });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    // The confirmation IS the submit.
    await confirm.click();
    await expect(page.locator('[data-two-factor-status="off"]')).toBeVisible({ timeout: 30_000 });

    // The factor went, and the passkey with it (the foreign key's cascade).
    expect(await sql(`select id from auth.mfa_factors where user_id = $1`, [userId])).toHaveLength(0);
    expect(await sql(`select id from public.mfa_passkeys where user_id = $1`, [userId])).toHaveLength(0);
  });

  test("the sign-in challenge offers the app too when the account has both", async ({ page, context }) => {
    const user = freshUser("passkey-both");
    await signUp(page, user);
    await addPhone(page);
    const userId = await userIdByEmail(user.email);

    // A passkey first...
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Create passkey" }).click();
    await expect(dialog.getByRole("list", { name: "Recovery codes" })).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel(/saved my recovery codes/i).check();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible({ timeout: 20_000 });

    // ...then adding an app, which asks for the existing passkey to prove it's you.
    await page.getByRole("button", { name: "Add another passkey or app" }).click();
    const add = page.getByRole("dialog", { name: "Add another way to sign in" });
    await expect(add).toBeVisible();
    await add.getByRole("radio", { name: /Authenticator app/ }).check();
    await expect(add.getByLabel("Name this authenticator")).toHaveValue("Authenticator app");
    const confirm = add.getByRole("button", { name: "Confirm with passkey" });
    await expect(confirm).toBeEnabled({ timeout: 20_000 });
    await confirm.click();
    // The app's QR step: the passkey proved it, the begin action ran.
    await expect(add.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 30_000 });
    await add.getByRole("button", { name: "Cancel" }).click();

    // The half-made app factor was withdrawn: only the passkey's remains.
    await expect
      .poll(async () => (await sql(`select status from auth.mfa_factors where user_id = $1`, [userId])).length)
      .toBe(1);

    // With a passkey only, the challenge leads with it and offers recovery.
    await context.clearCookies();
    await signInToChallenge(page, user);
    await expect(page.getByRole("button", { name: "Use your passkey" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use a recovery code instead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use your authenticator app instead" })).toHaveCount(0);
  });
});
