import { expect, test, type Browser, type Page } from "@playwright/test";
import { freshUser, signUp, userIdByEmail } from "./helpers";
import {
  accessToken,
  claimsOf,
  enableTwoFactor,
  enterChallengeCode,
  nextCode,
  signInToChallenge,
  sql,
} from "./two-factor";

/**
 * Sign-in approval, end to end, with two browsers: the "phone" (already fully
 * signed in, 2FA on) and the "computer" (password done, waiting at the
 * two-factor step). The computer shows a QR code and a two-digit number; the
 * phone opens the link and taps that number; the computer finishes signing in
 * by itself. A wrong number refuses the sign-in, like Deny.
 *
 * What makes it worth two browsers: GoTrue deletes every aal1 session of an
 * account whenever ANY factor is verified (the mock does the same), so if the
 * approving phone verified anything, the waiting computer would be signed
 * out. These specs prove the computer gets through and the phone stays in.
 */

test.describe.configure({ timeout: 240_000 });

/** A real Chrome on Windows, so the phone can be checked for what it shows. */
const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** A computer with its own passkey hardware (Windows Hello, Touch ID). */
async function addPlatformAuthenticator(page: Page) {
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

async function newComputer(browser: Browser, options: { passkeyHardware?: boolean } = {}) {
  const context = await browser.newContext({ userAgent: CHROME_ON_WINDOWS });
  const page = await context.newPage();
  if (options.passkeyHardware) await addPlatformAuthenticator(page);
  return { context, page };
}

/** The QR code's link and the number shown under it, once they are on screen. */
async function waitingCode(computer: Page): Promise<{ link: string; number: string }> {
  const waiting = computer.locator("[data-approval-url]");
  await expect(waiting).toBeVisible({ timeout: 20_000 });
  const url = await waiting.getAttribute("data-approval-url");
  expect(url).toMatch(/\/approve\/[A-Za-z0-9_-]{43}$/);
  const number = await computer.locator("[data-approval-number]").getAttribute("data-approval-number");
  expect(number).toMatch(/^[1-9][0-9]$/);
  return { link: new URL(url!).pathname, number: number! };
}

/** From the challenge's code form to a QR code on screen. */
async function showApprovalCode(computer: Page): Promise<{ link: string; number: string }> {
  await computer.getByRole("button", { name: "Approve from your phone instead" }).click();
  const shown = await waitingCode(computer);
  await expect(computer.getByRole("img", { name: /QR code/ })).toBeVisible();
  return shown;
}

/** On the phone: open the link and tap the number the computer shows. */
async function approve(phone: Page, { link, number }: { link: string; number: string }) {
  await phone.goto(link);
  await phone.getByRole("button", { name: `Approve with ${number}` }).click();
  await expect(phone.getByRole("heading", { name: "Sign-in approved" })).toBeVisible({ timeout: 20_000 });
}

test.describe("sign-in approval from a signed-in device", () => {
  test("the phone taps the number, the computer gets in, and only an app code offers a passkey", async ({
    page: phone,
    browser,
  }) => {
    const user = freshUser("approve");
    await signUp(phone, user);
    const { app } = await enableTwoFactor(phone, user.password);
    const userId = await userIdByEmail(user.email);

    const computer = await newComputer(browser, { passkeyHardware: true });
    await signInToChallenge(computer.page, user);
    const shown = await showApprovalCode(computer.page);
    const { link, number } = shown;
    const [stored] = await sql(
      `select match_code from public.mfa_sign_in_approvals where user_id = $1 and status = 'pending'`,
      [userId],
    );
    expect(String(stored.match_code)).toBe(number);
    await expect(computer.page.getByText("Waiting for your phone…")).toBeVisible();
    // Still only half signed in while it waits.
    expect(claimsOf(await accessToken(computer.context)).aal).toBe("aal1");

    // ---- The phone: who is asking, and three numbers to pick from ----
    await phone.goto(link);
    await expect(phone.getByRole("heading", { name: "Sign in on another device?" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(phone.locator("[data-approve-device]")).toHaveText("Chrome on Windows");
    await expect(phone.getByText(user.email)).toBeVisible();
    await expect(phone.locator("[data-approve-number]")).toHaveCount(3);
    await phone.getByRole("button", { name: `Approve with ${number}` }).click();
    await expect(phone.getByRole("heading", { name: "Sign-in approved" })).toBeVisible({ timeout: 20_000 });
    await expect(phone.locator('[data-success-mark="device"]')).toBeVisible();

    // ---- The computer: through by itself. An approval never offers a passkey
    // here (someone talked into approving must not hand over a lasting key) ----
    await computer.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    expect(claimsOf(await accessToken(computer.context)).aal).toBe("aal2");
    await expect(computer.page.locator('[data-passkey-here="offer"]')).toHaveCount(0);

    // ---- Nothing signed the phone out: approving verified nothing on it ----
    await phone.goto("/settings/security");
    await expect(phone.locator('[data-two-factor-status="on"]')).toBeVisible({ timeout: 20_000 });
    await expect(phone.locator('[data-sign-in-approval="on"]')).toBeVisible();
    await expect(phone.getByText("Sign-in approved from another device")).toBeVisible();

    // ---- Underneath ----
    const factors = await sql(
      `select id, friendly_name, status from auth.mfa_factors where user_id = $1 order by created_at`,
      [userId],
    );
    const approvalFactor = factors.find((f) => String(f.friendly_name).startsWith("approval:"));
    expect(approvalFactor?.status).toBe("verified");
    // Listed nowhere as a way in of its own.
    await expect(phone.getByText("approval:", { exact: false })).toHaveCount(0);
    const [request] = await sql(
      `select status, factor_id, browser, os from public.mfa_sign_in_approvals
       where user_id = $1 order by created_at desc limit 1`,
      [userId],
    );
    expect(request).toMatchObject({ status: "used", factor_id: approvalFactor?.id, browser: "Chrome", os: "Windows" });
    const [secret] = await sql(`select sealed_secret from public.mfa_approval_factors where user_id = $1`, [userId]);
    expect(secret.sealed_secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    // ---- A spent link is dead ----
    await phone.goto(link);
    await expect(phone.getByRole("heading", { name: "This request has expired" })).toBeVisible({
      timeout: 20_000,
    });

    // ---- A sign-in with the app's code is what offers a passkey here ----
    await computer.context.clearCookies();
    await signInToChallenge(computer.page, user);
    await enterChallengeCode(computer.page, await nextCode(app));
    await expect(computer.page.locator('[data-passkey-here="offer"]')).toBeVisible({ timeout: 30_000 });
    await expect(computer.page.getByText("You're signed in.")).toBeVisible();
    await computer.page.getByRole("button", { name: "Create a passkey here" }).click();
    await expect(computer.page.locator('[data-passkey-here="added"]')).toBeVisible({ timeout: 30_000 });
    await computer.page.getByRole("button", { name: "Continue" }).click();
    await computer.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    // Named for the computer, and listed beside the app.
    await phone.goto("/settings/security");
    await expect(phone.locator('[data-factor-type="passkey"]')).toContainText("Chrome on Windows", {
      timeout: 20_000,
    });

    // ---- And the approval factor is reused, not re-made, next time ----
    await computer.context.clearCookies();
    await signInToChallenge(computer.page, user);
    // The computer has a passkey now, so that is what it is offered first.
    await expect(computer.page.getByRole("button", { name: "Use your passkey" })).toBeVisible();
    await approve(phone, await showApprovalCode(computer.page));
    await computer.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    const approvalFactors = await sql(
      `select id from auth.mfa_factors where user_id = $1 and friendly_name like 'approval:%'`,
      [userId],
    );
    expect(approvalFactors).toEqual([{ id: approvalFactor?.id }]);

    await computer.context.close();
  });

  test("the passkey lives on another device: the computer's prompt fails, approval is one tap away", async ({
    page: phone,
    browser,
  }) => {
    // The report this was built for: the computer's prompt finds no passkey
    // (it is on the phone, or on another PC), and the phone scanned has none.
    const user = freshUser("elsewhere");
    await signUp(phone, user);
    await addPlatformAuthenticator(phone);
    const userId = await userIdByEmail(user.email);
    await phone.goto("/settings/security");
    await phone.waitForLoadState("networkidle").catch(() => {});
    const dialog = phone.getByRole("dialog");
    await expect(async () => {
      await phone.getByRole("button", { name: "Set up two-factor authentication" }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Create passkey" }).click();
    await expect(dialog.getByRole("list", { name: "Recovery codes" })).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel(/saved my recovery codes/i).check();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Passkeys only: approval is off until asked for, and says why.
    const row = phone.locator("[data-sign-in-approval]");
    await expect(row).toHaveAttribute("data-sign-in-approval", "off", { timeout: 20_000 });
    await expect(row).toContainText("Off by default because you sign in with passkeys");
    await row.getByRole("button", { name: "Turn on" }).click();
    const confirm = phone.getByRole("dialog", { name: "Turn on sign-in approval?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Turn on" }).click();
    await expect(row).toHaveAttribute("data-sign-in-approval", "on", { timeout: 20_000 });
    expect(await sql(`select user_id from public.mfa_approval_opt_ins where user_id = $1`, [userId])).toHaveLength(1);

    // A computer with passkey hardware of its own, which does not hold this passkey.
    const computer = await newComputer(browser, { passkeyHardware: true });
    await signInToChallenge(computer.page, user);
    const usePasskey = computer.page.getByRole("button", { name: "Use your passkey" });
    await expect(usePasskey).toBeEnabled({ timeout: 20_000 });
    await usePasskey.click();
    const elsewhere = computer.page.locator("[data-passkey-elsewhere]");
    await expect(elsewhere).toBeVisible({ timeout: 60_000 });
    await expect(elsewhere).toContainText("no passkey for Square Share");
    await elsewhere.getByRole("button", { name: "Approve from your phone" }).click();
    await approve(phone, await waitingCode(computer.page));

    // Straight through, with no passkey offered on the back of an approval.
    await computer.page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    expect(claimsOf(await accessToken(computer.context)).aal).toBe("aal2");
    await expect(computer.page.locator('[data-passkey-here="offer"]')).toHaveCount(0);
    await computer.context.close();
  });

  test("the phone denies: the computer is told, and can show a new code", async ({ page: phone, browser }) => {
    const user = freshUser("deny");
    await signUp(phone, user);
    await enableTwoFactor(phone, user.password);
    const userId = await userIdByEmail(user.email);

    const computer = await newComputer(browser);
    await signInToChallenge(computer.page, user);
    const { link } = await showApprovalCode(computer.page);

    await phone.goto(link);
    await phone.getByRole("button", { name: "Deny" }).click();
    await expect(phone.getByRole("heading", { name: "Sign-in denied" })).toBeVisible({ timeout: 20_000 });
    await expect(phone.getByRole("link", { name: "Change password" })).toBeVisible();

    await expect(computer.page.getByText("The sign-in was denied on your other device.")).toBeVisible({
      timeout: 20_000,
    });
    expect(claimsOf(await accessToken(computer.context)).aal).toBe("aal1");
    await computer.page.getByRole("button", { name: "Show a new code" }).click();
    const fresh = computer.page.locator("[data-approval-url]");
    await expect(fresh).toBeVisible({ timeout: 20_000 });
    expect(new URL((await fresh.getAttribute("data-approval-url"))!).pathname).not.toBe(link);

    const events = await sql(`select event from public.security_events where user_id = $1`, [userId]);
    expect(events.map((e) => e.event)).toContain("mfa.sign_in_denied");
    await computer.context.close();
  });

  test("a wrong number refuses the sign-in, like Deny", async ({ page: phone, browser }) => {
    const user = freshUser("mismatch");
    await signUp(phone, user);
    await enableTwoFactor(phone, user.password);
    const userId = await userIdByEmail(user.email);

    const computer = await newComputer(browser);
    await signInToChallenge(computer.page, user);
    const { link, number } = await showApprovalCode(computer.page);

    await phone.goto(link);
    const choices = await phone
      .locator("[data-approve-number]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-approve-number")));
    expect(choices).toHaveLength(3);
    expect(choices).toContain(number);
    const wrong = choices.find((choice) => choice !== number)!;
    await phone.getByRole("button", { name: `Approve with ${wrong}` }).click();
    await expect(phone.getByRole("heading", { name: "Sign-in refused" })).toBeVisible({ timeout: 20_000 });
    await expect(phone.getByRole("link", { name: "Change password" })).toBeVisible();

    await expect(computer.page.getByText("The sign-in was denied on your other device.")).toBeVisible({
      timeout: 20_000,
    });
    expect(claimsOf(await accessToken(computer.context)).aal).toBe("aal1");
    const [request] = await sql(`select status from public.mfa_sign_in_approvals where user_id = $1`, [userId]);
    expect(request.status).toBe("denied");
    // The link is spent: a second guess finds nothing to answer.
    await phone.goto(link);
    await expect(phone.getByRole("heading", { name: "This request has expired" })).toBeVisible({
      timeout: 20_000,
    });
    await computer.context.close();
  });

  test("only the same account, signed in, with approval on, can approve", async ({ page: phone, browser }) => {
    const owner = freshUser("owner");
    await signUp(phone, owner);
    await enableTwoFactor(phone, owner.password);

    const computer = await newComputer(browser);
    await signInToChallenge(computer.page, owner);
    const { link } = await showApprovalCode(computer.page);

    // Someone else's account, signed in: refused, and told why.
    const strangerContext = await browser.newContext();
    const stranger = await strangerContext.newPage();
    await signUp(stranger, freshUser("stranger"));
    await stranger.goto(link);
    await expect(stranger.getByRole("heading", { name: "This request is for another account" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(stranger.getByRole("button", { name: /^Approve with/ })).toHaveCount(0);
    await strangerContext.close();

    // Signed out: asked to sign in first, and brought back here after.
    const nobodyContext = await browser.newContext();
    const nobody = await nobodyContext.newPage();
    await nobody.goto(link);
    await expect(nobody.getByRole("heading", { name: "Sign in to approve" })).toBeVisible({ timeout: 20_000 });
    await expect(nobody.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(link)}`,
    );
    await nobodyContext.close();

    // The owner switches approval off: the waiting code dies with it.
    await phone.goto("/settings/security");
    await phone.waitForLoadState("networkidle").catch(() => {});
    await expect(phone.locator('[data-sign-in-approval="on"]')).toBeVisible({ timeout: 20_000 });
    await phone.locator('[data-sign-in-approval="on"]').getByRole("button", { name: "Turn off" }).click();
    const confirm = phone.getByRole("dialog", { name: "Turn off sign-in approval?" });
    await expect(confirm).toBeVisible();
    // Two-factor was set up moments ago, so no extra code is asked for.
    await confirm.getByRole("button", { name: "Turn off" }).click();
    await expect(phone.locator('[data-sign-in-approval="off"]')).toBeVisible({ timeout: 20_000 });

    await expect(computer.page.getByText("This code has expired.")).toBeVisible({ timeout: 20_000 });
    await phone.goto(link);
    await expect(phone.getByRole("heading", { name: "This request has expired" })).toBeVisible({
      timeout: 20_000,
    });
    // And the challenge no longer offers it at all.
    await computer.page.reload();
    await expect(computer.page.getByLabel("Authentication code")).toBeVisible({ timeout: 20_000 });
    await expect(computer.page.getByRole("button", { name: "Approve from your phone instead" })).toHaveCount(0);
    await computer.context.close();
  });
});
