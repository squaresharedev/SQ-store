import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { clearAuthRateLimits, devEmails, freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import { SERVICE_KEY } from "./stack/keys.mjs";
import {
  accessToken,
  ageSession,
  authenticator,
  claimsOf,
  chooseAuthenticatorApp,
  enableTwoFactor,
  markSignsInWithGoogle,
  nextCode,
} from "./two-factor";

/**
 * Turning two-factor authentication on, end to end: the nudges that push a
 * seller towards it, the setup itself (and everything it refuses), what it
 * does to the account (codes, alerts, other sessions), and the page it lives
 * on at phone width and to a screen reader.
 */

async function expectNoSeriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

// Generous: the first visit to each 2FA route compiles it in next dev.
test.describe.configure({ timeout: 180_000 });

test.describe("two-factor setup", () => {
  test("a seller without 2FA is pushed towards it from three places", async ({ page }) => {
    const user = freshUser("nudge");
    await signUp(page, user);

    // 1. The dashboard's Needs attention list.
    const row = page.getByText("Turn on two-factor authentication").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Turn on", exact: true })).toHaveAttribute(
      "href",
      "/settings/security#two-factor",
    );

    // 2. The settings rail marks Security as recommended.
    await page.goto("/settings/account");
    // Settle first: a link clicked before hydration does not navigate.
    await page.waitForLoadState("networkidle").catch(() => {});
    const securityTab = page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: /Security/ });
    await expect(securityTab).toContainText("Recommended");

    // 3. The account page, right under the password card.
    await expect(page.getByRole("heading", { name: "Your password is the only lock on this account" })).toBeVisible();
    await page.getByRole("link", { name: "Turn on 2FA" }).click();
    await page.waitForURL(/\/settings\/security\?setup=1/);
    // ...which lands with setup already open.
    await expect(page.getByRole("dialog", { name: "Turn on two-factor authentication" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("setup refuses a wrong password and a wrong code, then turns 2FA on", async ({ page }) => {
    const user = freshUser("setup");
    await signUp(page, user);
    // Signed in a while ago, so setup asks for the password (a fresh sign-in
    // would count as proof on its own; see the fresh-sign-in test below).
    await ageSession(page.context(), 11 * 60);
    await clearAuthRateLimits();
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});

    await expect(page.locator('[data-two-factor-status="off"]')).toBeVisible();
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);

    // Step 1: a stolen session must not be able to enrol its own phone.
    await dialog.getByLabel("Current password").fill("not-my-password");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/current password is incorrect/i);

    await dialog.getByLabel("Current password").fill(user.password);
    await dialog.getByRole("button", { name: "Continue" }).click();

    // Step 2: QR + a key to type in by hand.
    const key = dialog.getByLabel("Setup key", { exact: true });
    await expect(key).toBeVisible({ timeout: 20_000 });
    const qr = dialog.getByRole("img", { name: /QR code/ });
    await expect(qr).toBeVisible();
    // Re-encoded by the server so the SVG's '#' cannot break the data: URL.
    expect(await qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    const app = authenticator(((await key.textContent()) ?? "").replace(/\s+/g, ""));

    // A wrong first code leaves 2FA off.
    await dialog.getByLabel("6-digit code from the app").fill("000000");
    await dialog.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/didn't match/i);

    await dialog.getByLabel("6-digit code from the app").fill(await nextCode(app));
    await dialog.getByRole("button", { name: "Verify and turn on" }).click();

    // Step 3: the recovery codes, once, and "Done" only after saying they are saved.
    const list = dialog.getByRole("list", { name: "Recovery codes" });
    await expect(list).toBeVisible({ timeout: 20_000 });
    const codes = await list.getByRole("listitem").allTextContents();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code.trim()).toMatch(/^[0-9a-z]{4}(-[0-9a-z]{4}){3}$/);
    await expect(dialog.getByRole("button", { name: "Done" })).toBeDisabled();
    await dialog.getByLabel(/saved my recovery codes/i).check();
    await dialog.getByRole("button", { name: "Done" }).click();

    // On, with the authenticator listed and the recovery-code count.
    await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("list", { name: "Passkeys and authenticator apps" })).toContainText("Authenticator app");
    await expect(page.locator("[data-recovery-remaining]")).toHaveAttribute("data-recovery-remaining", "10");

    // This session was upgraded to aal2 on the spot.
    expect(claimsOf(await accessToken(page.context())).aal).toBe("aal2");

    // The server stored hashes, never the codes.
    const id = await userIdByEmail(user.email);
    const stored = (await serviceRest(`/mfa_recovery_codes?user_id=eq.${id}&select=code_hash`)) as {
      code_hash: string;
    }[];
    expect(stored).toHaveLength(10);
    const plain = codes.map((c) => c.trim().replace(/-/g, ""));
    for (const { code_hash } of stored) {
      expect(code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(plain).not.toContain(code_hash);
    }

    // The activity log, the bell and the inbox all say so.
    await page.reload();
    await expect(page.getByRole("list", { name: "Recent security activity" })).toContainText(
      "Two-factor authentication turned on",
    );
    await expect(async () => {
      const mail = await devEmails(user.email);
      expect(mail.map((m) => m.subject)).toContain("Security alert: Two-factor authentication is on");
    }).toPass({ timeout: 15_000 });
    const notices = (await serviceRest(`/notifications?user_id=eq.${id}&type=eq.security&select=title`)) as {
      title: string;
    }[];
    expect(notices.map((n) => n.title)).toContain("Two-factor authentication is on");

    // And the nudges are gone.
    await page.goto("/dashboard");
    await expect(page.getByText("Turn on two-factor authentication")).toHaveCount(0);
    await page.goto("/settings/account");
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Security/ }),
    ).not.toContainText("Recommended");
    await expect(page.getByRole("heading", { name: "Your password is the only lock on this account" })).toHaveCount(0);
  });

  test("a sign-in moments ago is proof enough: no password asked", async ({ page }) => {
    const user = freshUser("fresh2fa");
    await signUp(page, user);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);
    await expect(dialog.getByText(/signed in a moment ago/i)).toBeVisible();
    await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("a Google account with an old password on file is offered Google, and told which password is meant", async ({
    page,
  }) => {
    // The reported bug: a Google-signed-in account that also has a password
    // hash was asked for "Current password", and the password its owner knows
    // (their Google one) was refused as "incorrect" with no way forward.
    const user = freshUser("googlepw");
    await signUp(page, user);
    await markSignsInWithGoogle(user.email, { keepPassword: true });
    await ageSession(page.context(), 11 * 60);
    await clearAuthRateLimits();
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);

    // The prompt says which password, and offers the way they really sign in.
    await expect(dialog.getByLabel("Square Share password")).toBeVisible();
    await expect(dialog.getByText(/not your Google password/i)).toBeVisible();
    const google = dialog.getByRole("button", { name: "Confirm with Google" });
    await expect(google).toBeVisible();
    // It comes straight back to setup.
    await expect(
      dialog.locator('form:has(button:text("Confirm with Google")) input[name="next"]'),
    ).toHaveValue("/settings/security?setup=1");

    // Their Google password is refused, pointing them at Google, not a dead end.
    await dialog.getByLabel("Square Share password").fill("my-google-password");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/Confirm with Google/);

    // The Square Share password still works.
    await dialog.getByLabel("Square Share password").fill(user.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("a Google-only account signed in long ago confirms with Google, no password field at all", async ({
    page,
  }) => {
    const user = freshUser("googleonly");
    await signUp(page, user);
    await markSignsInWithGoogle(user.email, { keepPassword: false });
    await ageSession(page.context(), 11 * 60);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm with Google" })).toBeVisible();
    await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Continue" })).toHaveCount(0);
  });

  test("closing setup halfway leaves no half-made factor behind", async ({ page }) => {
    const user = freshUser("abandon");
    await signUp(page, user);
    // Signed in a while ago, so setup asks for the password (a fresh sign-in
    // would count as proof on its own; see the fresh-sign-in test below).
    await ageSession(page.context(), 11 * 60);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);
    await dialog.getByLabel("Current password").fill(user.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 20_000 });

    const id = await userIdByEmail(user.email);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // The pending factor is withdrawn, and 2FA is still off.
    await expect(async () => {
      const res = await fetch(`http://127.0.0.1:54321/auth/v1/admin/users/${id}/factors`, {
        headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      });
      expect(await res.json()).toEqual([]);
    }).toPass({ timeout: 15_000 });
    await page.reload();
    await expect(page.locator('[data-two-factor-status="off"]')).toBeVisible();
  });

  test("turning 2FA on signs out every OTHER session", async ({ browser }) => {
    const user = freshUser("others");
    const laptop = await browser.newContext();
    const phone = await browser.newContext();
    const a = await laptop.newPage();
    const b = await phone.newPage();

    await signUp(a, user);
    // A second device signs in with the password.
    await clearAuthRateLimits();
    await b.goto("/login");
    await b.locator('input[name="identifier"]').fill(user.email);
    await b.locator('input[name="password"]').fill(user.password);
    await b.locator('button[name="intent"]').click();
    await b.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await enableTwoFactor(a, user.password);

    // The other device is out: its next page load lands on sign-in.
    await b.goto("/orders");
    await expect(b).toHaveURL(/\/login(\?|$)/, { timeout: 30_000 });
    // The device that turned it on is still in.
    await a.goto("/orders");
    await expect(a).toHaveURL(/\/orders/);

    await laptop.close();
    await phone.close();
  });

  test("the security page and setup dialog pass axe", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const user = freshUser("a11ysec");
    await signUp(page, user);
    // Signed in a while ago, so setup asks for the password (a fresh sign-in
    // would count as proof on its own; see the fresh-sign-in test below).
    await ageSession(page.context(), 11 * 60);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoSeriousViolations(page);

    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Current password").fill(user.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 20_000 });
    // Let the dialog's entrance settle (axe measures what is on screen).
    await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await expectNoSeriousViolations(page);
    await context.close();
  });
});

test.describe("two-factor setup on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the setup fits the screen and offers a tap-to-open link", async ({ page }) => {
    const user = freshUser("mobile2fa");
    await signUp(page, user);
    // Signed in a while ago, so setup asks for the password (a fresh sign-in
    // would count as proof on its own; see the fresh-sign-in test below).
    await ageSession(page.context(), 11 * 60);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle").catch(() => {});

    const noSideScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await noSideScroll()).toBe(true);

    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    const dialog = page.getByRole("dialog");
    await chooseAuthenticatorApp(dialog);
    await dialog.getByLabel("Current password").fill(user.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Setup key", { exact: true })).toBeVisible({ timeout: 20_000 });

    // On the phone itself, a tap beats a scan.
    const open = dialog.getByRole("link", { name: "Open in authenticator app" });
    await expect(open).toBeVisible();
    expect(await open.getAttribute("href")).toMatch(/^otpauth:\/\/totp\//);
    expect(await noSideScroll()).toBe(true);

    // Everything in the dialog is reachable: the verify button is on screen.
    await dialog.getByRole("button", { name: "Verify and turn on" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Verify and turn on" })).toBeInViewport();
  });
});
