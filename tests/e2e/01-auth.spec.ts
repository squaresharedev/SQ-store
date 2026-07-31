import { expect, test } from "@playwright/test";
import { freshUser, signIn, signUp } from "./helpers";

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
    await page.locator('input[name="email"]').fill(user.email);
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
    await page.locator('input[name="email"]').fill(user.email);
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

  test("mismatched signup passwords are rejected client→server", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /sign up/i }).click();
    await page.locator('input[name="email"]').fill(freshUser("mismatch").email);
    await page.locator('input[name="password"]').fill("password-one-1");
    await page.locator('input[name="confirm_password"]').fill("password-two-2");
    await page.locator('button[name="intent"]').click();
    await expect(page.getByRole("alert").filter({ hasText: /do not match/i })).toBeVisible();
  });
});
