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
 * SELLER BIO, end to end: typed in Settings › Account (right under the
 * username, not with the trader identity in Business & seller details),
 * stored on the profile, shown in the Seller section of a live product page.
 *
 * Three things are proven against real data rather than mocks:
 *   - the bio is optional: a seller with none still has a live page, and
 *     clearing it takes nothing down;
 *   - hostile-looking text survives as TEXT: markup is printed, not parsed,
 *     and SQL-looking text is stored verbatim (the writes are parameterised);
 *   - the DB CHECK refuses what the form would, for writes that skip it.
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

const HOSTILE_BIO = `<b>Oak</b> lamps & "shades"'; drop table profiles; --`;

async function storedBio(sellerId: string): Promise<string | null> {
  const rows = (await serviceRest(
    `/profiles?id=eq.${sellerId}&select=seller_bio`,
  )) as { seller_bio: string | null }[];
  return rows[0]!.seller_bio;
}

test.describe("seller bio", () => {
  test("is optional, saved from Settings and shown to buyers as plain text", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const user = freshUser("bio");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // A contact address the save's reachability check accepts (see
    // 60-onboarding.spec.ts), seeded as confirmed. No bio.
    await seedSellerIdentity(sellerId, {
      ...PUBLISHABLE_SELLER,
      email: "hello@squareshare.eu",
    });

    // --- a live page with no bio at all ---
    await seedStorefronts(sellerId, [{ name: "Bio studio" }]);
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
    const buyer = await page.context().browser()!.newContext();
    const buyerPage = await buyer.newPage();
    const noBio = await buyerPage.goto(buyerUrl);
    expect(noBio?.status()).toBe(200);
    await expect(buyerPage.getByRole("heading", { name: "Oak lamp" })).toBeVisible();

    // --- the field: capped at 100, counting down, living under the username ---
    await gotoApp(page, "/settings/account");
    const usernameField = page.getByLabel("Username", { exact: true });
    const bioCard = page.locator("#bio");
    const bio = page.getByLabel("Bio", { exact: true });
    const saveBio = () => bioCard.getByRole("button", { name: "Save" }).click();
    await expect(bio).toHaveValue("");
    await expect(bio).toHaveAttribute("maxlength", "100");
    await expect(page.locator("#seller-bio-count")).toHaveText("100 characters left");
    // The bio card sits below the username card, not inside Business & seller
    // details.
    const usernameBox = await usernameField.boundingBox();
    const bioBox = await bio.boundingBox();
    expect(bioBox!.y).toBeGreaterThan(usernameBox!.y);

    await bio.fill(HOSTILE_BIO);
    await expect(page.locator("#seller-bio-count")).toHaveText(
      `${100 - HOSTILE_BIO.length} characters left`,
    );
    await saveBio();
    await expectToast(page, "Bio saved.");
    expect(await storedBio(sellerId)).toBe(HOSTILE_BIO);

    // --- the buyer sees it, as text ---
    await buyerPage.goto(buyerUrl);
    const sellerSection = buyerPage.locator("address").filter({ hasText: "Lamp Studio Ltd" });
    await expect(sellerSection.getByText(HOSTILE_BIO, { exact: true })).toBeVisible();
    await expect(sellerSection.locator("b")).toHaveCount(0);
    const jsonLd = JSON.parse(
      (await buyerPage.locator("#product-jsonld").textContent()) ?? "{}",
    ) as { offers: { seller: { description?: string } } };
    expect(jsonLd.offers.seller.description).toBe(HOSTILE_BIO);

    // --- clearing it stores null and the page stays live ---
    await bio.fill("");
    await expect(page.locator("#seller-bio-count")).toHaveText("100 characters left");
    await saveBio();
    // Polled: the first save's identical toast may still be on screen, so it
    // cannot be what says this second save has landed.
    await expect.poll(() => storedBio(sellerId), { timeout: 20_000 }).toBeNull();
    const cleared = await buyerPage.goto(buyerUrl);
    expect(cleared?.status()).toBe(200);
    await expect(buyerPage.getByText(HOSTILE_BIO)).toHaveCount(0);

    // --- the database refuses what the form would, for writes that skip it ---
    for (const seller_bio of ["x".repeat(101), `line${String.fromCharCode(10)}break`, ""]) {
      await expect(
        serviceRest(`/profiles?id=eq.${sellerId}`, {
          method: "PATCH",
          body: { seller_bio },
        }),
      ).rejects.toThrow();
    }
    await buyer.close();
  });
});
