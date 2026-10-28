import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A BUYER LEAVES A REVIEW from the thank-you page, through the real app and
 * the real database, with only the payment pretend:
 *
 *   - the seller's "Buy as a buyer" (/dev/simulate-sale, development only)
 *     records a paid order through the real writer and lands on the buyer's
 *     thank-you page, as a buyer straight after paying does;
 *   - the page asks for a review: five stars, and the rest opens once one is
 *     chosen;
 *   - an ANONYMOUS visitor holding that page's link posts it, and it is stored
 *     as a native review from a verified buyer, on that order;
 *   - opening the page again shows the stars given, not the form;
 *   - nobody else can review: a link that proves nothing, the link of an order
 *     of a different product, and a second review of the same order are all
 *     refused;
 *   - the seller can delete reviews written from pretend orders.
 */

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

test("a buyer reviews their purchase from the thank-you page, and only a buyer can", async ({ page, browser }) => {
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

  // THE BUYER: no session of any kind, only the link.
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await buyer.goto(orderUrl);
  const ask = buyer.locator("[data-order-review]");
  await expect(ask).toHaveAttribute("data-order-review", "ask");
  await expect(ask.getByRole("heading", { name: "How would you rate it?" })).toBeVisible();
  // One question first: no form until a star is chosen.
  await expect(ask.locator("[data-order-review-form]")).toHaveCount(0);
  // Above the right to withdraw, below what happens next.
  const order = await buyer.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return { timeline: at("[data-order-timeline]"), ask: at("[data-order-review]"), withdrawal: at("[data-order-withdrawal]") };
  });
  expect(order.timeline).toBeLessThan(order.ask);
  expect(order.ask).toBeLessThan(order.withdrawal);

  // Click the star, as a buyer does (the radio itself is visually hidden).
  await ask.locator("label", { has: buyer.getByRole("radio", { name: "4 stars" }) }).click();
  await expect(ask.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(ask.getByText("Very good")).toBeVisible();
  const form = ask.locator("[data-order-review-form]");
  await expect(form).toBeVisible();
  // The name is the first name on the order, theirs to change.
  await expect(form.getByLabel("Name to show")).toHaveValue("Aoife");
  const axe = await new AxeBuilder({ page: buyer }).include("[data-order-review]").analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await buyer.screenshot({ path: test.info().outputPath("review-ask.png"), fullPage: true });

  await form.getByLabel("Title (optional)").fill("My new favourite mug");
  await form.getByLabel("Your review").fill("Holds a big coffee and the glaze is lovely.");
  await form.getByRole("button", { name: "Post review" }).click();
  await expect(ask).toHaveAttribute("data-order-review", "sent");
  await expect(ask.getByRole("heading", { name: "Thanks for your review" })).toBeVisible();
  await expect(ask.getByRole("img", { name: "Rated 4 stars out of 5" })).toBeVisible();
  // A real buyer's page never says it was a preview.
  await expect(ask.getByText("nothing was posted")).toHaveCount(0);

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

  // Back on the page later: the stars they gave, not the form.
  await buyer.goto(orderUrl.split("?")[0]!);
  await expect(ask).toHaveAttribute("data-order-review", "done");
  await expect(ask.getByRole("img", { name: "Rated 4 stars out of 5" })).toBeVisible();
  await expect(ask.locator("[data-order-review-form]")).toHaveCount(0);

  // ONLY A BUYER. A link that proves nothing is the same 404 as no order...
  expect(await postReview(buyer, mug, `${orderId}.forged`)).toMatchObject({ status: 404, body: { error: "not_found" } });
  // ...a real link proves only ITS order, not one of another product...
  expect(await postReview(buyer, vase, mugRef)).toMatchObject({ status: 404, body: { error: "not_found" } });
  // ...and an order is reviewed once.
  expect(await postReview(buyer, mug, mugRef)).toMatchObject({ status: 409, body: { error: "already_reviewed" } });
  expect((await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id`)) as unknown[]).toHaveLength(1);
  await buyerContext.close();

  // THE SELLER tidies up: reviews from pretend orders are deleted, nothing else.
  await page.goto("/dev/simulate-sale");
  await page.getByRole("button", { name: "Delete reviews from pretend orders" }).click();
  await expect(page.getByRole("status")).toHaveText("Deleted 1.");
  expect((await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id`)) as unknown[]).toHaveLength(0);
});
