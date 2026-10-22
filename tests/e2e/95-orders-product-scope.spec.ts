import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
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
 * A PRODUCT CARD'S ORDERS, AND ITS ONE STOCK LINE.
 *
 *   - "N orders to ship" on a card opens the To ship queue narrowed to THAT
 *     product (`?product=<id>`), with a chip naming it. The scope survives a
 *     switch of tab, and the chip's own button is the way back to every
 *     product's orders. A product with no orders says so; an id that is not
 *     one of this store's products is dropped.
 *   - A card states its stock once: "Sold out" and "Only N left" are the badge,
 *     a healthy count is the footer, never both.
 */

async function newSeller(page: Page, tag: string): Promise<string> {
  const user = freshUser(tag);
  await signUp(page, user);
  const id = await userIdByEmail(user.email);
  await seedSellerIdentity(id, PUBLISHABLE_SELLER);
  return id;
}

async function productId(sellerId: string, title: string): Promise<string> {
  const rows = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&title=eq.${encodeURIComponent(title)}&select=id`,
  )) as { id: string }[];
  expect(rows, `no product called ${title}`).toHaveLength(1);
  return rows[0].id;
}

const rows = (page: Page) => page.locator("tbody tr");
const scope = (page: Page) => page.locator("[data-orders-product-scope]");

test.describe("a product card's orders", () => {
  test("the card's to-ship link opens that product's queue, and the scope can be cleared", async ({ page }) => {
    test.setTimeout(120_000);
    const sellerId = await newSeller(page, "pscope");
    await seedProducts(sellerId, [{ title: "Brass lamp" }, { title: "Clay cup" }]);
    const lamp = await productId(sellerId, "Brass lamp");
    const cup = await productId(sellerId, "Clay cup");
    const waiting = { fulfilment_status: "unfulfilled" as const };
    await seedOrders(sellerId, [
      { amount_cents: 4200, product_id: lamp, product_title: "Brass lamp", buyer_email: "a@e2e.test", ...waiting },
      { amount_cents: 4200, product_id: lamp, product_title: "Brass lamp", buyer_email: "b@e2e.test", ...waiting },
      { amount_cents: 1500, product_id: cup, product_title: "Clay cup", buyer_email: "c@e2e.test", ...waiting },
      // History: the lamp sold once before and went out.
      { amount_cents: 4200, product_id: lamp, product_title: "Brass lamp", buyer_email: "d@e2e.test" },
    ]);

    await gotoApp(page, "/products");
    const lampLink = page.locator(`[data-card-to-ship][href*="${lamp}"]`);
    await expect(lampLink).toHaveAttribute("aria-label", "2 orders to ship");
    await page
      .locator(`[data-product-card="${lamp}"]`)
      .screenshot({ path: test.info().outputPath("card-to-ship.png") });
    await lampLink.click();

    // The queue, narrowed: the lamp's two parcels, the cup's not among them,
    // and the tab counts the same two.
    await expect(page).toHaveURL(new RegExp(`view=to-ship.*product=${lamp}`));
    await expect(scope(page)).toContainText("Brass lamp");
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator("tbody").getByText("Clay cup")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /To ship/ })).toContainText("2");
    await page.locator("main").screenshot({ path: test.info().outputPath("orders-scoped.png") });

    // All orders keeps the scope: the lamp's whole history, still no cup.
    await page.getByRole("link", { name: "All orders" }).click();
    await expect(page).toHaveURL(new RegExp(`view=all.*product=${lamp}`));
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator("tbody").getByText("Clay cup")).toHaveCount(0);

    // The chip's button is the way back to every product's orders.
    await scope(page).getByRole("link", { name: /all products/i }).click();
    await expect(page).not.toHaveURL(/product=/);
    await expect(scope(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator("tbody").getByText("Clay cup")).toBeVisible();
  });

  test("a product with no orders says so, and a foreign id is dropped", async ({ page }) => {
    const sellerId = await newSeller(page, "pscope0");
    await seedProducts(sellerId, [{ title: "Quiet vase" }, { title: "Busy bowl" }]);
    const vase = await productId(sellerId, "Quiet vase");
    const bowl = await productId(sellerId, "Busy bowl");
    await seedOrders(sellerId, [{ amount_cents: 900, product_id: bowl, product_title: "Busy bowl" }]);

    await gotoApp(page, `/orders?view=all&product=${vase}`);
    await expect(scope(page)).toContainText("Quiet vase");
    await expect(page.getByText("No orders for this product yet")).toBeVisible();
    // Not the "no orders at all" state: the store has orders, the tabs stay.
    await expect(page.getByRole("link", { name: "All orders" })).toBeVisible();

    // An id that is not one of this store's products: no chip, the whole list.
    await gotoApp(page, "/orders?view=all&product=00000000-0000-4000-8000-000000000000");
    await expect(scope(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe("a product card's stock line", () => {
  test("sold out and low stock are said once, a healthy count in the footer", async ({ page }) => {
    const sellerId = await newSeller(page, "stock1");
    await seedProducts(sellerId, [
      { title: "Gone shelf", track_stock: true, stock_quantity: 0, low_stock_threshold: 3 },
      { title: "Last chairs", track_stock: true, stock_quantity: 2, low_stock_threshold: 3 },
      { title: "Plenty mugs", track_stock: true, stock_quantity: 40, low_stock_threshold: 3 },
    ]);
    const ids = {
      "Gone shelf": await productId(sellerId, "Gone shelf"),
      "Last chairs": await productId(sellerId, "Last chairs"),
      "Plenty mugs": await productId(sellerId, "Plenty mugs"),
    };
    // A sale, so the footer's revenue line is there too (the case in which the
    // stock line used to repeat on a second row).
    await seedOrders(sellerId, [
      { amount_cents: 11200, product_id: ids["Gone shelf"], product_title: "Gone shelf" },
    ]);

    await gotoApp(page, "/products");
    const card = (title: keyof typeof ids) => page.locator(`[data-product-card="${ids[title]}"]`);

    await expect(card("Gone shelf").getByText("Sold out", { exact: true })).toHaveCount(1);
    await expect(card("Last chairs").getByText("Only 2 left", { exact: true })).toHaveCount(1);
    await expect(card("Last chairs").getByText("2 in stock")).toHaveCount(0);
    await expect(card("Plenty mugs").getByText("40 in stock")).toHaveCount(1);
    await card("Gone shelf").screenshot({ path: test.info().outputPath("card-sold-out.png") });
  });
});
