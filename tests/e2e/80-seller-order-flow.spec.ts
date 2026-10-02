import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  devEmails,
  freshUser,
  gotoApp,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// THE SELLER'S ORDER JOURNEY, past the ship button: clearing the To ship queue,
// the email link that survives sign-in, finding an order by what a buyer would
// quote, the delivery-price nudges, and what a read-only member is spared.
// Each of these was a spot where a seller got stuck or was told something
// untrue.
//
// Not covered here: the copy shown when this deployment cannot send email. That
// needs a stack started with no TRANSACTIONAL_EMAIL_FROM, which this suite never
// runs, so it is pinned by tests/component/order-seller-flow.test.tsx instead.
// The dashboard's "Set your delivery prices" row only exists while checkout is
// open, so scenario 4 checks it only on a stack started with
// CHECKOUT_TEST_PAYMENTS=1 (the same switch 78-checkout.spec.ts needs).

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const numberOf = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

const DE = { name: "Lukas Weber", line1: "Lindenstrasse 14", city: "Berlin", postalCode: "10115", country: "DE" };
const IE = { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", postalCode: "D02 X285", country: "IE" };

async function seedShop(page: Page, tag: string, policy?: Record<string, unknown>) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: `Clay House ${tag}` });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  await seedProducts(sellerId, [{ title: "Stoneware vase", price_cents: 2400 }]);
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: policy ?? {
        shipsFrom: "IE",
        dispatch: "Packed and posted within 2 days",
        ratesCurrency: "EUR",
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
      },
    },
  });
  return { user, sellerId };
}

const orderIdByTitle = async (sellerId: string, title: string) =>
  ((await serviceRest(
    `/orders?seller_id=eq.${sellerId}&product_title=eq.${encodeURIComponent(title)}&select=id`,
  )) as { id: string }[])[0].id;

const panel = (page: Page) => page.getByRole("dialog", { name: /order details/i });

/** Open the palette once the page can hear it (a press before hydration is lost). */
async function openSearch(page: Page) {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("combobox")).toBeFocused({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test("1. clearing the To ship queue, start to finish", async ({ page }) => {
  test.setTimeout(420_000);
  const { sellerId } = await seedShop(page, "queue");
  // The queue's clock ticks by the minute, so an order seeded exactly ten days
  // back can read "9 days ago" for up to a minute; a little past is unambiguous.
  await seedOrders(sellerId, [
    { amount_cents: 2400, product_title: "Oldest vase", buyer_email: "old@example.test", fulfilment_status: "unfulfilled", ship_to: DE, created_at: ago(10.01) },
    { amount_cents: 2400, product_title: "Withdrawn vase", buyer_email: "withdrew@example.test", fulfilment_status: "unfulfilled", ship_to: DE, created_at: ago(2) },
    { amount_cents: 2400, product_title: "Middle vase", buyer_email: "mid@example.test", fulfilment_status: "unfulfilled", ship_to: IE, created_at: ago(1) },
    { amount_cents: 2400, product_title: "Newest vase", buyer_email: "new@example.test", fulfilment_status: "unfulfilled", ship_to: null, created_at: ago(0.1) },
    { amount_cents: 2400, product_title: "Pending vase", status: "pending", buyer_email: "pending@example.test", fulfilment_status: "unfulfilled", ship_to: IE, created_at: ago(0.05) },
    { amount_cents: 2400, product_title: "Disputed vase", status: "disputed", buyer_email: "dispute@example.test", fulfilment_status: "unfulfilled", ship_to: IE, created_at: ago(3) },
  ]);
  await serviceRest(`/orders?seller_id=eq.${sellerId}&product_title=eq.Withdrawn%20vase`, {
    method: "PATCH",
    body: { withdrawal_requested_at: ago(0.5) },
  });
  const id = (title: string) => orderIdByTitle(sellerId, title);

  // The list the page chose is named in the address, so a refresh stays on it.
  await gotoApp(page, "/orders");
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("to-ship");

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Oldest vase");
  await expect(rows.nth(3)).toContainText("Newest vase");
  await expect(page.locator("tbody")).not.toContainText("Pending vase");
  await expect(page.locator("tbody")).not.toContainText("Disputed vase");
  // How long each has waited; only the forgotten one is called out.
  await expect(rows.nth(0).locator("[data-order-waiting]")).toHaveAttribute("data-order-waiting", "overdue");
  await expect(rows.nth(0).locator("[data-order-waiting]")).toContainText("10 days ago");
  await expect(rows.nth(3).locator("[data-order-waiting]")).toHaveAttribute("data-order-waiting", "ok");
  await expect(rows.nth(1).locator("[data-order-withdrawn]")).toHaveText("Withdrawn");

  // First parcel: the number the buyer quotes, a way to write to them, honest refund copy.
  await rows.nth(0).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator("[data-order-number]")).toHaveText(`Order ${numberOf(await id("Oldest vase"))}`);
  const mail = await panel(page).getByRole("link", { name: "Email the buyer" }).first().getAttribute("href");
  expect(mail).toBe(`mailto:old@example.test?subject=Your%20order%20${numberOf(await id("Oldest vase"))}`);
  await expect(panel(page).getByRole("button", { name: "Refund order" })).toHaveCount(0);
  await expect(panel(page)).toContainText("You can't refund from Square Share yet");

  await panel(page).getByRole("button", { name: "Mark as shipped" }).click();
  await expect(panel(page)).toContainText("We'll email the buyer");
  await panel(page).getByLabel(/Tracking number/).fill("RR123456789IE");
  await panel(page).getByRole("button", { name: /^Mark shipped/ }).click();
  await expect(panel(page).locator("[data-order-shipped-status]")).toBeFocused({ timeout: 25_000 });

  // Next: the withdrawn one. The panel is fresh, with its own number and warning.
  await panel(page).getByRole("button", { name: "Next order to ship" }).click();
  await expect(panel(page).locator("[data-order-number]")).toHaveText(`Order ${numberOf(await id("Withdrawn vase"))}`);
  await expect(panel(page).getByRole("alert")).toContainText("withdraw");
  await expect(panel(page).getByRole("alert").getByRole("link", { name: "Email the buyer" })).toBeVisible();
  await expect(panel(page).getByLabel(/Tracking number/)).toHaveCount(0);
  const opener = panel(page).getByRole("button", { name: "Mark as shipped" });
  await opener.click();
  await expect(panel(page)).toContainText("Ship it only if you've agreed that with them");
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await expect(opener).toBeFocused();

  // Ship it anyway, then the middle one, then the one with no address.
  await opener.click();
  await panel(page).getByRole("button", { name: /^Mark shipped/ }).click();
  await expect(panel(page).locator("[data-order-shipped-status]")).toBeFocused({ timeout: 25_000 });
  await panel(page).getByRole("button", { name: "Next order to ship" }).click();
  await expect(panel(page).locator("[data-order-number]")).toHaveText(`Order ${numberOf(await id("Middle vase"))}`);
  await panel(page).getByRole("button", { name: "Mark as shipped" }).click();
  await panel(page).getByRole("button", { name: /^Mark shipped/ }).click();
  await expect(panel(page).locator("[data-order-shipped-status]")).toBeFocused({ timeout: 25_000 });
  await panel(page).getByRole("button", { name: "Next order to ship" }).click();

  await expect(panel(page).locator("[data-order-number]")).toHaveText(`Order ${numberOf(await id("Newest vase"))}`);
  await expect(panel(page)).toContainText("There's no delivery address on this order");
  await expect(panel(page).getByRole("link", { name: "Email the buyer" }).first()).toBeVisible();
  await panel(page).getByRole("button", { name: "Mark as shipped" }).click();
  await panel(page).getByRole("button", { name: /^Mark shipped/ }).click();
  await expect(panel(page).locator("[data-order-shipped-status]")).toBeFocused({ timeout: 25_000 });

  // The last parcel: told they are done, nothing further to press.
  await expect(panel(page).locator("[data-order-queue-done]")).toContainText("caught up");
  await expect(panel(page).getByRole("button", { name: "Next order to ship" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByText("Nothing to ship")).toBeVisible();
  // Still the To ship list after the last parcel left it, even on a refresh.
  expect(new URL(page.url()).searchParams.get("view")).toBe("to-ship");
  await page.reload();
  await expect(page.getByText("Nothing to ship")).toBeVisible();

  // The buyer of the first parcel was emailed the tracking number.
  const buyerMail = await devEmails("old@example.test");
  expect(buyerMail.some((m) => m.text.includes("RR123456789IE"))).toBe(true);
});

test("2. the seller's email link opens the order, signed out or not", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { user } = await seedShop(page, "emaillink");
  const sale = await page.request.post("/dev/simulate-sale", { data: { buyer: 0, quantity: 1 } });
  expect(sale.ok()).toBe(true);

  // The email goes out after the response, so wait for it rather than race it.
  await expect
    .poll(async () => (await devEmails(user.email)).some((m) => /New order/.test(m.subject)), { timeout: 20_000 })
    .toBe(true);
  const order = (await devEmails(user.email)).find((m) => /New order/.test(m.subject));
  expect(order, "the seller was emailed about the sale").toBeTruthy();
  expect(order!.text).toMatch(/Order number: [0-9A-F]{8}/);
  const link = order!.text.match(/https?:\/\/\S+\/login\?next=\S+/)?.[0];
  expect(link, "the email link goes through sign-in").toBeTruthy();
  const real = link!.replace(/^https?:\/\/[^/]+/, new URL(page.url()).origin);

  // Signed out: the link asks them to sign in, then lands on the order panel.
  const ctx = await (browser as Browser).newContext();
  const out = await ctx.newPage();
  await out.goto(real);
  await expect(out.locator('input[name="password"]')).toBeVisible();
  await out.locator('input[name="identifier"], input[name="email"]').first().fill(user.email);
  await out.locator('input[name="password"]').fill(user.password);
  await out.locator('button[name="intent"]').click();
  await expect(panel(out)).toBeVisible({ timeout: 30_000 });
  await expect(panel(out).locator("[data-order-number]")).toBeVisible();
  await ctx.close();

  // Signed in already: straight through.
  await page.goto(real);
  await expect(panel(page)).toBeVisible({ timeout: 30_000 });
});

test("3. search finds an order by what a buyer would quote", async ({ page }) => {
  test.setTimeout(300_000);
  const { sellerId } = await seedShop(page, "search");
  await seedOrders(sellerId, [
    { amount_cents: 2400, product_title: "Searchable vase", buyer_email: "lukas.weber@example.test", fulfilment_status: "shipped", tracking_number: "RR000000777IE", ship_to: DE, created_at: ago(4) },
    { amount_cents: 1200, product_title: "Other plate", buyer_email: "someone@example.test", fulfilment_status: "shipped", ship_to: IE, created_at: ago(3) },
  ]);
  const id = await orderIdByTitle(sellerId, "Searchable vase");
  const number = numberOf(id);

  const results = async (query: string): Promise<Locator> => {
    await gotoApp(page, "/dashboard");
    await openSearch(page);
    await page.keyboard.type(query, { delay: 15 });
    const hit = page.getByRole("option", { name: /Searchable vase/ });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    return hit;
  };

  for (const query of [number, `#${number}`, number.slice(0, 5), "RR000000777IE", "Berlin", "Lukas Weber"]) {
    const hit = await results(query);
    await expect(hit.first()).toContainText(`#${number}`);
    await page.keyboard.press("Escape");
  }

  // Something that is plainly an order leads the list, not a page that happens to fuzzy-match.
  await gotoApp(page, "/dashboard");
  await openSearch(page);
  await page.keyboard.type(number, { delay: 15 });
  await expect(page.getByRole("option", { name: /Searchable vase/ })).toBeVisible({ timeout: 15_000 });
  const options = page.getByRole("option");
  await expect(options.first()).toContainText("Searchable vase");
  await page.keyboard.press("Escape");

  await gotoApp(page, "/dashboard");
  await openSearch(page);
  await page.keyboard.type("lukas.weber@example", { delay: 15 });
  await expect(page.getByRole("option", { name: /Searchable vase/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("option").first()).toContainText("Searchable vase");
});

test("4. terms written but no delivery prices: the seller is told, in two places", async ({ page }) => {
  test.setTimeout(300_000);
  await seedShop(page, "norates", {
    shipsFrom: "IE",
    dispatch: "Packed and posted within 2 days",
    ratesCurrency: "EUR",
    destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"] }],
  });

  if (process.env.CHECKOUT_TEST_PAYMENTS === "1") {
    // Checkout is open, so a missing price costs a sale and the dashboard says so.
    await gotoApp(page, "/dashboard");
    await expect(page.getByText("Set your delivery prices")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "Set prices" }).click();
    await expect(page).toHaveURL(/\/settings\/shipping#checkout-rates/);
  } else {
    await gotoApp(page, "/settings/shipping");
  }

  await expect(page.locator("[data-destination-needs-rate]")).toHaveCount(1);
  await expect(page.locator("[data-destination-needs-rate]")).toContainText("can't use this row until it has both a rate and a country");
  await page.getByLabel(/rate/i).first().fill("4.50");
  await expect(page.locator("[data-destination-needs-rate]")).toHaveCount(0);
});

test("5. skip link, notification settings, and what a viewer is spared", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { sellerId } = await seedShop(page, "misc");
  await seedOrders(sellerId, [
    { amount_cents: 2400, product_title: "Viewer vase", buyer_email: "v@example.test", fulfilment_status: "unfulfilled", ship_to: IE, created_at: ago(1) },
  ]);

  // Skip link: the first Tab stop, visible, and it lands on the content.
  await gotoApp(page, "/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main-content");

  // Mail is on in development, so the preferences carry no "off" note and the
  // sales switch says what the email holds.
  await gotoApp(page, "/settings/notifications");
  await expect(page.locator("[data-email-off]")).toHaveCount(0);
  await expect(page.getByText("with what to pack and where to send it")).toBeVisible();

  // A viewer sees the order and the address but no controls, and no refund note.
  const viewer = freshUser("viewer");
  const ctx = await (browser as Browser).newContext();
  const vp = await ctx.newPage();
  await signUp(vp, viewer);
  const viewerId = await userIdByEmail(viewer.email);
  await serviceRest("/team_members", {
    method: "POST",
    body: { account_owner_id: sellerId, member_user_id: viewerId, invited_email: viewer.email, role: "viewer", status: "active", accepted_at: new Date().toISOString() },
  });
  await ctx.addCookies([
    { name: "ss_active_account", value: sellerId, url: new URL(page.url()).origin },
  ]);
  await gotoApp(vp, "/orders");
  await vp.locator("tbody tr").first().click();
  await expect(panel(vp)).toBeVisible();
  await expect(panel(vp).getByRole("button", { name: "Mark as shipped" })).toHaveCount(0);
  await expect(panel(vp).getByRole("button", { name: /Refund|dispute/i })).toHaveCount(0);
  await expect(panel(vp)).not.toContainText("You can't refund from Square Share yet");
  await expect(panel(vp).locator("[data-order-number]")).toBeVisible();
  await ctx.close();
});
