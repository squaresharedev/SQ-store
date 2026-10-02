import { expect, test } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  devEmails,
  expectToast,
  freshUser,
  gotoApp,
  seedProducts,
  seedSellerIdentity,
  signUp,
  userIdByEmail,
} from "./helpers";

// The whole fulfilment loop, as a seller lives it: a paid order lands (through
// the real order writer, via the dev sale simulator), the seller hears about
// it by email and on the dashboard, finds it waiting in To ship with the
// address ready to copy, marks it shipped with a tracking number, and the
// buyer is told. Only the payment is pretend.

/** Buyer 0 in lib/dev/simulated-sale.ts: an Irish address, English mail. */
const BUYER = { email: "aoife.byrne@example.test", name: "Aoife Byrne" };

async function sellerWithAMug(page: import("@playwright/test").Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  // A store name nobody else's run uses, so the buyer's shared dev inbox can
  // be read for THIS run's mail.
  const store = `Mug Works ${user.email.split("@")[0]}`;
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: store });
  await seedProducts(sellerId, [
    {
      title: "Blue mug",
      price_cents: 2100,
      option_groups: [
        {
          id: "0f0e0d0c-0000-4000-8000-000000000001",
          name: "Size",
          display: "chip",
          options: [{ id: "0f0e0d0c-0000-4000-8000-000000000002", name: "Large", available: true }],
        },
      ],
    },
  ]);
  return { user, store };
}

test.describe("order fulfilment", () => {
  test("a sale lands, the seller ships it, the buyer is told", async ({ page }) => {
    const { user, store } = await sellerWithAMug(page, "fulfil");

    const sale = await page.request.post("/dev/simulate-sale", {
      data: { quantity: 2, buyer: 0 },
    });
    expect(sale.ok(), await sale.text()).toBe(true);
    const { orderId } = (await sale.json()) as { orderId: string };

    // 1. The seller's "ship this" email: enough to pack and address it.
    await expect(async () => {
      const [mail] = await devEmails(user.email);
      expect(mail?.subject).toBe("New order: ship 2 × Blue mug to Dublin");
      expect(mail?.text).toContain("2 × Blue mug\nSize: Large");
      expect(mail?.text).toContain("Aoife Byrne\n12 Harbour Road\nApartment 4\nDublin\nD02 X285\nIreland");
      // Through sign-in, so the link still opens the order when the seller is signed out.
      expect(mail?.text).toContain(`/login?next=${encodeURIComponent(`/orders?order=${orderId}`)}`);
    }).toPass({ timeout: 15_000 });

    // 2. The dashboard says so, first thing, and so does the rail.
    await gotoApp(page, "/dashboard");
    await expect(page.getByRole("link", { name: /Orders\s*1 order to ship/ })).toBeVisible();
    const row = page.getByRole("link", { name: "Ship orders" });
    await expect(row).toHaveAttribute("href", "/orders?view=to-ship");

    // 3. Orders opens on the queue, with where each parcel goes.
    await gotoApp(page, "/orders");
    await expect(page.getByRole("link", { name: /^To ship/ })).toHaveAttribute("aria-current", "page");
    const order = page.locator("tr", { hasText: "Blue mug" });
    await expect(order).toContainText("2 × Blue mug");
    await expect(order).toContainText(BUYER.name);
    await expect(order).toContainText("Dublin, Ireland");

    // 4. The panel: what to pack, where to, and the button.
    await order.click();
    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail.locator("[data-order-pack]")).toHaveText("2 × Blue mug");
    await expect(detail.locator("[data-order-ship-to]")).toContainText("12 Harbour Road");
    await expect(detail.getByRole("button", { name: "Copy address" })).toBeVisible();

    await detail.getByRole("button", { name: "Mark as shipped" }).click();
    await detail.getByLabel("Tracking number (optional)").fill("RR123456789IE");
    await detail.getByRole("button", { name: "Mark shipped" }).click();
    await expectToast(page, "Marked as shipped. We've emailed the buyer.");
    await expect(detail.locator("[data-order-tracking]")).toHaveText("RR123456789IE");
    await expect(detail.getByText(/^Shipped /)).toBeVisible();

    // 5. The buyer's email comes from the store and replies reach the seller.
    await expect(async () => {
      const mail = (await devEmails(BUYER.email)).find((m) => m.subject.includes(store));
      expect(mail?.subject).toBe(`Your order from ${store} is on its way`);
      expect(mail?.fromName).toBe(`${store} via Square Share`);
      expect(mail?.replyTo).toBe(PUBLISHABLE_SELLER.email);
      expect(mail?.text).toContain("Tracking number: RR123456789IE");
    }).toPass({ timeout: 15_000 });

    // 6. The queue is empty and the rail has stopped counting.
    await gotoApp(page, "/orders?view=to-ship");
    await expect(page.getByText("Nothing to ship")).toBeVisible();
    await expect(page.getByRole("link", { name: /Orders\s*\d+ orders? to ship/ })).toHaveCount(0);
    await page.getByRole("button", { name: "See all orders" }).click();
    await expect(page).toHaveURL(/view=all/);
    await expect(page.locator("tr", { hasText: "Blue mug" }).locator('[data-fulfilment="shipped"]')).toBeVisible();
  });

  test("a redelivered payment is recorded once, and the seller is told once", async ({ page }) => {
    const { user } = await sellerWithAMug(page, "redeliver");
    const checkoutSessionId = `cs_test_redeliver_${Date.now()}`;

    const first = await page.request.post("/dev/simulate-sale", { data: { buyer: 1, checkoutSessionId } });
    const again = await page.request.post("/dev/simulate-sale", { data: { buyer: 1, checkoutSessionId } });
    const one = (await first.json()) as { orderId: string; duplicate: boolean };
    const two = (await again.json()) as { orderId: string; duplicate: boolean };
    expect(one.duplicate).toBe(false);
    expect(two).toEqual({ orderId: one.orderId, duplicate: true });

    await expect(async () => {
      const mails = (await devEmails(user.email)).filter((m) => m.subject.startsWith("New order"));
      expect(mails).toHaveLength(1);
    }).toPass({ timeout: 15_000 });

    await gotoApp(page, "/orders");
    await expect(page.locator("tr", { hasText: "Blue mug" })).toHaveCount(1);
  });
});
