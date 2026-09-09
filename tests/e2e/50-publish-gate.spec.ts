import { expect, test } from "@playwright/test";
import {
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

    // --- the warning is in the chrome, on whatever page they are on ---
    await gotoApp(page, "/dashboard");
    const banner = page.getByRole("note", { name: /seller details required/i });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/can't publish or sell/i);
    // It names what is missing rather than sending them off to hunt for it.
    await expect(banner).toContainText(/trader name/i);
    await expect(banner).toContainText(/business address/i);
    await expect(banner).toContainText(/contact email/i);

    // Still there two navigations later: it is a standing condition, not a
    // one-off notice on the overview.
    await gotoApp(page, "/products");
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
    await page.getByLabel(/Contact email/).fill("hello@squareshare.eu");
    await page.getByRole("button", { name: "Save" }).click();
    await expectToast(page, /Business & seller details saved/i);

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
    await page.getByLabel("Address").fill("12 Market Street");

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

    // And a real one goes through.
    await email.fill("hello@squareshare.eu");
    await save.click();
    await expectToast(page, /Business & seller details saved/i);
  });
});
