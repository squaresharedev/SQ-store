import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  expectToast,
  freshUser,
  gotoApp,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * EVERYDAY SELLER FRICTION: the small places a seller used to be left
 * guessing, each driven on the real pages.
 *
 *   - Deleting a product with orders still to ship says so first, and the
 *     orders stay; one that came in after the page loaded is never deleted
 *     past unwarned (the action asks again).
 *   - A card says how many of its orders are waiting.
 *   - An order the buyer withdrew from leaves the To ship queue and asks for
 *     its refund on the overview instead, on its own "Withdrawn" list.
 *   - The Orders search finds an order by what a seller remembers of it.
 *   - A save the automatic check has not approved yet says buyers cannot see
 *     it yet, and the list's badge explains itself.
 *   - An iPhone photo is named as one, with the way round it.
 *   - The import screen says up front that photos stay behind.
 */

type Seller = { id: string; email: string };

async function newSeller(page: Page, tag: string): Promise<Seller> {
  const user = freshUser(tag);
  await signUp(page, user);
  const id = await userIdByEmail(user.email);
  await seedSellerIdentity(id, PUBLISHABLE_SELLER);
  return { id, email: user.email };
}

async function productId(sellerId: string, title: string): Promise<string> {
  const rows = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&title=eq.${encodeURIComponent(title)}&select=id`,
  )) as { id: string }[];
  expect(rows, `no product called ${title}`).toHaveLength(1);
  return rows[0].id;
}

/** One paid order waiting to be shipped, for a product. */
async function orderToShip(sellerId: string, product: { id: string; title: string }, extra = {}) {
  await seedOrders(sellerId, [
    {
      amount_cents: 4200,
      product_id: product.id,
      product_title: product.title,
      fulfilment_status: "unfulfilled",
      ...extra,
    },
  ]);
}

test.describe("everyday seller friction", () => {
  test("deleting a product with orders to ship warns first, and the orders stay", async ({ page }) => {
    const seller = await newSeller(page, "delwarn");
    await seedProducts(seller.id, [{ title: "Brass lamp" }]);
    const lamp = { id: await productId(seller.id, "Brass lamp"), title: "Brass lamp" };
    await orderToShip(seller.id, lamp);

    await gotoApp(page, "/products");
    // The card says what is waiting, and leads to it: this product's parcels,
    // not every product's (95-orders-product-scope.spec.ts drives the page).
    const waiting = page.locator("[data-card-to-ship]");
    // The link reads "Ship 1"; the sentence is its accessible name.
    await expect(waiting).toHaveAttribute("aria-label", "1 order to ship");
    await expect(waiting).toHaveAttribute("href", `/orders?view=to-ship&product=${lamp.id}`);

    await page.getByRole("button", { name: "Delete Brass lamp" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-delete-to-ship]")).toContainText(
      "1 order for this product is still to ship.",
    );
    await dialog.getByRole("button", { name: "Delete anyway" }).click();
    await expect(page.getByRole("heading", { name: "Brass lamp" })).toBeHidden({ timeout: 15_000 });

    // The order outlived its product, name and all, and is still to ship.
    const orders = (await serviceRest(
      `/orders?seller_id=eq.${seller.id}&select=product_id,product_title,fulfilment_status`,
    )) as { product_id: string | null; product_title: string; fulfilment_status: string }[];
    expect(orders).toEqual([{ product_id: null, product_title: "Brass lamp", fulfilment_status: "unfulfilled" }]);
    await gotoApp(page, "/orders?view=to-ship");
    await expect(page.getByText("Brass lamp").first()).toBeVisible();
  });

  test("an order that came in after the page loaded is never deleted past unwarned", async ({ page }) => {
    const seller = await newSeller(page, "delrace");
    await seedProducts(seller.id, [{ title: "Oak shelf" }]);
    const shelf = { id: await productId(seller.id, "Oak shelf"), title: "Oak shelf" };

    await gotoApp(page, "/products");
    await page.getByRole("button", { name: "Delete Oak shelf" }).click();
    const dialog = page.getByRole("dialog");
    // Nothing waiting when the dialog opened: the plain confirmation.
    await expect(dialog.locator("[data-delete-to-ship]")).toHaveCount(0);

    // A buyer pays while the seller is reading it.
    await orderToShip(seller.id, shelf);
    await dialog.getByRole("button", { name: "Delete product" }).click();

    await expectToast(page, "An order for this product is still to ship.");
    expect((await serviceRest(`/products?id=eq.${shelf.id}&select=id`)) as unknown[]).toHaveLength(1);
    await expect(page.getByRole("heading", { name: "Oak shelf" })).toBeVisible();

    // The page was refreshed by the refusal: the next try carries the warning.
    await expect(page.locator("[data-card-to-ship]")).toHaveAttribute("aria-label", "1 order to ship", { timeout: 15_000 });
    await page.getByRole("button", { name: "Delete Oak shelf" }).click();
    await expect(page.getByRole("dialog").locator("[data-delete-to-ship]")).toBeVisible();
  });

  test("a withdrawn order leaves the To ship queue and asks for its refund instead", async ({ page }) => {
    const seller = await newSeller(page, "withdraw");
    await seedProducts(seller.id, [{ title: "Wool throw" }, { title: "Clay cup" }]);
    const throwRug = { id: await productId(seller.id, "Wool throw"), title: "Wool throw" };
    const cup = { id: await productId(seller.id, "Clay cup"), title: "Clay cup" };
    await orderToShip(seller.id, throwRug);
    await orderToShip(seller.id, cup, { buyer_email: "changed-mind@example.com" });
    await serviceRest(`/orders?seller_id=eq.${seller.id}&buyer_email=eq.changed-mind@example.com`, {
      method: "PATCH",
      body: { withdrawal_requested_at: new Date().toISOString() },
    });

    await gotoApp(page, "/dashboard");
    // One parcel to send, and one refund owed: two rows, not "2 orders to ship".
    await expect(page.getByText("1 order to ship").first()).toBeVisible();
    const refundRow = page.getByRole("link", { name: "See withdrawals" });
    await expect(refundRow).toBeVisible();
    await expect(page.getByText("1 buyer withdrew")).toBeVisible();

    await refundRow.click();
    await expect(page).toHaveURL(/\/orders\?status=withdrawn/);
    await expect(page.getByText("changed-mind@example.com").first()).toBeVisible();
    await expect(page.getByText("Wool throw")).toHaveCount(0);

    await gotoApp(page, "/orders?view=to-ship");
    await expect(page.getByText("Wool throw").first()).toBeVisible();
    await expect(page.getByText("Clay cup")).toHaveCount(0);
  });

  test("the orders search finds an order by name, city, product or tracking number", async ({ page }) => {
    const seller = await newSeller(page, "search");
    await seedOrders(seller.id, [
      {
        amount_cents: 3100,
        product_title: "Linen apron",
        buyer_email: "ada@example.com",
        ship_to: { name: "Ada Lovelace", line1: "1 Analytical Way", city: "Marylebone", country: "GB" },
        tracking_number: "JD0002233445NL",
      },
      {
        amount_cents: 1800,
        product_title: "Felt coaster",
        buyer_email: "grace@example.com",
        ship_to: { name: "Grace Hopper", line1: "2 Compiler Road", city: "Arlington", country: "US" },
      },
    ]);

    for (const term of ["Lovelace", "marylebone", "apron", "JD0002233445"]) {
      await gotoApp(page, `/orders?view=all&q=${encodeURIComponent(term)}`);
      await expect(page.getByText("ada@example.com").first(), term).toBeVisible();
      await expect(page.getByText("grace@example.com"), term).toHaveCount(0);
    }
    // A comma or parenthesis is part of the search, not the filter's syntax.
    await gotoApp(page, `/orders?view=all&q=${encodeURIComponent("a,b) (c")}`);
    await expect(page.getByText("ada@example.com")).toHaveCount(0);
  });

  test("a save the check has not approved yet says buyers cannot see it yet", async ({ page }) => {
    await newSeller(page, "checking");
    await gotoApp(page, "/products/new");
    // The e2e check holds anything carrying this marker for a person.
    await page.getByLabel("Title").fill("Hand-thrown bowl [[unsure]]");
    await page.getByLabel(/price/i).fill("38");
    await page.getByRole("button", { name: /^save product$/i }).click();

    await expectToast(page, "Buyers will see it once the automatic check approves it.");
    await page.waitForURL(/\/products$/, { timeout: 20_000 });
    const badge = page.locator("[data-removal-badge]").first();
    await expect(badge).toHaveText("In review");
    await expect(badge).toHaveAttribute("title", "A person is checking it. Buyers see it once it is approved.");
  });

  test("an iPhone photo is named as one, and the import screen says photos stay behind", async ({ page }) => {
    await newSeller(page, "heic");
    await gotoApp(page, "/products/new");
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .first()
      .setInputFiles({ name: "IMG_0042.HEIC", mimeType: "image/heic", buffer: Buffer.from("not really a photo") });
    await expect(page.getByText(/That is an iPhone photo \(HEIC\)/).first()).toBeVisible();

    await gotoApp(page, "/products/import");
    // Before any file is picked.
    await expect(page.locator("[data-import-photos-note]")).toHaveText(/Photos are not imported/);
  });
});
