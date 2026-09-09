import { expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  seedProducts,
  PUBLISHABLE_SELLER,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// Safety and compliance (GPSR: manufacturer/importer identity and warnings)
// and Seller (the trader identity distance-selling law puts next to the
// offer) are legal disclosures, not a design choice — see
// MANDATORY_PRODUCT_PAGE_SECTION_IDS in lib/storefront/product-page.ts. This
// is the end-to-end guarantee: even a storefront config saved with both
// switches off (the "hostile config" a stale client, a direct API write, or a
// bug elsewhere could produce) must still print both on the live page a
// buyer gets, and the editor must not offer a switch that looks like it could
// turn them off in the first place.

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

async function seed(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const [storefront] = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefront!.id;

  await seedProducts(sellerId, [
    {
      title: "Oak lamp",
      price_cents: 12900,
      // GPSR safety block: manufacturer identity and a warning.
      details: {
        materials: "Oak",
        safety: {
          manufacturerName: "Lamp Works BV",
          manufacturerAddress: "1 Kade St, Rotterdam",
          manufacturerEmail: "safety@lampworks.example",
          warnings: "Keep away from open flame.",
        },
      },
      purchase_url: "https://shop.example.com/lamp",
    },
  ]);
  const [product] = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const productId = product!.id;

  // The address is required too, or the publish gate 404s the page below.
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);

  // THE HOSTILE CONFIG: both legal sections explicitly switched off. Written
  // straight to the row, the way a stale client or a direct API call would,
  // to prove the guarantee holds independent of the editor UI.
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [{ type: "product", productId, x: 0, y: 0, w: 2, h: 2 }],
        // A COMPLETE, schema-valid productPage object: the schema is
        // strictObject (lib/validation/storefront.ts), so a config missing
        // any of these fields fails to parse and the whole member is dropped
        // in favour of DEFAULT_PRODUCT_PAGE_CONFIG — which would make this
        // seed pass for the wrong reason (the defaults show everything
        // anyway) rather than actually exercising the override.
        productPage: {
          enabled: true,
          imageFit: "contain",
          ctaLabel: "Buy now",
          priceNote: "incl-vat",
          shippingNote: "plus-shipping",
          showStock: true,
          showSeller: true,
          allowIndexing: false,
          sections: [
            { id: "description", show: true },
            { id: "specs", show: true },
            { id: "documents", show: true },
            { id: "shipping", show: true },
            { id: "returns", show: true },
            { id: "safety", show: false },
            { id: "seller", show: false },
          ],
        },
      },
    },
  });

  return { sellerId, storefrontId, productId };
}

test("safety and seller stay on the live page even when a stored config turns both off", async ({
  page,
}) => {
  const s = await seed(page, "legal-sections");
  // A buyer has no session. Drop the seller's cookies to be sure this is the
  // page an anonymous buyer gets, not something the seller's own session
  // renders differently.
  await page.context().clearCookies();

  await page.goto(`/s/${s.storefrontId}/p/${s.productId}`);

  const sellerBlock = page.locator("[data-product-section='seller']");
  await expect(sellerBlock).toBeVisible();
  await expect(sellerBlock.getByText("Lamp Studio Ltd")).toBeVisible();

  const safetySection = page.locator("[data-product-section='safety']");
  await expect(safetySection).toHaveCount(1);
  if (!(await safetySection.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await safetySection.locator("summary").click();
  }
  await expect(safetySection.getByText("Lamp Works BV")).toBeVisible();
  await expect(safetySection.getByText("Keep away from open flame.")).toBeVisible();
});

// The editor panel's own lock (the switch rendered disabled and checked,
// regardless of the stored config) is covered at the component level in
// tests/component/product-page-section.test.tsx, where the exact panel
// navigation is not needed to reach the switches directly.
