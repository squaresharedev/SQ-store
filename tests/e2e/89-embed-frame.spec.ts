import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  APP,
  PRODUCT_PAGE,
  SECRET_STOCK,
  SELLER_SITE,
  SLOT_FRAME,
  frameHeight,
  frameStatuses,
  hostPage,
  saveConfig,
  seedShop,
  visitor,
} from "./embed-shop";
import { serviceRest } from "./helpers";

/**
 * THE STOREFRONT EMBED, end to end: a seller's board drawn inside their own
 * website by the snippet they pasted.
 *
 * It only means anything across two origins, so this spec uses two names for
 * the one machine. The app (the loader and the frame) is http://localhost:3100;
 * the "seller's website" is /dev/embed-host opened as http://shop.localhost:3100
 * (browsers resolve every *.localhost name to this machine). The storefront
 * lists `shop.localhost`; `other.localhost` is everyone else.
 *
 *   - On the listed site the storefront appears: live tiles that open their
 *     product page in a new tab, marked as arriving from the embed. The frame
 *     is as tall as its content, sandboxed, named, and keeps nothing on the
 *     visitor's device. It is counted as a view under the embed.
 *   - On any other site there is nothing: not an error, not a box.
 *   - A site that CLAIMS to be the listed one is served, and its own browser
 *     refuses to draw what it was served. That is the half no server check
 *     can do, and the reason the site's name rides in the frame's address.
 *   - The frame is not a page: opened directly it is a 404.
 *   - Rotating the key, or switching product pages off, takes it down.
 *   - A product opened from a tile is a click, counted where it lands.
 */

async function signalChannels(sellerId: string, kind: string): Promise<string[]> {
  const rows = (await serviceRest(
    `/storefront_signals?account_id=eq.${sellerId}&kind=eq.${kind}&select=channel`,
  )) as { channel: string }[];
  return rows.map((row) => row.channel);
}

test.describe("the storefront embed", () => {
  test("on the seller's own site: the board, sized to fit, with tiles that open their product page", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-shown");
    const { context, page: site } = await visitor(browser, "shown");
    const statuses = frameStatuses(site);

    await site.goto(hostPage(SELLER_SITE, shop.embedKey));
    const frame = site.frameLocator(SLOT_FRAME);
    const board = frame.locator(`[data-embed-frame='${shop.storefrontId}']`);
    await expect(board).toBeVisible({ timeout: 90_000 });
    expect(statuses).toContain(200);

    // The seller's words and their one live product, as a tile.
    // Named a level down: the top heading belongs to the seller's own page.
    await expect(frame.getByRole("heading", { level: 2, name: shop.store })).toBeAttached();
    await expect(frame.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(board).toContainText("New pieces every Friday");
    const tiles = board.locator("[data-storefront-tile]");
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toContainText("Stoneware vase");

    // The tile is a plain link to the hosted product page, in a tab of its
    // own, filed under the embed.
    const href = (await tiles.first().getAttribute("href")) ?? "";
    expect(new URL(href).pathname).toBe(`/s/${shop.storefrontId}/p/${shop.vase}`);
    expect(new URL(href).searchParams.get("via")).toBe("embed");
    await expect(tiles.first()).toHaveAttribute("target", "_blank");
    await expect(tiles.first()).toHaveAttribute("rel", /noopener/);

    // Nothing seller-private rode along.
    const frameHtml = await site.frames().find((child) => child.url().includes("/e/"))!.content();
    expect(frameHtml).not.toContain(String(SECRET_STOCK));
    expect(frameHtml).not.toContain(shop.sellerId);

    // The frame took the height its content reported, and the name it sent.
    await expect.poll(() => frameHeight(site), { timeout: 20_000 }).toBeGreaterThan(150);
    const inner = await board.evaluate((element) => Math.ceil(element.getBoundingClientRect().height));
    await expect.poll(() => frameHeight(site)).toBe(inner);
    await expect(site.locator(SLOT_FRAME)).toHaveAttribute("title", `What ${shop.store} sells`);
    // The seller's own page carries on underneath, not under a stretched box.
    await expect(site.locator("[data-after-embed]")).toBeVisible();

    // What the frame may do is fixed by the page that made it.
    const sandbox = (await site.locator(SLOT_FRAME).getAttribute("sandbox")) ?? "";
    expect(sandbox.split(" ").sort()).toEqual(
      ["allow-forms", "allow-popups", "allow-popups-to-escape-sandbox", "allow-same-origin", "allow-scripts"].sort(),
    );

    // One line at the foot: who sells, whose software, our privacy notice, and
    // a way to report it that lands on the hosted page's own report link.
    const foot = frame.locator("[data-embed-frame-footer]");
    await expect(foot).toContainText(`Sold by ${shop.store}`);
    await expect(foot.getByRole("link", { name: "Square Share Privacy Policy" })).toHaveAttribute(
      "href",
      "https://squareshare.eu/legal/privacy-policy/",
    );
    const report = (await foot.locator("[data-embed-frame-report]").getAttribute("href")) ?? "";
    expect(new URL(report).pathname).toBe(`/s/${shop.storefrontId}`);
    expect(new URL(report).hash).toBe("#report");

    // Nothing kept on the visitor's device: no cookie from any origin, and
    // nothing in the frame's storage.
    expect(await context.cookies()).toEqual([]);
    const stored = await site
      .frames()
      .find((child) => child.url().includes("/e/"))!
      .evaluate(() => ({
        local: Object.keys(window.localStorage),
        // The one entry that is not ours: the dev server's own React debug
        // channel (next/dist/client/dev/debug-channel.js), loaded only when
        // the app is served by `next dev`, as it is in this stack. A
        // production build contains no such code.
        session: Object.keys(window.sessionStorage).filter((key) => !key.startsWith("__next_debug_channel:")),
      }));
    expect(stored).toEqual({ local: [], session: [] });

    // A view, filed under the embed, once.
    await expect.poll(() => signalChannels(shop.sellerId, "storefront_view"), { timeout: 20_000 }).toEqual(["embed"]);
    await site.reload();
    await expect(site.frameLocator(SLOT_FRAME).locator("[data-embed-frame]")).toBeVisible({ timeout: 60_000 });
    await site.waitForTimeout(1_500);
    expect(await signalChannels(shop.sellerId, "storefront_view")).toEqual(["embed"]);

    // A tile opens a tab of its own; the seller's page stays where it is.
    // (The stack's product links name the developer's own dev server, so the
    // new tab is answered here rather than left to find one.)
    await context.route(
      (url) => url.pathname === `/s/${shop.storefrontId}/p/${shop.vase}`,
      (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>product</title>" }),
    );
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      site.frameLocator(SLOT_FRAME).locator("[data-storefront-tile]").first().click(),
    ]);
    expect(new URL(tab.url()).searchParams.get("via")).toBe("embed");
    expect(new URL(site.url()).hostname).toBe(SELLER_SITE);
    await context.close();
  });

  test("keeps inside a narrow column, and its focus ring can be seen", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-narrow");
    // One unbroken word wider than the column, in the footer's "Sold by".
    await serviceRest(`/profiles?id=eq.${shop.sellerId}`, {
      method: "PATCH",
      body: { tax_business_name: `Handwerk${"x".repeat(48)}GmbH` },
    });
    const { context, page: site } = await visitor(browser, "narrow");
    await site.setViewportSize({ width: 320, height: 800 });
    await site.goto(hostPage(SELLER_SITE, shop.embedKey));
    await expect(site.frameLocator(SLOT_FRAME).locator("[data-embed-frame]")).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => frameHeight(site), { timeout: 20_000 }).toBeGreaterThan(150);
    const frame = site.frames().find((child) => child.url().includes("/e/"))!;
    const width = await frame.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);

    // From the keyboard, the ring is the board's own ink, which reads on its
    // background (the dashboard's grey is 2.3:1 on a cream one).
    await frame.evaluate(() => (document.querySelector("[data-storefront-tile]") as HTMLElement).focus());
    await site.keyboard.press("Tab");
    await site.keyboard.press("Shift+Tab");
    const ring = await frame.evaluate(() => {
      const tile = document.querySelector("[data-storefront-tile]") as HTMLElement;
      const style = getComputedStyle(tile);
      return { shadow: style.boxShadow, ink: style.color };
    });
    expect(ring.shadow).toContain(ring.ink);
    await context.close();
  });

  test("passes an accessibility scan, frame included", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-a11y");
    const { context, page: site } = await visitor(browser, "a11y");
    await site.goto(hostPage(SELLER_SITE, shop.embedKey));
    await expect(site.frameLocator(SLOT_FRAME).locator("[data-embed-frame]")).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => frameHeight(site), { timeout: 20_000 }).toBeGreaterThan(150);
    // The bar the rest of the suite holds (tests/e2e/a11y): nothing serious or
    // critical, on the seller's page and inside the frame alike.
    const results = await new AxeBuilder({ page: site }).exclude("nextjs-portal").analyze();
    // A guest in someone else's page: it adds no second <main> to theirs.
    expect(results.violations.map((violation) => violation.id)).not.toContain("landmark-unique");
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
    expect(serious).toEqual([]);
    await context.close();
  });

  test("on any other site: nothing at all, and nothing counted", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-unlisted");
    const { context, page: site } = await visitor(browser, "unlisted");
    const statuses = frameStatuses(site);

    await site.goto(hostPage("other.localhost", shop.embedKey));
    // The loader still makes its frame; what it asked for is refused, as
    // quietly as a wrong key would be.
    await expect(site.locator(SLOT_FRAME)).toHaveCount(1);
    await expect.poll(() => statuses, { timeout: 60_000 }).toContain(404);
    await site.waitForTimeout(1_500);
    expect(await frameHeight(site)).toBe(0);
    await expect(site.frameLocator(SLOT_FRAME).locator("[data-embed-frame]")).toHaveCount(0);
    // Not an error message in the middle of someone's page, either.
    await expect(site.frameLocator(SLOT_FRAME).locator("body")).toHaveText("");
    expect(await signalChannels(shop.sellerId, "storefront_view")).toEqual([]);
    await context.close();
  });

  test("a site that claims to be the seller's is refused by its own browser", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-claim");
    const claim = `&claim=${SELLER_SITE}:3100`;

    // Control: the same hand-written frame, on the site it names, is drawn. So
    // what fails below is the lie, not the harness.
    const honest = await visitor(browser, "claim-honest");
    await honest.page.goto(hostPage(SELLER_SITE, shop.embedKey, claim));
    await expect(
      honest.page.frameLocator("[data-claimed-frame]").locator(`[data-embed-frame='${shop.storefrontId}']`),
    ).toBeVisible({ timeout: 90_000 });
    await honest.context.close();

    const liar = await visitor(browser, "claim-liar");
    const statuses = frameStatuses(liar.page);
    const refusals: string[] = [];
    liar.page.on("console", (message) => {
      if (/frame-ancestors/i.test(message.text())) refusals.push(message.text());
    });
    await liar.page.goto(hostPage("other.localhost", shop.embedKey, claim));
    // The server has no way to know: the address names an allowed site, so it
    // answers. The browser knows where it really is.
    await expect.poll(() => statuses, { timeout: 60_000 }).toContain(200);
    await expect.poll(() => refusals.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(
      liar.page.frameLocator("[data-claimed-frame]").locator("[data-embed-frame]"),
    ).toHaveCount(0);
    await liar.context.close();
  });

  test("is a frame, never a page: opened directly it is not found", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-direct");
    const { context, page: direct } = await visitor(browser, "direct");
    const response = await direct.goto(`${APP}/e/${shop.embedKey}/${SELLER_SITE}:3100`);
    expect(response?.status()).toBe(404);
    await expect(direct.locator("[data-embed-frame]")).toHaveCount(0);
    // And the dashboard itself still refuses to be framed by anyone.
    const login = await direct.request.get(`${APP}/login`);
    expect(login.headers()["x-frame-options"]).toBe("DENY");
    expect(login.headers()["content-security-policy"]).toBeUndefined();
    await context.close();
  });

  test("comes down when the key is rotated, embedding is switched off, or product pages are", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const shop = await seedShop(page, "embed-down");

    async function expectShown(name: string, key: string, shown: boolean) {
      const { context, page: site } = await visitor(browser, name);
      const statuses = frameStatuses(site);
      await site.goto(hostPage(SELLER_SITE, key));
      if (shown) {
        await expect(site.frameLocator(SLOT_FRAME).locator("[data-embed-frame]")).toBeVisible({ timeout: 90_000 });
      } else {
        await expect.poll(() => statuses, { timeout: 60_000 }).toContain(404);
        await site.waitForTimeout(1_000);
        expect(await frameHeight(site)).toBe(0);
      }
      await context.close();
    }

    await expectShown("down-before", shop.embedKey, true);

    // Product pages off: tiles that lead nowhere are not a shop.
    await saveConfig(shop, { productPage: { ...PRODUCT_PAGE, enabled: false } });
    await expectShown("down-pages", shop.embedKey, false);

    // Embedding off.
    await saveConfig(shop, { embed: { enabled: false, domains: [SELLER_SITE] } });
    await expectShown("down-off", shop.embedKey, false);

    // Back on, then the key rotated: every pasted copy of the old one is dead.
    await saveConfig(shop);
    await expectShown("down-restored", shop.embedKey, true);
    const rotated = "0f0f0f0f-1111-4222-8333-444444444444";
    await serviceRest(`/storefronts?id=eq.${shop.storefrontId}`, { method: "PATCH", body: { embed_key: rotated } });
    await expectShown("down-old-key", shop.embedKey, false);
    await expectShown("down-new-key", rotated, true);
  });

  test("a product opened from a tile is a click, counted where it lands", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "embed-click");
    const productPath = `/s/${shop.storefrontId}/p/${shop.vase}`;

    // Arriving any other way is a view and nothing more.
    const direct = await visitor(browser, "click-direct");
    expect((await direct.page.goto(`${APP}${productPath}`))?.status()).toBe(200);
    await expect.poll(() => signalChannels(shop.sellerId, "product_view"), { timeout: 20_000 }).toEqual(["direct"]);
    expect(await signalChannels(shop.sellerId, "product_click")).toEqual([]);
    await direct.context.close();

    // Arriving from an embed tile is a view under the embed, and a click.
    const fromEmbed = await visitor(browser, "click-embed");
    expect((await fromEmbed.page.goto(`${APP}${productPath}?via=embed`))?.status()).toBe(200);
    await expect.poll(() => signalChannels(shop.sellerId, "product_click"), { timeout: 20_000 }).toEqual(["embed"]);
    expect((await signalChannels(shop.sellerId, "product_view")).sort()).toEqual(["direct", "embed"]);

    // A reload is the same visit, not a second click.
    await fromEmbed.page.reload();
    await fromEmbed.page.waitForTimeout(1_500);
    expect(await signalChannels(shop.sellerId, "product_click")).toEqual(["embed"]);
    await fromEmbed.context.close();
  });
});
