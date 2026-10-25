import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * THE WEBSITE BUY BUTTON, end to end.
 *
 * A seller who sells one product takes a link from the product card ("Add to
 * your website") and puts it on their own site's button. A buyer who follows
 * it lands on the hosted product page, then the checkout, and pays; the visit,
 * the checkout view and the order are all filed under the `button` channel
 * ("Buy button on your site"), which is what the seller then sees in Orders and
 * Analytics. The marker survives the buyer changing their mind on the page and
 * the checkout sending them back, and a forged one is filed as `direct`.
 *
 * NEEDS the stack started with CHECKOUT_TEST_PAYMENTS=1 (see 78-checkout):
 * without it there is no checkout to pay through, and the spec skips.
 */

const THEME = {
  background: { kind: "solid", color: "#f6f1e7" },
  accent: "#1f4d3a",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 12,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

const SIZE_GROUP = "82000000-0000-4000-8000-000000000001";
const SMALL = "82000000-0000-4000-8000-000000000002";
const LARGE = "82000000-0000-4000-8000-000000000003";

type Seeded = { sellerId: string; storefrontId: string; lamp: string; unplaced: string };

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: `Lamp Works ${tag}` });
  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    {
      title: "Oak lamp",
      price_cents: 3900,
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
    },
    { title: "Loose bulb", price_cents: 500 },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const lamp = products.find((product) => product.title === "Oak lamp")!.id;
  const unplaced = products.find((product) => product.title === "Loose bulb")!.id;
  // ONE product on ONE storefront: the single-product seller this is for.
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: { config: { theme: THEME, blocks: [{ type: "product", productId: lamp, x: 0, y: 0, w: 2, h: 2 }] } },
  });
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "IE",
        ratesCurrency: "EUR",
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return { sellerId, storefrontId, lamp, unplaced };
}

/** The "Add to your website" dialog for one product, opened from its card. */
async function openBuyButton(page: Page, title: string) {
  await page.goto("/products");
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("button", { name: "Add to your website" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a buy button to your website" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * A buyer: a fresh browser with no session, as anyone following a link is.
 * Each gets a browser identity of its own, because views are deduped per
 * visitor (IP and user agent) per product per hour: sharing the seller's would
 * fold a buyer's view into whatever this spec's own probes had already loaded.
 */
async function buyer(browser: Browser, baseURL: string | undefined, visitor: string) {
  const context = await browser.newContext({ baseURL, userAgent: `e2e-${visitor}` });
  return { context, page: await context.newPage() };
}

/** The channels this seller's signals were filed under, for one kind. */
async function signalChannels(sellerId: string, kind: string): Promise<string[]> {
  const rows = (await serviceRest(
    `/storefront_signals?account_id=eq.${sellerId}&kind=eq.${kind}&select=channel`,
  )) as { channel: string }[];
  return rows.map((row) => row.channel);
}

/** Whether this stack can take a test payment for the seeded lamp. */
async function checkoutOffered(page: Page, s: Seeded): Promise<boolean> {
  const response = await page.request.get(`/s/${s.storefrontId}/p/${s.lamp}/checkout?o=${SMALL}`, {
    maxRedirects: 0,
  });
  return response.status() === 200;
}

test.describe("the website buy button", () => {
  test("a seller's button link sells, and the sale is filed under Buy button on your site", async ({
    page,
    browser,
    baseURL,
  }) => {
    // The whole journey, eight routes: on a dev server that has only just
    // started, each one compiles on first use.
    test.setTimeout(180_000);
    const s = await seed(page, "bb-sell");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");

    // 1. The seller takes the link from the product card.
    const dialog = await openBuyButton(page, "Oak lamp");
    const state = dialog.locator("[data-buy-button-state]");
    await expect(state).toHaveAttribute("data-buy-button-state", "ready");
    const url = (await state.getAttribute("data-buy-button-url"))!;
    expect(url).toMatch(new RegExp(`^https?://[^/]+/s/${s.storefrontId}/p/${s.lamp}\\?via=button$`));
    // One thing to copy at a time, and a picture instead of a paragraph.
    const story = dialog.locator("[data-buy-button-flow]");
    await expect(story).toHaveAttribute("data-buy-button-flow", "live");
    // The motion graphic plays through to the checkout by itself, and the
    // seller can stop it.
    await expect(story).toHaveAttribute("data-buy-button-scene", "checkout", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Pause the animation" }).click();
    await expect(dialog.getByRole("button", { name: "Play the animation" })).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("textbox", { name: "Link" })).toHaveText(url);
    // One storefront, so there is nothing to choose.
    await expect(dialog.getByRole("combobox", { name: "Page design" })).toHaveCount(0);
    const scan = async () => {
      await page.waitForTimeout(400); // let the sheet settle before axe reads colours
      const axe = await new AxeBuilder({ page }).include("[role='dialog']").analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    };
    await scan();

    // The code surface's border really flows in a browser (a registered angle
    // that keeps turning), and holds still for someone who asked for less motion.
    const surface = dialog.locator(".code-surface");
    const borderFlow = () =>
      surface.evaluate((node) => {
        const ring = getComputedStyle(node, "::before");
        return {
          ring: ring.animationName,
          angle: parseFloat(ring.getPropertyValue("--flow-angle")),
        };
      });
    const before = await borderFlow();
    await page.waitForTimeout(700);
    const after = await borderFlow();
    expect(before.ring).toBe("code-flow");
    expect(after.angle).not.toBe(before.angle);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect((await borderFlow()).ring).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // The same link as one line of HTML...
    const snippet = `<a href="${url}">Buy now</a>`;
    await dialog.getByRole("button", { name: "HTML" }).click();
    await expect(dialog.getByRole("textbox", { name: "HTML" })).toHaveText(snippet);

    // ...and as a prompt for an AI agent, which copies whole and names the
    // URL and the snippet but nothing the seller typed.
    await dialog.getByRole("button", { name: "AI agent" }).click();
    const prompt = dialog.getByRole("textbox", { name: "AI agent" });
    await expect(prompt).toContainText(url);
    await expect(prompt).not.toContainText("Oak lamp");
    await scan();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await dialog.getByRole("button", { name: "Copy the prompt" }).click();
    // Windows hands clipboard text back with CRLF line endings.
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
    expect(copied[1]).toBe(url);
    expect(copied).toContain(snippet);
    expect(copied.filter((line) => line.startsWith("- "))).toHaveLength(3);

    // 2. A buyer follows it, changes their mind on the size, and goes on.
    const { context, page: shopper } = await buyer(browser, baseURL, "button-buyer");
    const path = new URL(url);
    await shopper.goto(`${path.pathname}${path.search}`);
    await shopper.getByRole("radio", { name: "Large" }).or(shopper.getByRole("button", { name: "Large" })).first().click();
    await expect(shopper).toHaveURL(/via=button/);
    const cta = shopper.locator("[data-product-cta='checkout']").first();
    const href = (await cta.locator("a").getAttribute("href"))!;
    expect(href).toContain(`o=${LARGE}`);
    expect(href).toContain("via=button");
    await cta.locator("a").click();
    await expect(shopper).toHaveURL(/\/checkout\?.*via=button/);

    await shopper.getByLabel("Email").fill("maeve@example.test");
    await shopper.getByLabel("Full name").fill("Maeve Doyle");
    await shopper.getByLabel("Address", { exact: true }).fill("3 Quay Street");
    await shopper.getByLabel("Town or city").fill("Cork");
    await shopper.getByLabel("Postcode").fill("T12 AB34");
    const payButton = shopper.locator("form [data-checkout-pay]");
    await expect(payButton).toBeEnabled({ timeout: 20_000 });
    await payButton.click();
    await expect(shopper).toHaveURL(new RegExp(`/s/${s.storefrontId}/order/`), { timeout: 20_000 });
    await context.close();

    // 3. Everything it did is filed under the button.
    const [order] = (await serviceRest(`/orders?seller_id=eq.${s.sellerId}&select=channel,amount_cents`)) as {
      channel: string;
      amount_cents: number;
    }[];
    expect(order).toEqual({ channel: "button", amount_cents: 3900 + 450 });
    await expect.poll(() => signalChannels(s.sellerId, "product_view")).toEqual(["button"]);
    // Beside the `direct` view this spec's own availability probe made.
    await expect.poll(async () => (await signalChannels(s.sellerId, "checkout_view")).sort()).toEqual([
      "button",
      "direct",
    ]);

    // 4. The seller sees it as Buy button on your site in Orders...
    await page.goto("/orders?view=all&channel=button");
    await expect(page.getByRole("button", { name: "Buy button on your site" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("row").filter({ hasText: "Oak lamp" })).toContainText("Buy button on your site");

    // ...and in Analytics: the revenue split and the product page views split.
    await page.goto("/analytics");
    const raw = await page.locator("#analytics-snapshot").textContent();
    const snapshot = JSON.parse(raw!) as {
      sales: { channels: { channel: string; revenueCents: number }[] };
      signals: { byKind: Record<string, { channels: { channel: string; count: number }[] }> };
    };
    expect(snapshot.sales.channels.find((c) => c.channel === "button")?.revenueCents).toBe(4350);
    expect(snapshot.signals.byKind.product_view.channels.find((c) => c.channel === "button")?.count).toBe(1);
    expect(snapshot.signals.byKind.checkout_view.channels.find((c) => c.channel === "button")?.count).toBe(1);
    await expect(page.getByText("Buy button on your site").first()).toBeVisible();
  });

  test("the marker survives the checkout sending a buyer back, and a forged one counts as direct", async ({
    page,
    browser,
    baseURL,
  }) => {
    const s = await seed(page, "bb-hops");
    test.skip(!(await checkoutOffered(page, s)), "stack started without CHECKOUT_TEST_PAYMENTS=1");
    const { context, page: shopper } = await buyer(browser, baseURL, "sent-back-buyer");

    // No size chosen: the checkout cannot be for a specific version, so it
    // sends the buyer back to choose, and the marker goes with them.
    await shopper.goto(`/s/${s.storefrontId}/p/${s.lamp}/checkout?via=button`);
    await expect(shopper).toHaveURL(new RegExp(`/s/${s.storefrontId}/p/${s.lamp}\\?via=button$`));
    await expect.poll(() => signalChannels(s.sellerId, "product_view")).toEqual(["button"]);
    await context.close();

    // A value we do not know is no marker at all. A second visitor, so the
    // hourly per-visitor dedupe cannot hide it.
    const { context: forged, page: forgedPage } = await buyer(browser, baseURL, "forged-marker");
    await forgedPage.goto(`/s/${s.storefrontId}/p/${s.lamp}?via=marketplace`);
    await expect(forgedPage.locator("[data-product-cta='checkout'] a").first()).not.toHaveAttribute(
      "href",
      /via=/,
    );
    await expect.poll(async () => (await signalChannels(s.sellerId, "product_view")).sort()).toEqual([
      "button",
      "direct",
    ]);
    await forged.close();
  });

  test("on a phone, the dialog explains a product with no page instead of handing out a link", async ({ page }) => {
    const s = await seed(page, "bb-phone");
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openBuyButton(page, "Loose bulb");
    await expect(dialog.locator("[data-buy-button-state]")).toHaveAttribute("data-buy-button-state", "notPlaced");
    await expect(dialog.getByRole("link", { name: /go to storefronts/i })).toHaveAttribute("href", "/storefront");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog.locator("[data-buy-button-flow]")).toHaveAttribute("data-buy-button-flow", "locked");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
    expect(s.unplaced).toBeTruthy();
  });

  test("the Orders channel filter names all four channels and fits, at every width", async ({
    page,
    context,
    baseURL,
  }) => {
    const user = freshUser("bb-widths");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 4350, channel: "button", product_title: "Oak lamp" },
      { amount_cents: 1500, channel: "embed", product_title: "Loose bulb" },
    ]);
    // Another language than English, with the label read from its catalogue so
    // a reworded translation cannot break this.
    await context.addCookies([{ name: "ss_locale", value: "pl", url: baseURL! }]);
    const catalogue = JSON.parse(readFileSync(join(process.cwd(), "messages/pl/orders.json"), "utf8")) as {
      channel: { button: string };
    };
    const button = catalogue.channel.button;

    // A phone, a tablet beside the sidebar, a small laptop, a desktop.
    for (const width of [360, 390, 820, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/orders?view=all");
      await expect(page.locator("[data-tour='orders-filters']")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const bar = document.querySelector("[data-tour='orders-filters']")!;
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          toolbar: bar.scrollWidth - bar.clientWidth,
        };
      });
      expect(overflow, `${width}px wide`).toEqual({ page: 0, toolbar: 0 });
    }

    // Where the toggle has no room, the channels are a list, with their names.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/orders?view=all");
    await expect(page.getByRole("button", { name: button })).toHaveCount(0);
    // Retried, because the first navigation after a page load can be swallowed
    // by the notification bell's own start-up request (a race in the dashboard
    // shell, not in this filter): choosing again is what a seller would do.
    await expect(async () => {
      await page.locator("#orders-channel").click();
      await page.getByRole("option", { name: button }).click();
      await expect(page).toHaveURL(/channel=button/, { timeout: 4_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText("Oak lamp")).toBeVisible();
    await expect(page.getByText("Loose bulb")).toHaveCount(0);

    // Where it has, the same choice shows as the one-click toggle.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("button", { name: button })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#orders-channel")).toBeHidden();
  });
});
