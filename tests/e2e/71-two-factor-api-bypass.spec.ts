import { expect, test } from "@playwright/test";
import { freshUser, seedOrders, seedProducts, signUp, userIdByEmail } from "./helpers";
import { enableTwoFactor, nextCode, passwordToken, restAs, verifiedToken } from "./two-factor";

/**
 * The attack 2FA exists for, played straight against the API: someone has
 * phished the password, and the anon key is public. They never load a page;
 * they ask GoTrue for a token and talk to PostgREST directly. The app's own
 * gate never sees them, so the DATABASE has to refuse (the restrictive
 * "Require two-factor when enrolled" policies), through the real PostgREST
 * engine and the real JWT claims.
 */

test.describe.configure({ timeout: 180_000 });

test.describe("two-factor API bypass attempts", () => {
  test("a password-only token reads and writes NOTHING of a 2FA account; a verified one works", async ({
    browser,
  }) => {
    const user = freshUser("apibypass");
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUp(page, user);
    const id = await userIdByEmail(user.email);
    await seedProducts(id, [{ title: "Private draft", status: "draft" }]);
    await seedOrders(id, [{ amount_cents: 4200, buyer_email: "buyer@private.example" }]);
    const { app } = await enableTwoFactor(page, user.password);

    // The phished password buys an aal1 token straight from GoTrue.
    const stolen = await passwordToken(user.email, user.password);
    const factorId = stolen.user.factors?.find((f) => f.status === "verified")?.id;
    expect(factorId).toBeTruthy();

    for (const path of [
      `/profiles?id=eq.${id}&select=id,seller_email,seller_address,tax_vat_id`,
      `/products?owner_id=eq.${id}&select=id,title`,
      `/orders?seller_id=eq.${id}&select=id,buyer_email`,
      `/notifications?user_id=eq.${id}&select=id,title`,
      `/security_events?user_id=eq.${id}&select=event`,
      `/team_members?account_owner_id=eq.${id}&select=id`,
      `/storefronts?owner_id=eq.${id}&select=id`,
    ]) {
      const res = await restAs(stolen.access_token, path);
      expect(res.status, path).toBe(200);
      expect(res.json, path).toEqual([]);
    }

    // Writes go nowhere either.
    const rename = await restAs(stolen.access_token, `/products?owner_id=eq.${id}`, {
      method: "PATCH",
      body: { title: "pwned" },
    });
    expect(rename.json).toEqual([]);
    const inject = await restAs(stolen.access_token, `/products`, {
      method: "POST",
      body: { owner_id: id, title: "Injected", price_cents: 100, currency: "EUR", status: "draft" },
    });
    expect(inject.status).toBe(403);
    const bio = await restAs(stolen.access_token, `/profiles?id=eq.${id}`, {
      method: "PATCH",
      body: { seller_bio: "pwned" },
    });
    expect(bio.json).toEqual([]);

    // Recovery codes are out of reach for every client token, verified or not.
    const codes = await restAs(stolen.access_token, `/mfa_recovery_codes?select=code_hash`);
    expect(codes.status).toBeGreaterThanOrEqual(400);

    // With the phone as well (aal2), the same token holder sees everything.
    const verified = await verifiedToken(stolen.access_token, factorId!, await nextCode(app));
    const products = await restAs(verified, `/products?owner_id=eq.${id}&select=title`);
    expect(products.json).toEqual([{ title: "Private draft" }]);
    const orders = await restAs(verified, `/orders?seller_id=eq.${id}&select=buyer_email`);
    expect(orders.json).toEqual([{ buyer_email: "buyer@private.example" }]);
    const stillCodes = await restAs(verified, `/mfa_recovery_codes?select=code_hash`);
    expect(stillCodes.status).toBeGreaterThanOrEqual(400);
    await context.close();
  });

  test("an account WITHOUT 2FA keeps working with a password-only token (no regression)", async ({ browser }) => {
    const user = freshUser("apiplain");
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUp(page, user);
    const id = await userIdByEmail(user.email);
    await seedProducts(id, [{ title: "Visible draft", status: "draft" }]);

    const token = await passwordToken(user.email, user.password);
    const products = await restAs(token.access_token, `/products?owner_id=eq.${id}&select=title`);
    expect(products.json).toEqual([{ title: "Visible draft" }]);
    await context.close();
  });
});
