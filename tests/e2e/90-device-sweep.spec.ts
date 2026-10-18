import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
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
 * EVERY PAGE, ON EVERY SIZE OF SCREEN, FULL OF AWKWARD DATA.
 *
 * One seller whose store is the worst case a real one can be (a title with no
 * space to break at, emoji, right-to-left text, a price in the hundreds of
 * thousands, sold-out and draft products, a buyer address that goes on and
 * on), and every page of the app opened on it at six sizes: a small phone, a
 * phone, that phone turned on its side, a tablet both ways up and a laptop.
 * The phone sizes are reached by RESIZING the open page, which is what turning
 * a phone does, so a layout that only works when loaded at its size fails too.
 *
 * At every size a page may not:
 *   - be wider than the screen (the culprit is named: the deepest thing past
 *     the edge). <body> clips sideways, so that part is not scrolled to: it is
 *     simply gone;
 *   - leave a control cut off by a box that does not scroll;
 *   - print a value that was never formatted ("undefined", "NaN", ...);
 *   - fall to the error boundary, answer 5xx, or throw in the browser.
 *
 * The galleries under /dev render every dialog, panel and empty state in every
 * state, so sweeping them covers the surfaces a route alone never opens.
 */

const UNBROKEN = "Supercalifragilisticexpialidocious".repeat(3).slice(0, 100);
const RTL = "مزهرية خزفية مصنوعة يدويا بتفاصيل دقيقة جدا";
const EMOJI = "🏺🌿 Vase 👩‍👩‍👧‍👦 für Zuhause ❤️‍🔥 ñ é ü";

/** [width, height] */
type Size = readonly [number, number];
const SCREENS = {
  phone: { touch: true, sizes: [[320, 568], [390, 844], [844, 390]] as Size[] },
  desktop: { touch: false, sizes: [[768, 1024], [1024, 768], [1440, 900]] as Size[] },
} as const;
type Screen = keyof typeof SCREENS;

const SELLER_PAGES = (s: Seeded) => [
  "/dashboard",
  "/products",
  "/products/new",
  `/products/${s.longProduct}/edit`,
  "/products/import",
  "/orders",
  "/analytics",
  "/discounts",
  "/discounts/new",
  "/payments",
  "/plans",
  "/notifications",
  "/storefront",
  `/storefront/${s.storefrontId}`,
  `/storefront/${s.storefrontId}/embed`,
  "/storefront/sample",
  "/settings/account",
  "/settings/billing",
  "/settings/danger",
  "/settings/language",
  "/settings/legal",
  "/settings/notifications",
  "/settings/security",
  "/settings/shipping",
  "/settings/tax",
  "/settings/team",
];

const NOBODY = "00000000-0000-4000-8000-000000000000";
const BUYER_PAGES = (s: Seeded) => [
  `/s/${s.storefrontId}`,
  `/s/${s.storefrontId}/p/${s.longProduct}`,
  `/s/${s.storefrontId}/p/${s.rtlProduct}`,
  `/s/${s.storefrontId}/p/${s.longProduct}/checkout`,
  `/s/${s.storefrontId}/orders`,
  `/s/${NOBODY}`,
  `/s/${NOBODY}/p/${NOBODY}`,
  "/login",
  "/reset-password",
];

/**
 * Only the galleries that lay their specimens out to fit the screen. The rest
 * (order-detail, checkout, payments, storefront-panels, storefront-preview)
 * draw them in frames of a fixed width, which is wider than a phone by design
 * and says nothing about the component inside.
 */
const GALLERIES = [
  "modals",
  "discounts",
  "pricing",
  "empty-states",
  "onboarding",
  "charts",
  "charts/stress",
  "pickers",
  "toast",
  "tracking-links",
  "sample-storefront",
  "ship-button",
  "cancel",
  "tour",
  "product-empty",
  "embed-frame",
].map((name) => `/dev/${name}`);

/**
 * The checkout run (playwright.checkout.config.ts) opens the one route the
 * default stack keeps shut, so there only the buyer's pages are swept again.
 */
const CHECKOUT_RUN = process.env.CHECKOUT_TEST_PAYMENTS === "1";

type Seeded = { storefrontId: string; longProduct: string; rtlProduct: string };
let seeded: Seeded;
let session: Awaited<ReturnType<BrowserContext["storageState"]>>;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = freshUser("sweep");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: `${UNBROKEN.slice(0, 60)} & Söhne` });
  await seedStorefronts(sellerId, [{ name: UNBROKEN.slice(0, 80) }, { name: RTL }]);
  await seedProducts(sellerId, [
    { title: UNBROKEN, description: `${UNBROKEN} ${UNBROKEN}\n\n${EMOJI}`, price_cents: 99_999_999 },
    { title: RTL, description: RTL, price_cents: 1 },
    { title: EMOJI, price_cents: 0 },
    { title: "Sold out", track_stock: true, stock_quantity: 0 },
    { title: "Nearly gone", track_stock: true, stock_quantity: 1, max_per_order: 100 },
    { title: "Still a draft", status: "draft" },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const idOf = (title: string) => products.find((p) => p.title === title)!.id;
  const [{ id: storefrontId }] = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&name=eq.${encodeURIComponent(UNBROKEN.slice(0, 80))}&select=id`,
  )) as { id: string }[];
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: {
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
        },
        blocks: products.slice(0, 5).map((p, i) => ({
          type: "product",
          productId: p.id,
          x: (i % 3) * 2,
          y: Math.floor(i / 3) * 2,
          w: 2,
          h: 2,
        })),
      },
    },
  });
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "CZ",
        ratesCurrency: "EUR",
        destinations: [{ area: UNBROKEN.slice(0, 40), time: "2-4 days", countries: ["CZ"], rateCents: 0 }],
        returnsWindowDays: 0,
        returnsNotes: `${UNBROKEN} ${RTL}`,
      },
    },
  });
  await seedOrders(sellerId, [
    {
      amount_cents: 99_999_999,
      quantity: 100,
      product_title: UNBROKEN,
      buyer_email: `${"a-very-long-mailbox-name".repeat(2)}@a-very-long-subdomain.example.com`,
      selected_options: [{ label: UNBROKEN.slice(0, 30), value: UNBROKEN.slice(0, 40) }],
      ship_to: { name: UNBROKEN.slice(0, 60), line1: UNBROKEN, city: RTL, postcode: "D02 X285", country: "IE" },
      fulfilment_status: "unfulfilled",
    },
    { amount_cents: 1, product_title: RTL, status: "refunded" },
    { amount_cents: 0, product_title: EMOJI, status: "disputed", tracking_number: UNBROKEN.slice(0, 40) },
  ]);
  seeded = { storefrontId, longProduct: idOf(UNBROKEN), rtlProduct: idOf(RTL) };
  session = await context.storageState();
  await context.close();
});

/** What is wrong with the page as it stands, in words. Empty when nothing is. */
async function inspect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const width = document.documentElement.clientWidth;
    const style = (el: Element) => getComputedStyle(el);
    const name = (el: Element) => {
      const marks = [...el.attributes]
        .filter((a) => a.name.startsWith("data-") || a.name === "aria-label" || a.name === "name")
        .map((a) => `[${a.name}${a.value ? `=${a.value.slice(0, 24)}` : ""}]`)
        .join("");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28);
      return `${el.tagName.toLowerCase()}${marks || `.${String(el.className).split(/\s+/).slice(0, 3).join(".")}`} "${text}"`;
    };
    const shown = (el: Element) => {
      if (el.closest("nextjs-portal, [inert], [aria-hidden='true']")) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const s = style(node);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return false;
      }
      return true;
    };
    /**
     * What holds an element in sideways: the first box that clips it (and
     * whether that box scrolls), the screen for anything pinned to it, or
     * nothing. Followed along the CONTAINING blocks, not the parents: an
     * absolutely positioned child is not clipped by a box it is not positioned
     * against, which is how a screen-reader label escapes a scrolling table.
     */
    const holder = (el: Element, fromItself = false) => {
      let position = fromItself ? "static" : style(el).position;
      for (let node = fromItself ? el : el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (position === "fixed") return "screen" as const;
        const s = style(node);
        if (position === "absolute" && s.position === "static" && s.transform === "none") continue;
        if (s.overflowX !== "visible") return { node, scrolls: s.overflowX === "auto" || s.overflowX === "scroll" };
        position = s.position;
      }
      return position === "fixed" ? ("screen" as const) : null;
    };

    const sideways = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - width;
    if (sideways > 1) {
      // A word with no space to break at runs on past the box that holds it,
      // and no ELEMENT is past the edge then: only the text itself is.
      const range = document.createRange();
      const textPast = (el: Element) =>
        [...el.childNodes].some((node) => {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
          range.selectNodeContents(node);
          return range.getBoundingClientRect().right > width + 1;
        });
      // Not `shown`: a 1px screen-reader label widens the page as well as anything.
      const past = [...document.querySelectorAll("body *")].filter(
        (el) =>
          !el.closest("nextjs-portal") &&
          ((el.getBoundingClientRect().right > width + 1 && !holder(el)) || (textPast(el) && !holder(el, true))),
      );
      const deepest = past.filter((el) => !past.some((other) => other !== el && el.contains(other)));
      problems.push(`wider than the screen: ${deepest.slice(0, 2).map(name).join(" | ")}`);
    }

    for (const control of document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")) {
      if (!shown(control)) continue;
      const rect = control.getBoundingClientRect();
      // Held by nothing, it is the page that scrolls, which is reported above.
      const held = holder(control);
      if (!held || (held !== "screen" && held.scrolls)) continue;
      // A name shortened with an ellipsis is cut on purpose.
      if (held !== "screen" && style(held.node).textOverflow === "ellipsis") continue;
      const box = held === "screen" ? new DOMRect(0, 0, width, 0) : held.node.getBoundingClientRect();
      const left = Math.max(0, box.left);
      const right = Math.min(width, box.right);
      // Wholly outside is a drawer waiting off screen. Partly outside is cut.
      const partly = rect.right > left && rect.left < right;
      if (partly && (rect.right > right + 2 || rect.left < left - 2)) problems.push(`control cut off: ${name(control)}`);
    }

    const copy = document.body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("script, style, pre, code, nextjs-portal, textarea").forEach((el) => el.remove());
    const leak = (copy.textContent ?? "").match(/.{0,24}(\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]).{0,12}/);
    if (leak) problems.push(`unformatted value: "${leak[0].trim().replace(/\s+/g, " ")}"`);

    // The readout app/error.tsx hands ErrorScreen.
    if (copy.textContent?.includes("err_internal")) problems.push("fell to the error boundary");
    return problems;
  });
}

/**
 * Browser noise that says nothing about the page under test. "Encountered a
 * script tag" is React's development-only remark about the theme script in
 * app/layout.tsx when a 404 rebuilds the shell in the browser, which
 * ThemeSync (components/error) exists to cover.
 */
const NOISE = /Encountered a script tag|favicon|Download the React DevTools|challenges\.cloudflare|net::ERR_|Failed to load resource|\[Fast Refresh\]|\[HMR\]|WebSocket connection/;

async function sweep(browser: Browser, screen: Screen, paths: string[]) {
  const { touch, sizes } = SCREENS[screen];
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: sizes[0][0], height: sizes[0][1] },
    isMobile: touch,
    hasTouch: touch,
  });
  const page = await context.newPage();
  const found = new Map<string, string[]>();
  const note = (path: string, problem: string, at: string) =>
    found.set(`${path} :: ${problem}`, [...(found.get(`${path} :: ${problem}`) ?? []), at]);
  let current = "";
  let at = "";
  page.on("pageerror", (error) => note(current, `threw: ${error.message.slice(0, 160)}`, at));
  page.on("console", (message) => {
    if (message.type() === "error" && !NOISE.test(message.text()))
      note(current, `console error: ${message.text().slice(0, 160)}`, at);
  });

  for (const path of paths) {
    current = path;
    at = `${sizes[0][0]}`;
    await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
    const response = await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (!response || response.status() >= 500) {
      note(path, `answered ${response?.status() ?? "nothing"}`, at);
      continue;
    }
    for (const [w, h] of sizes) {
      at = `${w}`;
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(350);
      for (const problem of await inspect(page)) note(path, problem, at);
    }
  }
  await context.close();
  return [...found].map(([problem, widths]) => `${problem}  @${[...new Set(widths)].join(",")}`);
}

for (const screen of Object.keys(SCREENS) as Screen[]) {
  test.describe(`on a ${screen}`, () => {
    test.setTimeout(480_000);

    test("the seller's pages hold their shape", async ({ browser }) => {
      test.skip(CHECKOUT_RUN, "swept by the default run");
      expect(await sweep(browser, screen, SELLER_PAGES(seeded))).toEqual([]);
    });

    test("the buyer's pages hold their shape", async ({ browser, request }) => {
      const pages = BUYER_PAGES(seeded);
      // A checkout that is shut answers with a redirect, and sweeping where
      // it lands would pass without the page ever being drawn.
      if (CHECKOUT_RUN) {
        const checkout = pages.find((path) => path.endsWith("/checkout"))!;
        expect((await request.get(checkout, { maxRedirects: 0 })).status()).toBe(200);
      }
      expect(await sweep(browser, screen, pages)).toEqual([]);
    });

    test("every dialog, panel and empty state holds its shape", async ({ browser }) => {
      test.skip(CHECKOUT_RUN, "swept by the default run");
      expect(await sweep(browser, screen, GALLERIES)).toEqual([]);
    });
  });
}
