import { expect, test, type BrowserContext, type FrameLocator, type Page } from "@playwright/test";
import { APP, SELLER_SITE, SLOT_FRAME, frameStatuses, hostPage, seedShop, visitor, type Shop } from "./embed-shop";

/**
 * THE EMBED INSIDE SITE BUILDERS: the same snippet, pasted where a builder
 * puts it, which is often not on the page itself but in a frame of the
 * builder's own, on a host of the builder's own.
 *
 * Every page above the embed's frame has to be named in its frame-ancestors,
 * so the loader names them all and the server accepts a builder's frame for a
 * listed site (lib/storefront/embed.ts, isBuilderFrame). These rebuild each
 * builder's nesting with /dev/embed-host (`?wrap=`), on the builder's real
 * hostnames, which this browser is told to resolve to this machine:
 *
 *   - Wix: one sandboxed frame on `<site, dashed>.filesusr.com`, a sandbox no
 *     popup may escape;
 *   - Google Sites: two frames on a `*-atari-embeds.googleusercontent.com` host;
 *   - a srcdoc frame, which has no host of its own;
 *   - the plain-iframe snippet, for a builder that removes scripts.
 *
 * And the ways round it that must not work: another site wearing the seller's
 * Wix frame, a builder frame lying about the site above it, and a builder
 * frame with no listed site at all.
 */

const WIX_FRAME_HOST = `${SELLER_SITE.replaceAll(".", "-")}.filesusr.com`;
/** The stand-in Google host /dev/embed-host uses (GOOGLE_FRAME_HOST there). */
const GOOGLE_FRAME_HOST = "0a1b2c3d-atari-embeds.googleusercontent.com";
const PORT = ":3100";

// The builders' hosts are real names on the internet; here they are this
// machine, served by the same dev server as everything else.
test.use({
  launchOptions: {
    args: ["--host-resolver-rules=MAP *.filesusr.com localhost, MAP *.googleusercontent.com localhost"],
  },
});

const BUILDER_FRAME = "[data-builder-frame]";
/** Where the pasted code runs: the page itself, or a builder's frame in it. */
type Scope = Page | FrameLocator;
const board = (frame: Scope, shop: Shop) => frame.frameLocator(SLOT_FRAME).locator(`[data-embed-frame='${shop.storefrontId}']`);
const slotHeight = (frame: FrameLocator) =>
  frame.locator(SLOT_FRAME).evaluate((element) => (element as HTMLIFrameElement).getBoundingClientRect().height);
const frameAddress = (shop: Shop, ...sites: string[]) => `${APP}/e/${shop.embedKey}/${sites.join("/")}`;

/** The product page a tile opens, answered here (the stack's product links
 *  name the developer's own dev server), with one form on it: a stand-in for
 *  the buy button. */
async function stubProductPage(context: BrowserContext, shop: Shop) {
  await context.route(
    (url) => url.pathname === `/s/${shop.storefrontId}/p/${shop.vase}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>product</title><form method="get" action="/submitted"><button>Buy</button></form>`,
      }),
  );
  await context.route(
    (url) => url.pathname === "/submitted",
    (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>submitted</title>" }),
  );
}

/** Whether a page is still under a sandbox: a sandbox without allow-modals
 *  ignores alert() and says so in the console; a normal tab opens a dialog. */
async function isSandboxed(tab: Page): Promise<boolean> {
  const notes: string[] = [];
  let dialogs = 0;
  tab.on("console", (message) => notes.push(message.text()));
  tab.on("dialog", (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });
  await tab.evaluate(() => window.alert("sandboxed?"));
  await tab.waitForTimeout(500);
  if (dialogs > 0) return false;
  return notes.some((note) => /sandboxed/i.test(note));
}

async function openFirstTile(context: BrowserContext, frame: Scope): Promise<Page> {
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    frame.frameLocator(SLOT_FRAME).locator("[data-storefront-tile]").first().click(),
  ]);
  await tab.waitForLoadState();
  return tab;
}

test.describe("the embed inside a site builder", () => {
  test("on a plain site, a product opens in a normal tab: the baseline", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-plain");
    const { context, page: site } = await visitor(browser, "builder-plain");
    await stubProductPage(context, shop);
    await site.goto(hostPage(SELLER_SITE, shop.embedKey));
    await expect(board(site, shop)).toBeVisible({ timeout: 90_000 });
    // Our frame lets its popups escape its sandbox, so this is a normal tab.
    const tab = await openFirstTile(context, site);
    expect(await isSandboxed(tab)).toBe(false);
    await context.close();
  });

  test("Wix: one sandboxed frame on the site's own name, dashed", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-wix");
    const { context, page: site } = await visitor(browser, "builder-wix");
    await stubProductPage(context, shop);
    await site.goto(hostPage(SELLER_SITE, shop.embedKey, "&wrap=wix"));
    const wix = site.frameLocator(BUILDER_FRAME);

    await expect(board(wix, shop)).toBeVisible({ timeout: 90_000 });
    // The loader named the builder's frame and the site above it, nearest
    // first, and the frame still fits its board.
    expect(await wix.locator(SLOT_FRAME).getAttribute("src")).toBe(
      frameAddress(shop, `${WIX_FRAME_HOST}${PORT}`, `${SELLER_SITE}${PORT}`),
    );
    await expect.poll(() => slotHeight(wix), { timeout: 20_000 }).toBeGreaterThan(150);

    // Wix lets no popup escape its sandbox, so the product page opens still
    // inside it. It must still be able to submit a form (the buy button):
    // that is what allow-forms on our frame is for.
    const tab = await openFirstTile(context, wix);
    expect(new URL(tab.url()).searchParams.get("via")).toBe("embed");
    expect(await isSandboxed(tab)).toBe(true);
    await tab.getByRole("button", { name: "Buy" }).click();
    await expect(tab).toHaveURL(/\/submitted/);
    await context.close();
  });

  test("Google Sites: two frames on Google's own host", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-google");
    const { context, page: site } = await visitor(browser, "builder-google");
    await site.goto(hostPage(SELLER_SITE, shop.embedKey, "&wrap=google"));
    const inner = site.frameLocator(BUILDER_FRAME).frameLocator(BUILDER_FRAME);

    await expect(board(inner, shop)).toBeVisible({ timeout: 90_000 });
    // Both of Google's frames are on one host, named once.
    expect(await inner.locator(SLOT_FRAME).getAttribute("src")).toBe(
      frameAddress(shop, `${GOOGLE_FRAME_HOST}${PORT}`, `${SELLER_SITE}${PORT}`),
    );
    await expect.poll(() => slotHeight(inner), { timeout: 20_000 }).toBeGreaterThan(150);
    await context.close();
  });

  test("a builder frame with no host of its own (srcdoc) names the site above it", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-srcdoc");
    const { context, page: site } = await visitor(browser, "builder-srcdoc");
    await site.goto(hostPage(SELLER_SITE, shop.embedKey, "&wrap=srcdoc"));
    const srcdoc = site.frameLocator(BUILDER_FRAME);

    await expect(board(srcdoc, shop)).toBeVisible({ timeout: 90_000 });
    expect(await srcdoc.locator(SLOT_FRAME).getAttribute("src")).toBe(frameAddress(shop, `${SELLER_SITE}${PORT}`));
    await context.close();
  });

  test("the plain iframe snippet: the same board, at the height it was pasted with", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-iframe");
    const { context, page: site } = await visitor(browser, "builder-iframe");
    await site.goto(hostPage(SELLER_SITE, shop.embedKey, "&iframe=1"));

    await expect(site.frameLocator(SLOT_FRAME).locator(`[data-embed-frame='${shop.storefrontId}']`)).toBeVisible({
      timeout: 90_000,
    });
    const frame = site.locator(SLOT_FRAME);
    // No loader to size it: it keeps the height in its own style.
    const pasted = Number(/height:(\d+)px/.exec((await frame.getAttribute("style")) ?? "")?.[1]);
    expect(pasted).toBeGreaterThan(0);
    await site.waitForTimeout(1_500);
    expect(await frame.evaluate((element) => element.getBoundingClientRect().height)).toBe(pasted);
    // Sandboxed exactly as the loader's frame is.
    expect(((await frame.getAttribute("sandbox")) ?? "").split(" ").sort()).toEqual(
      ["allow-forms", "allow-popups", "allow-popups-to-escape-sandbox", "allow-same-origin", "allow-scripts"].sort(),
    );
    await context.close();
  });

  test("another site wearing the seller's Wix frame gets nothing", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-wix-other");
    const { context, page: site } = await visitor(browser, "builder-wix-other");
    const statuses = frameStatuses(site);
    await site.goto(hostPage("other.localhost", shop.embedKey, `&wrap=wix&for=${SELLER_SITE}`));
    const wix = site.frameLocator(BUILDER_FRAME);

    // The loader names the page it really sits under, which is not listed.
    await expect(wix.locator(SLOT_FRAME)).toHaveCount(1, { timeout: 60_000 });
    expect(await wix.locator(SLOT_FRAME).getAttribute("src")).toBe(
      frameAddress(shop, `${WIX_FRAME_HOST}${PORT}`, `other.localhost${PORT}`),
    );
    await expect.poll(() => statuses, { timeout: 60_000 }).toContain(404);
    await site.waitForTimeout(1_500);
    expect(await slotHeight(wix)).toBe(0);
    await expect(board(wix, shop)).toHaveCount(0);
    await context.close();
  });

  test("a builder frame that lies about the site above it is refused by its own browser", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-wix-liar");
    const { context, page: site } = await visitor(browser, "builder-wix-liar");
    const statuses = frameStatuses(site);
    const refusals: string[] = [];
    site.on("console", (message) => {
      if (/frame-ancestors/i.test(message.text())) refusals.push(message.text());
    });
    const claim = `&claim=${WIX_FRAME_HOST}${PORT},${SELLER_SITE}${PORT}`;
    await site.goto(hostPage("other.localhost", shop.embedKey, `&wrap=wix&for=${SELLER_SITE}${claim}`));

    // Every name is allowed, so the server answers; other.localhost is not
    // among them, so the browser draws nothing.
    await expect.poll(() => statuses, { timeout: 60_000 }).toContain(200);
    await expect.poll(() => refusals.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(site.frameLocator(BUILDER_FRAME).frameLocator("[data-claimed-frame]").locator("[data-embed-frame]")).toHaveCount(0);
    await context.close();
  });

  test("builder frames alone, with none of the seller's sites, are never served", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "builder-alone");
    const { context, page: site } = await visitor(browser, "builder-alone");
    const statuses = frameStatuses(site);
    await site.goto(hostPage(GOOGLE_FRAME_HOST, shop.embedKey, `&claim=${GOOGLE_FRAME_HOST}${PORT}`));
    await expect.poll(() => statuses, { timeout: 60_000 }).toContain(404);
    await expect(site.frameLocator("[data-claimed-frame]").locator("[data-embed-frame]")).toHaveCount(0);
    await context.close();
  });
});
