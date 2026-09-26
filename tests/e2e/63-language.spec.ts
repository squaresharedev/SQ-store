import { expect, test } from "@playwright/test";
import { freshUser, gotoApp, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * THE LANGUAGE TAB.
 *
 * The UI language has its own tab in Settings. Switching it has to do four
 * things at once, and a regression in any one is invisible from the others:
 * the page re-renders in the new language, <html lang> follows it, this
 * browser remembers the choice (the ss_locale cookie), and the account
 * remembers it too (profiles.locale), so it follows the seller to a new
 * browser at their next sign-in.
 */

test("Settings has a Language tab that switches the whole UI and is remembered", async ({
  page,
  context,
}) => {
  const user = freshUser("language");
  await signUp(page, user);

  // The picker is its own tab, not a card on Account.
  await gotoApp(page, "/settings/account");
  await expect(page.getByRole("heading", { level: 2, name: "Language" })).toHaveCount(0);

  // Located by href, not by the rail's accessible name: that name is itself
  // translated ("Sekce nastavení" in Czech), so a name match would only work in
  // English.
  const languageTab = page.locator('aside nav a[href="/settings/language"]');
  await expect(languageTab).toHaveText("Language");
  await languageTab.click();
  await expect(page).toHaveURL(/\/settings\/language$/);
  await expect(page.getByRole("heading", { level: 1, name: "Language" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/Language settings/);

  // Switch to Czech.
  await page.locator("#language").click();
  await page.getByRole("option", { name: "Čeština" }).click();
  // The switch plays behind the language overlay, which leaves on its own
  // once the page is in Czech. Its status line is read out in whichever
  // language the page is in at that moment, so only the target name is fixed.
  const overlay = page.locator("[data-language-switch-overlay]");
  await expect(overlay.getByRole("status")).toContainText("Čeština");
  await expect(overlay).toHaveCount(0, { timeout: 20_000 });

  await expect(page.locator("html")).toHaveAttribute("lang", "cs", { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Jazyk" })).toBeVisible();
  await expect(page).toHaveTitle(/Nastavení jazyka/);
  await expect(languageTab).toHaveText("Jazyk");

  // This browser remembers it...
  const cookie = (await context.cookies()).find((c) => c.name === "ss_locale");
  expect(cookie?.value).toBe("cs");
  expect(cookie?.httpOnly).toBe(true);

  // ...and so does the account.
  const id = await userIdByEmail(user.email);
  const rows = (await serviceRest(`/profiles?id=eq.${id}&select=locale`)) as { locale: string | null }[];
  expect(rows[0]?.locale).toBe("cs");

  // A reload, and another page, stay in Czech.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  await gotoApp(page, "/dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");

  // Back to English through the same control.
  await gotoApp(page, "/settings/language");
  await page.locator("#language").click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Language" })).toBeVisible();
});
