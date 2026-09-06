import { expect, test, type Page } from "@playwright/test";
import {
  expectToast,
  freshUser,
  gotoApp,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// PER-VERSION SPECIFICATIONS, end to end: the seller states what one version
// measures, the row carries it, and the buyer's spec table swaps with the
// picker. The whole loop in one spec, because the value of the feature is that
// the three agree: a table sold in two sizes had one set of measurements, and
// it was wrong for one of them.

const SIZE_GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10";
const SMALL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const LARGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";

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

const PRODUCT_PAGE = {
  enabled: true,
  layout: "gallery-left",
  gallery: "thumbnails",
  imageFit: "contain",
  ctaLabel: "Buy now",
  ctaStyle: "accent",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: true,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map(
    (id) => ({ id, show: true }),
  ),
};

async function openSection(page: Page, id: string) {
  const section = page.locator(`[data-product-section="${id}"]`);
  if (!(await section.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await section.locator("summary").click();
  }
  await expect(section.locator("summary")).toBeVisible();
}

test("a version states its own measurements, and the page shows them", async ({ page }) => {
  const user = freshUser("optspec");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Table studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  await seedProducts(sellerId, [
    {
      title: "Oak table",
      price_cents: 89900,
      description: "A table.",
      option_groups: [
        {
          id: SIZE_GROUP,
          name: "Size",
          display: "chip",
          options: [
            { id: SMALL, name: "Small", available: true },
            { id: LARGE, name: "Large", available: true },
          ],
        },
      ],
      // The product's own numbers, which the small table keeps.
      details: { materials: "Solid oak", dimensions: { length: 120, width: 80, height: 75, unit: "cm" } },
    },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const productId = products[0]!.id;

  await seedSellerIdentity(sellerId, {
    businessName: "Table Studio Ltd",
    email: "hi@table.example",
    country: "IE",
  });
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [{ type: "product", productId, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });

  // --- the seller states what Large measures ---
  await gotoApp(page, `/products/${productId}/edit`);

  // The units are the PRODUCT's, chosen once: a version states numbers only,
  // so picking kg here is what makes "26" below mean 26 kg.
  await page.locator('[data-product-field="weightUnit"]').getByRole("combobox").click();
  await page.getByRole("option", { name: "kg", exact: true }).click();

  const row = page.locator(`[data-option-details="${LARGE}"]`);
  await expect(row).toContainText("Same as above");
  await row.getByRole("button").first().click();
  await row.getByLabel("Length").fill("180");
  await row.getByLabel("Width").fill("90");
  await row.getByLabel("Height").fill("75");
  await row.getByLabel("Weight").fill("26");
  // The unit is printed beside the number rather than picked again per version.
  await expect(row).toContainText("kg");
  await row.getByRole("button", { name: /specification for this version/i }).click();
  await row.getByLabel(/specification 1 name/i).fill("Seats");
  await row.getByLabel(/specification 1 value/i).fill("6");

  await page.getByRole("button", { name: /save changes/i }).click();
  await expectToast(page, /oak table/i);

  // --- the row carries it ---
  const saved = (await serviceRest(
    `/products?id=eq.${productId}&select=option_groups`,
  )) as { option_groups: { options: { id: string; details?: unknown }[] }[] }[];
  const options = saved[0]!.option_groups[0]!.options;
  expect(options.find((option) => option.id === SMALL)?.details).toBeUndefined();
  expect(options.find((option) => option.id === LARGE)?.details).toEqual({
    dimensions: { length: 180, width: 90, height: 75, unit: "cm" },
    weight: { value: 26, unit: "kg" },
    specs: [{ label: "Seats", value: "6" }],
  });

  // --- and the buyer's table follows the picker ---
  await gotoApp(page, `/s/${storefrontId}/p/${productId}`);
  await openSection(page, "specs");
  const specs = page.locator("[data-product-specs]");
  await expect(specs).toContainText("Small");
  await expect(specs).toContainText("120 × 80 × 75 cm");
  await expect(specs).toContainText("Solid oak");
  await expect(specs).not.toContainText("Seats");

  await page.getByRole("radio", { name: "Large" }).click();
  await expect(specs).toContainText("180 × 90 × 75 cm");
  await expect(specs).toContainText("26 kg");
  await expect(specs).toContainText("Seats");
  // What does not vary is still the product's own.
  await expect(specs).toContainText("Solid oak");
});
