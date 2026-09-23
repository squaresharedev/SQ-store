import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { clearAuthRateLimits, devEmails, freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import {
  accessToken,
  claimsOf,
  enableTwoFactor,
  enterChallengeCode,
  nextCode,
  signInToChallenge,
  wrongCode,
  wrongCodes,
  type Authenticator,
} from "./two-factor";

/**
 * Signing in to an account with 2FA on. One account for the file (built from
 * a context, so axe can scan it) keeps the sign-up rate limit out of the way;
 * each test signs in fresh from a clean cookie jar.
 */

const user = freshUser("signin2fa");
let app: Authenticator;
let context: BrowserContext;
let page: Page;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signUp(page, user);
  ({ app } = await enableTwoFactor(page, user.password));
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(async () => {
  await context.clearCookies();
  await clearAuthRateLimits();
});

// Generous: the first visit to each 2FA route compiles it in next dev.
test.describe.configure({ timeout: 180_000 });

test.describe("two-factor sign-in", () => {
  test("the password alone stops at the challenge, with an aal1 session", async () => {
    await signInToChallenge(page, user);
    await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
    expect(claimsOf(await accessToken(context)).aal).toBe("aal1");
  });

  test("a half-signed-in session cannot reach ANY page: everything bounces to the challenge", async () => {
    await signInToChallenge(page, user);
    for (const path of ["/dashboard", "/orders", "/products", "/settings/account", "/settings/security", "/storefront"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login\/two-factor\?next=/);
    }
    // The sign-in page itself does not ask for the password again.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login\/two-factor/);
  });

  test("and cannot use the API routes or the data export either", async () => {
    await signInToChallenge(page, user);
    const exported = await page.request.get("/settings/export");
    expect(exported.status()).toBe(401);
    const search = await page.request.get("/api/search?q=lamp");
    expect(search.status()).toBeGreaterThanOrEqual(400);
  });

  test("a wrong code is refused and the page stays put", async () => {
    await signInToChallenge(page, user);
    await enterChallengeCode(page, wrongCode(app));
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/didn't work/i);
    await expect(page).toHaveURL(/\/login\/two-factor/);
  });

  test("the right code finishes signing in and goes where the person was headed", async () => {
    await signInToChallenge(page, user, "/orders");
    await enterChallengeCode(page, await nextCode(app));
    await page.waitForURL(/\/orders/, { timeout: 30_000 });
    const claims = claimsOf(await accessToken(context));
    expect(claims.aal).toBe("aal2");
    expect((claims.amr as { method: string }[]).map((e) => e.method)).toContain("totp");
  });

  test("a code already used cannot be used again (replay guard)", async () => {
    await signInToChallenge(page, user);
    const code = await nextCode(app);
    await enterChallengeCode(page, code);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // Someone who watched it being typed tries it on their own sign-in. The
    // rate-limit ledger is NOT cleared here: it is where the replay guard
    // remembers the code.
    await context.clearCookies();
    await signInToChallenge(page, user, undefined, { clearLimits: false });
    await enterChallengeCode(page, code);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/already been used/i);
  });

  test("never redirects off-site after the challenge", async () => {
    await clearAuthRateLimits();
    await page.goto("/login?next=" + encodeURIComponent("https://evil.example/steal"));
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();
    await page.waitForURL(/\/login\/two-factor/);
    await enterChallengeCode(page, await nextCode(app));
    await page.waitForURL((url) => url.origin === "http://localhost:3100", { timeout: 30_000 });
    await expect(page).not.toHaveURL(/evil\.example/);

    // And the challenge page itself refuses to send anyone back into sign-in.
    await page.goto("/login/two-factor?next=%2F%2Fevil.example");
    await expect(page).toHaveURL(/localhost:3100\/(dashboard)?/);
  });

  test("'Not you? Sign out' ends the half-signed-in session", async () => {
    await signInToChallenge(page, user);
    await page.getByRole("button", { name: "Not you? Sign out" }).click();
    await page.waitForURL(/\/login(\?|$)/);
    await page.goto("/login/two-factor");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("signed-out visitors to the challenge are sent to sign in", async () => {
    await page.goto("/login/two-factor?next=%2Forders");
    await expect(page).toHaveURL(/\/login\?next=%2Forders/);
  });

  test("the challenge page passes axe", async () => {
    await signInToChallenge(page, user);
    const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test("six wrong codes lock the challenge and email the owner", async () => {
    await signInToChallenge(page, user);
    const box = page.getByLabel("Authentication code");
    const alert = page.getByRole("main").getByRole("alert");
    for (const guess of wrongCodes(app, 6)) {
      await expect(box).toBeEditable({ timeout: 20_000 });
      // Six digits submit the form on their own.
      await box.fill(guess);
      await expect(alert).toHaveText(/didn't work/i, { timeout: 20_000 });
      // Wait for the form to reset before the next guess.
      await expect(box).toHaveValue("", { timeout: 20_000 });
    }
    // The seventh, even the right one, is refused for now.
    await expect(box).toBeEditable({ timeout: 20_000 });
    await box.fill(await nextCode(app));
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/too many attempts/i, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/login\/two-factor/);

    // The owner hears about it: the password is known to someone.
    await expect(async () => {
      const mail = await devEmails(user.email);
      expect(mail.map((m) => m.subject)).toContain(
        "Security alert: Someone is trying to sign in to your account",
      );
    }).toPass({ timeout: 15_000 });
    const id = await userIdByEmail(user.email);
    const events = (await serviceRest(`/security_events?user_id=eq.${id}&select=event`)) as { event: string }[];
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["mfa.challenge_failed", "mfa.locked_out"]));
  });
});
