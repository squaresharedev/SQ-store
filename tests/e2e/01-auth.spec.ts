import { expect, test } from "@playwright/test";
import { clearAuthRateLimits, freshUser, signIn, signUp } from "./helpers";

test.describe("auth", () => {
  test("sign up lands on the dashboard with a session", async ({ page }) => {
    const user = freshUser("signup");
    await signUp(page, user);
    await expect(page).toHaveURL(/\/dashboard/);
    // The dashboard shell renders (auth gate passed).
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });

  test("wrong password shows a friendly error, no redirect", async ({ page }) => {
    const user = freshUser("wrongpw");
    await signUp(page, user);

    // fresh context: sign out via a clean page state — just visit /login in a
    // new context instead; here simply attempt a bad login from /login.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.locator('input[name="password"]').fill("not-the-password");
    await page.locator('button[name="intent"]').click();
    await expect(page.getByRole("alert").filter({ hasText: /incorrect email or password/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("existing user can sign back in", async ({ page }) => {
    const user = freshUser("signin");
    await signUp(page, user);
    await page.context().clearCookies();
    await signIn(page, user);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("signing up with an existing email is refused", async ({ page }) => {
    const user = freshUser("dupe");
    await signUp(page, user);
    await page.context().clearCookies();

    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="identifier"]').fill(user.email);
    // A different handle, so the address is the only thing colliding.
    await page.locator('input[name="username"]').fill(freshUser("dupe2").username);
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('input[name="confirm_password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();
    await expect(page.getByRole("alert").filter({ hasText: /already exists/i })).toBeVisible();
  });

  test("unauthenticated dashboard visit redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated settings + storefront visits redirect too", async ({ page }) => {
    await page.goto("/settings/account");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/storefront");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in with the username claimed at sign-up", async ({ page }) => {
    const user = freshUser("handle");
    await signUp(page, user);
    await page.context().clearCookies();

    await clearAuthRateLimits();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(user.username);
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("the username is case-insensitive at sign-in", async ({ page }) => {
    const user = freshUser("upper");
    await signUp(page, user);
    await page.context().clearCookies();

    await clearAuthRateLimits();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(user.username.toUpperCase());
    await page.locator('input[name="password"]').fill(user.password);
    await page.locator('button[name="intent"]').click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("an unknown username is refused in the very same words as a wrong password", async ({
    page,
  }) => {
    // The handle is public, so if "no such handle" read any differently from
    // "wrong password" the login box would confirm which handles are real.
    const user = freshUser("sameword");
    await signUp(page, user);
    await page.context().clearCookies();

    async function attempt(identifier: string, password: string) {
      await clearAuthRateLimits();
      await page.goto("/login");
      await page.locator('input[name="identifier"]').fill(identifier);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('button[name="intent"]').click();
      const alert = page.getByRole("alert").first();
      await expect(alert).toBeVisible();
      return (await alert.textContent())?.trim() ?? "";
    }

    const wrongPassword = await attempt(user.email, "not-the-password");
    const unknownHandle = await attempt("nobodyholdsthishandle", user.password);
    const unknownEmail = await attempt("nobody@e2e.squareshare.to", user.password);

    expect(unknownHandle).toBe(wrongPassword);
    expect(unknownEmail).toBe(wrongPassword);
    await expect(page).toHaveURL(/\/login/);
  });

  test("a username someone already holds cannot be claimed again", async ({ page }) => {
    const first = freshUser("holder");
    await signUp(page, first);
    await page.context().clearCookies();

    const second = freshUser("taker");
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="identifier"]').fill(second.email);
    await page.locator('input[name="username"]').fill(first.username);
    await page.locator('input[name="password"]').fill(second.password);
    await page.locator('input[name="confirm_password"]').fill(second.password);
    await page.locator('button[name="intent"]').click();

    await expect(page.getByRole("alert").filter({ hasText: /taken/i })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // And no account was created for that address: it is still free to sign up.
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.locator('input[name="identifier"]').fill(second.email);
    await page.locator('input[name="password"]').fill(second.password);
    await page.locator('button[name="intent"]').click();
    await expect(
      page.getByRole("alert").filter({ hasText: /incorrect email or password/i }),
    ).toBeVisible();
  });

  test("a reserved username is refused at sign-up", async ({ page }) => {
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="identifier"]').fill(freshUser("reserved").email);
    await page.locator('input[name="username"]').fill("support");
    await page.locator('input[name="password"]').fill("e2e-password-123");
    await page.locator('input[name="confirm_password"]').fill("e2e-password-123");
    await page.locator('button[name="intent"]').click();

    await expect(page.getByRole("alert").filter({ hasText: /reserved/i })).toBeVisible();
  });

  test("keeps the session out of web storage entirely", async ({ page, context }) => {
    // auth-js's default home for a session is localStorage, which every script
    // on the origin can read: one XSS and a long-lived refresh token walks out.
    // The session belongs in an HttpOnly cookie the browser cannot read.
    const user = freshUser("storage");
    await signUp(page, user);

    const stored = await page.evaluate(() => {
      const read = (s: Storage) =>
        Object.fromEntries(
          Array.from({ length: s.length }, (_, i) => s.key(i)!).map((k) => [
            k,
            String(s.getItem(k)),
          ]),
        );
      return {
        local: read(window.localStorage),
        session: read(window.sessionStorage),
        jsCookies: document.cookie,
      };
    });

    const entries = [
      ...Object.entries(stored.local),
      ...Object.entries(stored.session),
    ]
      // Next's dev server parks an RSC debug channel in sessionStorage whose
      // payload embeds unrelated base64. It is written by the dev server, never
      // by auth-js, and does not exist in a production build — so it is skipped
      // by NAME rather than by loosening what counts as a token.
      .filter(([key]) => !key.startsWith("__next"));

    // `sb-*` is the key auth-js would use; access_token/refresh_token are the
    // fields of the session envelope it would store under it.
    for (const [key, value] of entries) {
      expect(key.startsWith("sb-"), `storage key ${key}`).toBe(false);
      expect(value, `value of ${key}`).not.toMatch(/access_token|refresh_token/i);
      expect(value, `value of ${key}`).not.toMatch(/eyJ[A-Za-z0-9_-]{20}\./); // a real JWT
    }
    expect(stored.jsCookies).not.toMatch(/sb-|access_token|refresh_token/i);

    // ...and the session really is present, just out of JavaScript's reach.
    const authCookie = (await context.cookies()).find((c) => c.name.startsWith("sb-"));
    expect(authCookie?.httpOnly, "auth cookie must be HttpOnly").toBe(true);
  });

  test("refuses a weak password at sign-up", async ({ page }) => {
    const user = freshUser("weakpw");
    await clearAuthRateLimits();
    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="identifier"]').fill(user.email);
    await page.locator('input[name="username"]').fill(user.username);
    for (const field of ["password", "confirm_password"]) {
      await page.locator(`input[name="${field}"]`).fill("password123");
    }
    await page.locator('button[name="intent"]').click();

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("mismatched signup passwords are rejected client→server", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="identifier"]').fill(freshUser("mismatch").email);
    await page.locator('input[name="password"]').fill("password-one-1");
    await page.locator('input[name="confirm_password"]').fill("password-two-2");
    await page.locator('button[name="intent"]').click();
    await expect(page.getByRole("alert").filter({ hasText: /do not match/i })).toBeVisible();
  });
});
