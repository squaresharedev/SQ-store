import { expect, test } from "@playwright/test";
import { clearAuthRateLimits, freshUser, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * A signed-out visitor who opens a link to one page of the dashboard comes
 * back to THAT page after signing in, query included (src/middleware.ts
 * records it, requireUser carries it through /login?next=).
 */

async function signInOnTheForm(page: import("@playwright/test").Page, email: string, password: string) {
  await clearAuthRateLimits();
  await page.locator('input[name="identifier"], input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="intent"]').click();
}

test.describe("deep links survive sign-in", () => {
  test("one product's editor, and a filtered list, come back exactly", async ({ page }) => {
    const user = freshUser("deeplink");
    await signUp(page, user);
    const ownerId = await userIdByEmail(user.email);
    await seedProducts(ownerId, [{ title: "Deep link lamp" }]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${ownerId}&select=id`)) as { id: string }[];

    // Signed out, a link straight to one product.
    await page.context().clearCookies();
    const editor = `/products/${product.id}/edit`;
    await page.goto(editor);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(editor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await signInOnTheForm(page, user.email, user.password);
    await page.waitForURL(`**${editor}`, { timeout: 30_000 });
    await expect(page.getByRole("textbox", { name: /title/i }).first()).toHaveValue("Deep link lamp");

    // Signed out again, a list with its query.
    await page.context().clearCookies();
    await page.goto("/orders?view=all&status=paid");
    await expect(page).toHaveURL(/\/login\?next=%2Forders%3Fview%3Dall%26status%3Dpaid$/);
    await signInOnTheForm(page, user.email, user.password);
    await page.waitForURL(/\/orders\?view=all&status=paid$/, { timeout: 30_000 });
  });

  test("a forged return header cannot choose where sign-in leads", async ({ request }) => {
    const response = await request.get("/orders", {
      headers: { "x-sq-requested-path": "//evil.example/steal" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/^\/login\?next=%2Forders$/);
  });

  test("an off-site next is still refused after signing in", async ({ page }) => {
    const user = freshUser("deepnext");
    await signUp(page, user);
    await page.context().clearCookies();
    await page.goto("/login?next=%2F%2Fevil.example%2Fsteal");
    await signInOnTheForm(page, user.email, user.password);
    await page.waitForURL(/localhost:\d+\/(dashboard)?$/, { timeout: 30_000 });
    expect(new URL(page.url()).host).toMatch(/^localhost:\d+$/);
  });
});
