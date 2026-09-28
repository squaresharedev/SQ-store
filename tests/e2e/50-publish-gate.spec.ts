import { expect, test } from "@playwright/test";
import {
  clearContactCooldown,
  confirmContactCode,
  contactCode,
  expectToast,
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { passwordToken, restAs } from "./two-factor";

/**
 * THE PUBLISH GATE, end to end.
 *
 * A seller who has not told buyers who they are and how to reach them cannot
 * put anything on sale. That is a legal requirement (EU Consumer Rights
 * Directive Art. 6(1)(b)-(c): identity, geographic address and contact details,
 * given before the buyer is bound), so it is enforced rather than suggested —
 * and this spec walks both halves of that enforcement:
 *
 *   the WRITE side  — the seller is told, in the chrome and on the form, and
 *                     the "Active" control is not on offer;
 *   the READ side   — a page that WAS live stops being served the moment the
 *                     details behind it go away.
 *
 * The second half is the one that matters most, because it is the one a
 * determined seller cannot route around: it does not care how the row reached
 * `active`, only whether the seller can be identified today.
 */

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 0,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

test.describe("the publish gate", () => {
  test("a seller with no trader details is told, and cannot set a product live", async ({
    page,
  }) => {
    await signUp(page, freshUser("gate-warn"));

    // --- Overview states it as the first setup step, not as a red strip ---
    // The welcome flow and the "Get set up" checklist carry the gate there, so
    // a new seller's first screen is a step to take rather than an error.
    await gotoApp(page, "/dashboard");
    await expect(
      page.locator('[data-setup-step="seller-details"]'),
    ).toHaveAttribute("data-setup-state", "todo");
    await expect(
      page.getByRole("note", { name: /seller details required/i }),
    ).toHaveCount(0);

    // --- everywhere else, the warning is in the chrome ---
    await gotoApp(page, "/products");
    const banner = page.getByRole("note", { name: /seller details required/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/can't publish or sell/i);
    // It names what is missing rather than sending them off to hunt for it.
    await expect(banner).toContainText(/trader name/i);
    await expect(banner).toContainText(/business address/i);
    await expect(banner).toContainText(/contact email/i);

    // Still there on the next page: it is a standing condition, not a one-off
    // notice.
    await gotoApp(page, "/orders");
    await expect(
      page.getByRole("note", { name: /seller details required/i }),
    ).toBeVisible();

    // --- the product form does not offer "Active" ---
    await gotoApp(page, "/products/new");
    const status = page.locator('[data-product-field="status"]');
    await expect(status).toHaveAttribute("data-product-value", "draft");
    await expect(status.getByRole("button", { name: "Active" })).toBeDisabled();
    await expect(
      page.getByText(/can't put this product on sale until your seller details/i),
    ).toBeVisible();

    // --- and the button in the warning lands on the field that fixes it ---
    await banner.getByRole("link", { name: /add seller details/i }).click();
    await page.waitForURL(/\/settings\/tax/, { timeout: 30_000 });
    await expect(page.getByLabel(/Trader name/)).toBeVisible();
  });

  test("filling the details in lifts the gate, and clearing one puts it back", async ({
    page,
  }) => {
    // A long walk: save, code, resend, a wrong code, a right one, then a live
    // page taken down. On a cold stack every page compiles on first visit.
    test.setTimeout(120_000);
    const user = freshUser("gate-lift");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    // --- fill the three required fields on the real settings form ---
    await gotoApp(page, "/settings/tax");
    await page.getByLabel(/Trader name/).fill("Gate Studio Ltd");
    await page.getByLabel("Address").fill("12 Market Street\nDublin\nIreland");
    // squareshare.eu, because the save asks a public resolver whether the
    // domain takes mail at all and a made-up one would be refused. (That check
    // fails OPEN when the resolver cannot be reached, so this still passes on
    // a machine with no network.)
    const contact = "hello@squareshare.eu";
    await page.getByLabel(/Contact email/).fill(contact);
    await page.getByRole("button", { name: "Save" }).click();
    await expectToast(page, /We emailed a code to hello@squareshare\.eu/i);

    // --- TYPED IS NOT PROVEN: the gate is still down ---
    // Every required field is filled in, and the seller still cannot publish,
    // because the address has not been proven. This is the whole point of the
    // code: an address nobody reads is not a contact.
    await gotoApp(page, "/products/new");
    await expect(
      page.locator('[data-product-field="status"]').getByRole("button", { name: "Active" }),
    ).toBeDisabled();

    // The settings page reopens on the code box: the code the save sent is
    // still live, so the page does not offer to send another.
    await gotoApp(page, "/settings/tax");
    const row = page.locator('[data-contact-verification="email"]');
    await expect(row).toHaveAttribute("data-proof-state", "awaitingCode");
    const firstCode = await contactCode("email", contact);

    // --- one code a minute: a double-click is not two emails ---
    const resend = row.getByRole("button", { name: /send a new code/i });
    await resend.click();
    await expectToast(page, /code was just sent/i);

    // --- the recovery path: a new code REPLACES the old one ---
    // A seller whose first mail went astray must not be stuck, and a resend
    // must kill what it replaces, or every lost email would leave another
    // live credential lying around.
    await clearContactCooldown(sellerId);
    const beforeResend = new Date().toISOString();
    await resend.click();
    await expectToast(page, /We emailed a code to hello@squareshare\.eu/i);
    const secondCode = await contactCode("email", contact, beforeResend);
    expect(secondCode).not.toBe(firstCode);

    await row.getByLabel("Confirmation code").fill(firstCode);
    await expectToast(page, /code isn't right/i);
    await expect(row).toHaveAttribute("data-proof-state", "awaitingCode");

    // --- the live code proves the address (the dev outbox stands in for mail) ---
    await confirmContactCode(page, "email", secondCode);
    await expectToast(page, /Contact email confirmed/i);
    await expect(row).toContainText(/Confirmed\. Buyers can reach you here/i);

    // --- the warning is gone and "Active" is back on offer ---
    await gotoApp(page, "/products/new");
    await expect(
      page.getByRole("note", { name: /seller details required/i }),
    ).toHaveCount(0);
    const status = page.locator('[data-product-field="status"]');
    await expect(status).toHaveAttribute("data-product-value", "active");
    await expect(status.getByRole("button", { name: "Active" })).toBeEnabled();

    // --- a live page, built the normal way ---
    await seedStorefronts(sellerId, [{ name: "Gate studio" }]);
    const [storefront] = (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    await seedProducts(sellerId, [
      { title: "Oak lamp", price_cents: 12900, purchase_url: "https://example.com/lamp" },
    ]);
    const [product] = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    await serviceRest(`/storefronts?id=eq.${storefront!.id}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: product!.id, x: 0, y: 0, w: 2, h: 2 }],
        },
      },
    });

    const buyerUrl = `/s/${storefront!.id}/p/${product!.id}`;
    await page.context().clearCookies(); // a buyer has no session
    await page.goto(buyerUrl);
    await expect(page.getByRole("heading", { name: "Oak lamp" })).toBeVisible();

    // --- THE POINT: take the contact email away and the page stops selling ---
    // Written straight to the row, the way a direct API call or a future admin
    // action would, so the refusal cannot depend on the form having been used.
    await seedSellerIdentity(sellerId, {
      ...PUBLISHABLE_SELLER,
      businessName: "Gate Studio Ltd",
      email: undefined,
    });

    const response = await page.goto(buyerUrl);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Oak lamp" })).toHaveCount(0);
  });

  test("the contact email has to be one a buyer could actually write to", async ({
    page,
  }) => {
    await signUp(page, freshUser("gate-email"));
    await gotoApp(page, "/settings/tax");
    await page.getByLabel(/Trader name/).fill("Gate Studio Ltd");
    await page.getByLabel("Address").fill("12 Market Street\nDublin");

    const email = page.getByLabel(/Contact email/);
    const save = page.getByRole("button", { name: "Save" });

    // A placeholder: shaped like an address, reaches nobody.
    await email.fill("hello@example.com");
    await save.click();
    await expectToast(page, /placeholder/i);

    // A throwaway inbox: reaches somebody, for about ten minutes.
    await email.fill("someone@mailinator.com");
    await save.click();
    await expectToast(page, /temporary-mail/i);

    // A no-reply address: the one thing a published contact address must not be.
    await email.fill("no-reply@squareshare.eu");
    await save.click();
    await expectToast(page, /placeholder/i);

    // And a real one goes through, and is only ASSERTED at this point, not
    // proven: the save says a code is on its way, which is a different (and
    // weaker) claim than "confirmed".
    await email.fill("hello@squareshare.eu");
    await save.click();
    await expectToast(page, /We emailed a code to hello@squareshare\.eu/i);
  });

  test("the address has to be a real one too", async ({ page }) => {
    await signUp(page, freshUser("gate-address"));
    await gotoApp(page, "/settings/tax");
    await page.getByLabel(/Trader name/).fill("Gate Studio Ltd");
    await page.getByLabel(/Contact email/).fill("hello@squareshare.eu");
    const address = page.getByLabel("Address");
    const save = page.getByRole("button", { name: "Save" });

    await address.fill("123 Fake Street\nSpringfield");
    await save.click();
    await expectToast(page, /looks like a placeholder/i);

    await address.fill("Dublin");
    await save.click();
    await expectToast(page, /full postal address/i);

    // A short real address is not a fake one: it saves.
    await address.fill("PO Box 12, 1010 Wien");
    await save.click();
    await expectToast(page, /We emailed a code to hello@squareshare\.eu/i);
  });

  test("a phone number is shown to buyers only once it is proven", async ({ page }) => {
    const user = freshUser("gate-phone");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // A publishable seller with NO phone yet, so the page is live.
    await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
    await seedStorefronts(sellerId, [{ name: "Phone studio" }]);
    const [storefront] = (await serviceRest(
      `/storefronts?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    await seedProducts(sellerId, [
      { title: "Oak lamp", price_cents: 12900, purchase_url: "https://example.com/lamp" },
    ]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as {
      id: string;
    }[];
    await serviceRest(`/storefronts?id=eq.${storefront!.id}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: product!.id, x: 0, y: 0, w: 2, h: 2 }],
        },
      },
    });

    await gotoApp(page, "/settings/tax");
    const phone = page.getByLabel("Phone", { exact: true });
    const save = page.getByRole("button", { name: "Save" });

    // --- only a number that can be PROVEN is accepted at all ---
    await phone.fill("+44 20 7946 0000"); // a London landline: cannot take a text
    await save.click();
    await expectToast(page, /Use a mobile number/i);
    await phone.fill("+1 202 555 0143"); // outside the SMS regions
    await save.click();
    await expectToast(page, /EU, the EEA, Switzerland and the UK/i);
    await phone.fill("+353 87 000"); // not a number anywhere
    await save.click();
    await expectToast(page, /doesn't exist/i);

    // --- a real mobile: saved in one canonical form, and texted a code ---
    await phone.fill("087 123 4567"); // national form, read in the seller's country (IE)
    await save.click();
    await expectToast(page, /We texted a code to \+353 87 123 4567/i);
    await expect(phone).toHaveValue("+353 87 123 4567");
    const saved = (await serviceRest(`/profiles?id=eq.${sellerId}&select=seller_phone`)) as {
      seller_phone: string;
    }[];
    expect(saved[0]!.seller_phone).toBe("+353871234567");

    // --- unproven, it is not on the buyer page ---
    const buyerUrl = `/s/${storefront!.id}/p/${product!.id}`;
    const buyer = await page.context().browser()!.newPage();
    await buyer.goto(buyerUrl);
    const sellerBlock = buyer.locator("[data-product-section='seller']");
    await expect(sellerBlock).toBeVisible();
    await expect(sellerBlock.getByText("+353 87 123 4567")).toHaveCount(0);

    // --- proven, it is ---
    await confirmContactCode(page, "phone", await contactCode("sms", "+353871234567"));
    await expectToast(page, /Phone number confirmed/i);
    await buyer.goto(buyerUrl);
    await expect(sellerBlock.getByText("+353 87 123 4567")).toBeVisible();
    await buyer.close();
  });

  test("a proof cannot be forged or carried over through the API", async ({ page }) => {
    const user = freshUser("gate-forge");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, emailVerified: false });
    const { access_token: token } = await passwordToken(user.email, user.password);

    // The seller's own session token, straight at the REST API: the app is
    // not the only client of this database, so the rule has to hold here.
    const forge = await restAs(token, `/profiles?id=eq.${sellerId}`, {
      method: "PATCH",
      body: { seller_email_verified_at: new Date().toISOString() },
    });
    expect(forge.status).toBe(403);

    // Prove an address honestly, then swap it for somebody else's in one
    // direct write: the proof must not travel with it.
    await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER); // proven
    const swap = await restAs(token, `/profiles?id=eq.${sellerId}`, {
      method: "PATCH",
      body: { seller_email: "ceo@squareshare.eu" },
    });
    expect(swap.status).toBe(200);
    const [row] = (await serviceRest(
      `/profiles?id=eq.${sellerId}&select=seller_email,seller_email_verified_at`,
    )) as { seller_email: string; seller_email_verified_at: string | null }[];
    expect(row).toEqual({ seller_email: "ceo@squareshare.eu", seller_email_verified_at: null });

    // And the code store is invisible to the seller altogether.
    const codes = await restAs(token, `/contact_verifications?select=*`);
    expect([401, 403, 404]).toContain(codes.status);
  });
});
