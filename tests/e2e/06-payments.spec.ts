import { expect, test } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

/**
 * Payments page security contract (the layer is a Stripe-shaped MOCK):
 *   - the page makes ZERO requests to any non-local host (nothing can reach
 *     api.stripe.com or anywhere else),
 *   - no input collects card/bank data anywhere in the flow,
 *   - the mock renders demo data with masked identifiers only.
 */
test.describe("payments (mock layer)", () => {
  test("no external network traffic, no sensitive inputs", async ({ page }) => {
    const external: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const local =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (!local) {
        external.push(url.toString());
        return route.abort();
      }
      return route.fallback();
    });

    const user = freshUser("payments");
    await signUp(page, user);
    await gotoApp(page, "/payments");

    await expect(page.getByText(/available/i).first()).toBeVisible();

    // Open every payments dialog that exists and poke the stub buttons.
    for (const name of [/manage|payout method/i, /connect/i]) {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.keyboard.press("Escape");
      }
    }
    // Open a payout detail if the history renders rows.
    const payoutRow = page.getByRole("button", { name: /payout/i }).first();
    if (await payoutRow.isVisible().catch(() => false)) {
      await payoutRow.click();
      await page.keyboard.press("Escape");
    }

    // 1. Zero external requests.
    expect(external, `external requests: ${external.join(", ")}`).toEqual([]);

    // 2. No sensitive financial input fields anywhere in the DOM.
    const sensitive = await page
      .locator(
        'input[name*="card" i], input[name*="cvc" i], input[name*="cvv" i], ' +
          'input[name*="routing" i], input[name*="iban" i], input[name*="ssn" i], ' +
          'input[name*="account_number" i], input[autocomplete="cc-number"]',
      )
      .count();
    expect(sensitive).toBe(0);

    // 3. Only masked identifiers are shown. Scan the RENDERED, visible text
    //    (innerText, not the RSC/script payload) for a bare 13-19 digit run
    //    that would look like a full PAN/IBAN.
    const visible = await page.evaluate(() => document.body.innerText);
    const digitRuns = visible.match(/\d{13,}/g) ?? [];
    expect(digitRuns, `long digit runs in visible text: ${digitRuns.join(", ")}`).toEqual([]);
  });
});
