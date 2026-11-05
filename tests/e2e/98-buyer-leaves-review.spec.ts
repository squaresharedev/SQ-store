import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  devEmails,
  freshUser,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A BUYER IS ASKED FOR A REVIEW ONCE THEY HAVE IT, through the real app and
 * the real database, with only the payment pretend:
 *
 *   - the seller's "Buy as a buyer" (/dev/simulate-sale, development only)
 *     records a paid order of a parcel through the real writer and lands on
 *     the buyer's thank-you page, as a buyer straight after paying does;
 *   - that page asks for NO review (nothing has arrived): it offers one
 *     reminder email, and the buyer's yes is recorded with its time;
 *   - the daily job sends nothing until the parcel has shipped and settled
 *     in, then exactly one email, which says who sent it and carries a way to
 *     stop it (a link, and the mail client's one-click unsubscribe);
 *   - the email's link opens the order page with the review in a dialog, and
 *     an ANONYMOUS visitor holding it posts a native review from a verified
 *     buyer, on that order; opening the page again shows the stars given;
 *   - the email's stop link and the one-click POST stop the reminder;
 *   - nobody else can review: a link that proves nothing, the link of an order
 *     of a different product, and a second review of the same order are all
 *     refused;
 *   - the seller can delete reviews written from pretend orders.
 *
 * The stack sets a fixed CRON_SECRET and mail goes to the dev outbox
 * (tests/e2e/stack/server.mjs).
 */

const CRON_SECRET = "e2e-cron-secret-not-a-real-one-0123456789";
const BUYER_EMAIL = "aoife.byrne@example.test";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The path and query of a link in an email. Mail names the deployment's
 *  public origin (NEXT_PUBLIC_APP_URL), which inside the stack is still the
 *  developer's own :3000; the page under test is this stack's. */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/** A stored review, as the spec reads it back. */
type ReviewRow = {
  id: string;
  order_id: string;
  source: string;
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  is_verified_buyer: boolean;
};

type ReminderColumns = {
  review_reminder_requested_at: string | null;
  review_reminder_stopped_at: string | null;
  review_reminder_sent_at: string | null;
};

async function reminderOf(orderId: string): Promise<ReminderColumns> {
  const [row] = (await serviceRest(
    `/orders?id=eq.${orderId}&select=review_reminder_requested_at,review_reminder_stopped_at,review_reminder_sent_at`,
  )) as ReminderColumns[];
  return row!;
}

/** One full run of the daily job, as the scheduler makes it. */
async function runReminderJob(page: Page): Promise<{ sent: number; dropped: number; failed: number }> {
  const totals = { sent: 0, dropped: 0, failed: 0 };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await page.request.post("/api/cron/review-reminders", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as typeof totals & { configured: boolean; more: boolean };
    expect(body.configured).toBe(true);
    totals.sent += body.sent;
    totals.dropped += body.dropped;
    totals.failed += body.failed;
    if (!body.more) return totals;
  }
  throw new Error("the review reminder job never finished");
}

/** POST a review from inside the page, so it is a same-origin request as a
 *  real one is. */
async function postReview(page: Page, productId: string, orderRef: string) {
  return page.evaluate(
    async ({ productId, orderRef }) => {
      const response = await fetch(`/api/products/${productId}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef, rating: 5, title: "", body: "Not a buyer.", authorName: "Mallory" }),
      });
      return { status: response.status, body: (await response.json()) as { error?: string } };
    },
    { productId, orderRef },
  );
}

/** The reminder switch, from inside the page. */
async function setReminder(page: Page, orderRef: string, want: boolean) {
  return page.evaluate(
    async ({ orderRef, want }) => {
      const response = await fetch("/api/orders/review-reminder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderRef, want }),
      });
      return { status: response.status, body: (await response.json()) as { error?: string; status?: string } };
    },
    { orderRef, want },
  );
}

test("a buyer is asked for a review once they have it, by the one reminder they asked for", async ({ page, browser }) => {
  test.setTimeout(240_000);
  // THE SELLER: a live mug and a vase on one storefront.
  const user = freshUser("buyreview");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await seedStorefronts(sellerId, [{ name: "Mug works" }]);
  const [storefront] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await seedProducts(sellerId, [{ title: "Blue mug", price_cents: 2100 }, { title: "Tall vase", price_cents: 3400 }]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const mug = products.find((product) => product.title === "Blue mug")!.id;
  const vase = products.find((product) => product.title === "Tall vase")!.id;

  // "Buy as a buyer": a paid order of the mug, and the buyer's page for it.
  const sale = await page.request.post("/dev/simulate-sale", { data: { productId: mug, buyer: 0, view: "buyer" } });
  expect(sale.ok(), await sale.text()).toBe(true);
  const { orderId, orderUrl } = (await sale.json()) as { orderId: string; orderUrl: string };
  expect(orderUrl).toMatch(new RegExp(`^/s/${storefront!.id}/order/[^/?]+\\?placed=1$`));
  const mugRef = decodeURIComponent(orderUrl.split("/order/")[1]!.split("?")[0]!);
  const orderPage = orderUrl.split("?")[0]!;

  // THE BUYER: no session of any kind, only the link.
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await buyer.goto(orderUrl);

  // NOTHING TO REVIEW YET: the parcel has not even left. No stars; the offer
  // of one reminder, which nobody gets without pressing for it.
  await expect(buyer.locator("[data-order-timeline]")).toBeVisible();
  await expect(buyer.getByRole("radio")).toHaveCount(0);
  const later = buyer.locator('[data-order-review="later"]');
  await expect(later.getByRole("heading", { name: "Review it once it has arrived" })).toBeVisible();
  await expect(later).toHaveAttribute("data-order-review-reminder", "off");
  // Above the right to withdraw, below what happens next.
  const order = await buyer.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return { timeline: at("[data-order-timeline]"), ask: at("[data-order-review]"), withdrawal: at("[data-order-withdrawal]") };
  });
  expect(order.timeline).toBeLessThan(order.ask);
  expect(order.ask).toBeLessThan(order.withdrawal);
  expect((await reminderOf(orderId)).review_reminder_requested_at).toBeNull();
  const laterAxe = await new AxeBuilder({ page: buyer }).include("[data-order-review]").analyze();
  expect(laterAxe.violations.map((violation) => violation.id)).toEqual([]);
  await buyer.screenshot({ path: test.info().outputPath("thank-you-reminder.png"), fullPage: true });

  // The buyer's yes, recorded with its time.
  await later.getByRole("button", { name: "Email me a reminder" }).click();
  await expect(later).toHaveAttribute("data-order-review-reminder", "on");
  await expect(later.getByText("Lamp Studio Ltd will email you a reminder about a week after it ships.")).toBeVisible();
  expect((await reminderOf(orderId)).review_reminder_requested_at).not.toBeNull();

  // The job sends nothing while the parcel has not shipped.
  const since = new Date().toISOString();
  const reminders = async () =>
    (await devEmails(BUYER_EMAIL)).filter((mail) => mail.at >= since && mail.subject === "Your reminder to review Blue mug");
  await runReminderJob(page);
  expect(await reminders()).toHaveLength(0);
  expect((await reminderOf(orderId)).review_reminder_sent_at).toBeNull();

  // THE SELLER SHIPS IT, and a week goes by (dated back, not waited for).
  const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS).toISOString();
  await serviceRest(`/orders?id=eq.${orderId}`, {
    method: "PATCH",
    body: { fulfilment_status: "shipped", shipped_at: eightDaysAgo, review_reminder_requested_at: eightDaysAgo },
  });

  // Shipped means the page asks now, and still shows the reminder that is on.
  await buyer.goto(orderPage);
  const ask = buyer.locator('[data-order-review="ask"]');
  await expect(ask.getByRole("heading", { name: "How would you rate it?" })).toBeVisible();
  await expect(buyer.locator("[data-order-review-reminder]")).toHaveAttribute("data-order-review-reminder", "on");

  // THE JOB sends it once.
  await runReminderJob(page);
  await expect.poll(async () => (await reminders()).length).toBe(1);
  const [mail] = await reminders();
  expect((await reminderOf(orderId)).review_reminder_sent_at).not.toBeNull();
  expect(mail!.fromName).toBe("Lamp Studio Ltd via Square Share");
  expect(mail!.text).toContain("you asked Lamp Studio Ltd to remind you to review your order");
  expect(mail!.text).toContain("Every review is welcome, good or bad.");
  // Who sent it and where they are, as anti-spam law wants.
  expect(mail!.text).toContain("Sold by\nLamp Studio Ltd");
  const reviewLink = pathOf(mail!.text.match(/https?:\/\/\S+\?review=write/)![0]);
  const stopLink = pathOf(mail!.text.match(/https?:\/\/\S+\?review=stop/)![0]);
  expect(reviewLink).toBe(`${orderPage}?review=write`);
  expect(stopLink).toBe(`${orderPage}?review=stop`);
  expect(mail!.unsubscribeUrl).toMatch(/^https?:\/\/[^/]+\/api\/orders\/review-reminder\/unsubscribe\?ref=/);
  // Never twice.
  await runReminderJob(page);
  expect(await reminders()).toHaveLength(1);

  // THE EMAIL'S LINK: the order page, with the review in a dialog.
  await buyer.goto(reviewLink);
  const dialog = buyer.getByRole("dialog", { name: "How would you rate it?" });
  await expect(dialog).toBeVisible();
  await dialog.locator("label", { has: buyer.getByRole("radio", { name: "4 stars" }) }).click();
  await expect(dialog.getByText("Very good")).toBeVisible();
  // The name is the first name on the order, theirs to change.
  await expect(dialog.getByLabel("Name to show")).toHaveValue("Aoife");
  const dialogAxe = await new AxeBuilder({ page: buyer }).include('[role="dialog"]').analyze();
  expect(dialogAxe.violations.map((violation) => violation.id)).toEqual([]);
  await buyer.screenshot({ path: test.info().outputPath("review-dialog.png") });
  await dialog.getByLabel("Title (optional)").fill("My new favourite mug");
  await dialog.getByLabel("Your review").fill("Holds a big coffee and the glaze is lovely.");
  await dialog.getByRole("button", { name: "Post review" }).click();
  await expect(dialog.getByRole("heading", { name: "Thanks for your review" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Rated 4 stars out of 5" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(buyer.locator("[data-order-review]")).toHaveAttribute("data-order-review", "done");

  // STORED as a native review from a verified buyer, on that order.
  const [stored] = (await serviceRest(
    `/reviews?product_id=eq.${mug}&select=id,order_id,source,rating,title,body,author_name,is_verified_buyer`,
  )) as ReviewRow[];
  expect(stored).toMatchObject({
    order_id: orderId,
    source: "native",
    rating: 4,
    title: "My new favourite mug",
    body: "Holds a big coffee and the glaze is lovely.",
    author_name: "Aoife",
    is_verified_buyer: true,
  });

  // Back on the page later, even by the email's link: the stars they gave.
  await buyer.goto(reviewLink);
  await expect(buyer.locator("[data-order-review]")).toHaveAttribute("data-order-review", "done");
  await expect(buyer.getByRole("img", { name: "Rated 4 stars out of 5" })).toBeVisible();
  await expect(buyer.getByRole("dialog")).toHaveCount(0);

  // THE STOP LINK works without signing in, whatever else is true.
  await buyer.goto(stopLink);
  const stop = buyer.getByRole("dialog", { name: "Stop the reminder?" });
  await stop.getByRole("button", { name: "Stop the reminder" }).click();
  await expect(buyer.getByRole("dialog", { name: "Reminder stopped" })).toBeVisible();
  expect((await reminderOf(orderId)).review_reminder_stopped_at).not.toBeNull();

  // The mail client's one-click unsubscribe: a cross-site POST, no cookies.
  const unsubscribe = pathOf(mail!.unsubscribeUrl!);
  const oneClick = await buyerContext.request.post(unsubscribe, {
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.example" },
    data: "List-Unsubscribe=One-Click",
  });
  expect(oneClick.status()).toBe(200);
  // A plain visit (a link scanner) changes nothing and lands on the stop dialog.
  const visit = await buyerContext.request.get(unsubscribe, { maxRedirects: 0 });
  expect(visit.status()).toBe(303);
  expect(visit.headers().location).toContain(`/s/${storefront!.id}/order/`);
  expect(visit.headers().location).toContain("?review=stop");

  // ONLY A BUYER. A link that proves nothing is the same 404 as no order...
  expect(await postReview(buyer, mug, `${orderId}.forged`)).toMatchObject({ status: 404, body: { error: "not_found" } });
  expect(await setReminder(buyer, `${orderId}.forged`, true)).toMatchObject({ status: 404 });
  // ...a real link proves only ITS order, not one of another product...
  expect(await postReview(buyer, vase, mugRef)).toMatchObject({ status: 404, body: { error: "not_found" } });
  // ...an order is reviewed once, and a reviewed order takes no new reminder.
  expect(await postReview(buyer, mug, mugRef)).toMatchObject({ status: 409, body: { error: "already_reviewed" } });
  expect(await setReminder(buyer, mugRef, true)).toMatchObject({ status: 200, body: { status: "sent" } });
  expect((await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id`)) as unknown[]).toHaveLength(1);
  await buyerContext.close();

  // THE SELLER tidies up: reviews from pretend orders are deleted, nothing else.
  await page.goto("/dev/simulate-sale");
  await page.getByRole("button", { name: "Delete reviews from pretend orders" }).click();
  await expect(page.getByRole("status")).toHaveText("Deleted 1.");
  expect((await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id`)) as unknown[]).toHaveLength(0);
});
