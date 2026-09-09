import { expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  gotoApp,
  seedProducts,
  PUBLISHABLE_SELLER,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * BUYING MORE THAN ONE, end to end.
 *
 * Two halves, and the second is the point of the first. The seller sets a
 * per-order ceiling on the real product form; the buyer's hosted page then
 * offers exactly that many and no more — including when the buyer edits the
 * address bar, which is the only way a quantity can be "faked" at this stage
 * (there is no checkout to post to yet, and the boundary a checkout must pass
 * is covered by tests/unit/order-quantity.test.ts and by the database's own
 * decrement fence in tests/integration/13-stock-decrement.test.ts).
 *
 * One seller per test — sign-up is the only way this stack mints a user —
 * with the storefront and products seeded straight in.
 */

/** The default theme, spelled out: the spec must not reach into src/. */
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

type Seeded = {
  sellerId: string;
  storefrontId: string;
  /** Untracked, ceiling of 3. */
  capped: string;
  /** Untracked, ceiling of 1 — sold one at a time. */
  single: string;
  /** Tracking, 2 left with a threshold of 5, so the badge already says "2". */
  low: string;
  /** Tracking, 12 on hand above a threshold of 5, so the count stays private. */
  plenty: string;
  /** Tracking, nothing left. */
  gone: string;
};

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Quantity studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  await seedProducts(sellerId, [
    { title: "Capped candle", price_cents: 1250, max_per_order: 3 },
    { title: "Single sculpture", price_cents: 40000, max_per_order: 1 },
    {
      title: "Nearly gone mug",
      price_cents: 900,
      max_per_order: 6,
      track_stock: true,
      stock_quantity: 2,
      low_stock_threshold: 5,
    },
    {
      title: "Well stocked soap",
      price_cents: 500,
      max_per_order: 4,
      track_stock: true,
      stock_quantity: 12,
      low_stock_threshold: 5,
    },
    {
      title: "Empty shelf print",
      price_cents: 2000,
      max_per_order: 5,
      track_stock: true,
      stock_quantity: 0,
      low_stock_threshold: 5,
    },
  ]);

  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const byTitle = (title: string) => products.find((p) => p.title === title)!.id;
  const seeded: Seeded = {
    sellerId,
    storefrontId,
    capped: byTitle("Capped candle"),
    single: byTitle("Single sculpture"),
    low: byTitle("Nearly gone mug"),
    plenty: byTitle("Well stocked soap"),
    gone: byTitle("Empty shelf print"),
  };

  // A contact email, so the buy button is a live mailto rather than absent —
  // that is where the chosen quantity travels today.
  // The address is required too, or the publish gate 404s the page below.
  await seedSellerIdentity(sellerId, {
    ...PUBLISHABLE_SELLER,
    businessName: "Quantity Studio Ltd",
    email: "hi@quantity.example",
  });

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [
          { type: "product", productId: seeded.capped, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.single, x: 2, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.low, x: 4, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.plenty, x: 0, y: 2, w: 2, h: 2 },
          { type: "product", productId: seeded.gone, x: 2, y: 2, w: 2, h: 2 },
        ],
      },
    },
  });

  return seeded;
}

/** The buyer's quantity control (a listbox trigger, not a native select — see
 *  components/product-page/PageSelect.tsx). At most one on a page. */
function picker(page: Page) {
  return page.getByRole("combobox", { name: "Quantity" });
}

/** Open the list and return its options. */
async function quantityOptions(page: Page) {
  await picker(page).click();
  return page.getByRole("option");
}

/** Open the list, choose `value`, and let it close. */
async function chooseQuantity(page: Page, value: string) {
  await picker(page).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

test.describe("purchase quantity", () => {
  test("the seller sets the ceiling on the product form, and it survives a reload", async ({
    page,
  }) => {
    await signUp(page, freshUser("qty-form"));
    await gotoApp(page, "/products/new");

    await page.getByLabel("Title").fill("Limited candle");
    await page.getByLabel(/price/i).fill("12.50");

    // The field is in Stock but OUTSIDE the tracking block: it must be usable
    // without turning Track stock on, because a made-to-order product still
    // has a number the seller will sell in one go.
    const limit = page.getByLabel("Maximum per order");
    await expect(limit).toBeVisible();
    await expect(limit).toHaveValue("10"); // the default every product starts on
    await limit.fill("3");

    await page.getByRole("button", { name: /^Add product$|^Save/ }).click();
    await expect(page).toHaveURL(/\/products$/, { timeout: 15_000 });

    // Back into the form: the stored value is what comes back, not the default.
    await page.getByRole("link", { name: /Limited candle/ }).first().click();
    await expect(page.getByLabel("Maximum per order")).toHaveValue("3");
  });

  test("the form refuses a ceiling the database would refuse", async ({ page }) => {
    await signUp(page, freshUser("qty-invalid"));
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Bad limit");
    await page.getByLabel(/price/i).fill("5.00");

    await page.getByLabel("Maximum per order").fill("999");
    await page.getByRole("button", { name: /^Add product$|^Save/ }).click();
    await expect(page.getByText(/maximum per order must be a whole number/i)).toBeVisible();
    // Still on the form — nothing was written.
    await expect(page).toHaveURL(/\/products\/new$/);

    await page.getByLabel("Maximum per order").fill("0");
    await page.getByRole("button", { name: /^Add product$|^Save/ }).click();
    await expect(page.getByText(/maximum per order must be a whole number/i)).toBeVisible();
  });

  test("a buyer can pick a quantity up to the seller's ceiling, and sees the line total", async ({
    page,
  }) => {
    const seeded = await seed(page, "qty-buyer");
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.capped}`);

    await expect(picker(page)).toBeVisible();
    // A closed list stopping exactly where the seller said.
    await expect(await quantityOptions(page)).toHaveText(["1", "2", "3"]);
    await page.keyboard.press("Escape");

    // No arithmetic at one unit; the price above already says it.
    await expect(page.locator("[data-product-line-total]")).toHaveCount(0);

    await chooseQuantity(page, "3");
    await expect(page.locator("[data-product-line-total]")).toHaveText(/3 × €12\.50 = €37\.50/);
    // The address bar carries the choice, so the link a buyer copies opens on it.
    await expect(page).toHaveURL(/[?&]q=3/);

    // And the enquiry the seller receives says how many.
    const cta = page.locator('[data-product-cta="mail"] a').first();
    await expect(cta).toHaveAttribute("href", /Quantity%3A%203/);

    // Back to one: the parameter is dropped rather than written as q=1.
    await chooseQuantity(page, "1");
    await expect(page).not.toHaveURL(/[?&]q=/);
  });

  test("a forged ?q= in the address bar cannot raise the ceiling", async ({ page }) => {
    const seeded = await seed(page, "qty-forged");

    // Every one of these is what a curious buyer types into the URL.
    for (const forged of ["99", "3000", "-4", "2.5", "1e9", "abc", ""]) {
      await page.goto(`/s/${seeded.storefrontId}/p/${seeded.capped}?q=${encodeURIComponent(forged)}`);
      const value = Number((await picker(page).textContent())?.trim());
      // Never above the ceiling, never below one.
      expect(value, `?q=${forged}`).toBeGreaterThanOrEqual(1);
      expect(value, `?q=${forged}`).toBeLessThanOrEqual(3);
      // And the list itself never grew.
      await expect(await quantityOptions(page)).toHaveCount(3);
      await page.keyboard.press("Escape");
    }

    // A legal one still works, so the clamp is not simply refusing everything.
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.capped}?q=2`);
    await expect(picker(page)).toHaveText("2");
  });

  test("no control at all when there is nothing to choose", async ({ page }) => {
    const seeded = await seed(page, "qty-none");

    // Sold one at a time: a dropdown with one entry is a decision a buyer is
    // asked to make and then not allowed to make.
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.single}`);
    await expect(page.getByRole("heading", { name: "Single sculpture" })).toBeVisible();
    await expect(picker(page)).toHaveCount(0);

    // Sold out: the button already says so.
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.gone}`);
    await expect(page.locator('[data-product-stock="sold_out"]')).toBeVisible();
    await expect(picker(page)).toHaveCount(0);
  });

  test("the list narrows to the shelf only where the badge already published it", async ({
    page,
  }) => {
    const seeded = await seed(page, "qty-stock");

    // 2 left, threshold 5, so the page ALREADY prints "Only 2 left". Stopping
    // the list at 2 tells the buyer nothing new.
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.low}`);
    await expect(page.getByText("Only 2 left")).toBeVisible();
    await expect(await quantityOptions(page)).toHaveText(["1", "2"]);
    await page.keyboard.press("Escape");

    // 12 on hand, above the threshold, so the page says only "In stock". THE
    // PRIVACY INVARIANT: the list must stop at the seller's ceiling of 4 and
    // must not reveal the 12 by stopping there instead.
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.plenty}`);
    await expect(page.getByText("In stock")).toBeVisible();
    await expect(await quantityOptions(page)).toHaveText(["1", "2", "3", "4"]);
    // Nothing anywhere in the delivered page says how many are really there.
    expect(await page.content()).not.toContain("stock_quantity");
  });

  test("with stock display switched off, the list discloses nothing about the shelf", async ({
    page,
  }) => {
    const seeded = await seed(page, "qty-hidden");
    // The seller turns the stock line off. The "Nearly gone mug" has 2 left and
    // a ceiling of 6: with the line on, the list stopped at 2 (above). With it
    // off the page prints no count, so the list must NOT stop at 2 either — a
    // dropdown is not a place to publish a number the seller is hiding.
    await serviceRest(`/storefronts?id=eq.${seeded.storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          productPage: { ...PRODUCT_PAGE, showStock: false },
          blocks: [{ type: "product", productId: seeded.low, x: 0, y: 0, w: 2, h: 2 }],
        },
      },
    });

    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.low}`);
    await expect(page.getByRole("heading", { name: "Nearly gone mug" })).toBeVisible();
    await expect(page.getByText("Only 2 left")).toHaveCount(0);
    await expect(await quantityOptions(page)).toHaveText(["1", "2", "3", "4", "5", "6"]);
  });
});
