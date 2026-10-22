import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  canvasStill,
  expectToast,
  freshUser,
  gotoApp,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A SALE, EVERYWHERE A BUYER MEETS IT, on the real stack (Postgres, PostgREST,
 * the app).
 *
 * A seller makes a sale in the Discounts tab. From that moment the storefront's
 * tiles, each product's page and the amount the checkout charges say the same
 * lower price, with the REGULAR price crossed out beside it and a sale chip on
 * the tile, and they stop together when the sale ends. The seller chooses what
 * the chip shows, its look and where it sits (for the board, or one product),
 * and which of two looks crosses the price out on the product page.
 *
 * What is never the seller's to choose is a FIGURE. The chip says what the
 * sale takes off the crossed-out price, worked out from the two prices. The
 * product page's percentage appears only when the price records prove it
 * (measured against the lowest price of the 30 days before the sale), and
 * where it cannot be proved the page says what the crossed-out price is.
 *
 * The arithmetic and the failure cases are held down by
 * tests/unit/discount-price-agreement.test.ts across thousands of random
 * stores; this spec is the same promise kept by the real database and a real
 * browser, including the parts only a browser can show (a price that is never
 * clipped, an open tab that reads its prices again).
 *
 * The charging step NEEDS the stack started with CHECKOUT_TEST_PAYMENTS=1, like
 * 78-checkout and 83-discounts; without it that one step is skipped.
 */

const THEME = {
  background: { kind: "solid", color: "#f6f1e7" },
  accent: "#1f4d3a",
  font: "sans",
  columns: 6,
  rows: 12,
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

const PRODUCT_PAGE = {
  enabled: true,
  imageFit: "contain",
  ctaLabel: "Buy now",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: true,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map((id) => ({
    id,
    show: true,
  })),
};

const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const SAME_ORIGIN = { "sec-fetch-site": "same-origin", "content-type": "application/json" };

type Item = { id: string; title: string; cents: number; currency: "EUR" | "USD" };
type Shop = { sellerId: string; storefrontId: string; store: string; items: Item[] };
type Seed = {
  title: string;
  cents: number;
  currency?: "EUR" | "USD";
  /**
   * What the price records say about the product's past:
   *   - absent: it has cost this for 40 days;
   *   - "new": listed today, so its records begin where it does (its lowest
   *     price is simply the one it has had since);
   *   - "unrecorded": listed 90 days ago, its first price on record today. What
   *     it cost in between is not known, so no percentage may be claimed.
   */
  records?: "new" | "unrecorded";
};

/** A signed-in owner with a storefront holding `products`, product pages on and
 *  trader details complete. */
async function seedShop(
  page: Page,
  tag: string,
  products: Seed[],
  theme: Record<string, unknown> = THEME,
): Promise<Shop> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const store = `Clay House ${user.email.split("@")[0]}`;
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: store });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(
    sellerId,
    products.map((product) => ({ title: product.title, price_cents: product.cents })),
  );
  const rows = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const items: Item[] = products.map((product) => ({
    id: rows.find((row) => row.title === product.title)!.id,
    title: product.title,
    cents: product.cents,
    currency: product.currency ?? "EUR",
  }));

  for (const [index, product] of products.entries()) {
    const { id } = items[index];
    if (product.currency === "USD") {
      await serviceRest(`/products?id=eq.${id}`, { method: "PATCH", body: { currency: "USD" } });
      // The change of currency is a price change of its own: keep one row.
      await serviceRest(`/product_price_history?product_id=eq.${id}&currency=eq.EUR`, { method: "DELETE" });
    }
    // The price trigger wrote each product's first price just now, the moment
    // it was listed. Moved back, the product has cost this for 40 days; left
    // alone it is a new product; with only the LISTING moved back, the records
    // begin long after the product did.
    if (!product.records) {
      await serviceRest(`/product_price_history?product_id=eq.${id}`, {
        method: "PATCH",
        body: { valid_from: at(-40 * DAY) },
      });
      await serviceRest(`/products?id=eq.${id}`, { method: "PATCH", body: { created_at: at(-40 * DAY) } });
    } else if (product.records === "unrecorded") {
      await serviceRest(`/products?id=eq.${id}`, { method: "PATCH", body: { created_at: at(-90 * DAY) } });
    }
  }

  await saveConfig(storefrontId, items, { theme });
  await serviceRest(`/profiles?id=eq.${sellerId}`, {
    method: "PATCH",
    body: {
      shipping_policy: {
        shipsFrom: "IE",
        dispatch: "Packed and posted within 2 days",
        ratesCurrency: "EUR",
        destinations: [{ area: "Ireland", time: "1-2 days", countries: ["IE"], rateCents: 450 }],
        returnsWindowDays: 30,
        returnsPaidBy: "buyer",
      },
    },
  });
  return { sellerId, storefrontId, store, items };
}

/** Write the storefront's design: every product a 2x2 tile, three to a row. */
async function saveConfig(
  storefrontId: string,
  items: readonly Item[],
  design: { theme?: Record<string, unknown>; productPage?: Record<string, unknown> } = {},
) {
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: design.theme ?? THEME,
        productPage: design.productPage ?? PRODUCT_PAGE,
        header: { show: true, name: "Clay House", bio: "Thrown by hand in Galway." },
        blocks: items.map((product, index) => ({
          type: "product",
          productId: product.id,
          x: (index % 3) * 2,
          y: Math.floor(index / 3) * 2,
          w: 2,
          h: 2,
        })),
      },
    },
  });
}

/** A sale written straight to the table, as the seller's own row. */
async function seedSale(shop: Shop, columns: Record<string, unknown>): Promise<string> {
  const [row] = (await serviceRest(`/discounts`, {
    method: "POST",
    body: { owner_id: shop.sellerId, kind: "automatic", value_type: "percent", ...columns },
  })) as { id: string }[];
  return row.id;
}

const shopPath = (shop: Shop) => `/s/${shop.storefrontId}`;
const productPath = (shop: Shop, id: string) => `${shopPath(shop)}/p/${id}`;
/** A price as the app prints it in English (en-IE: "€24.00", "US$95.00"). */
const money = (cents: number, currency = "EUR") => `${currency === "USD" ? "US$" : "€"}${(cents / 100).toFixed(2)}`;
const item = (shop: Shop, title: string) => shop.items.find((candidate) => candidate.title === title)!;

/** What a tile prints: the price, the struck-through one, and its sale chip. */
type Tile = { now: string; was: string | null; chip: string | null };

async function readTiles(page: Page): Promise<Record<string, Tile>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-storefront-tile]")].map((tile) => {
        const price = tile.querySelector<HTMLElement>("[data-tile-price]");
        const struck = price?.querySelector("[data-tile-price-was]");
        // With a struck price beside it the price is the chip's last visible part.
        const now = struck ? price?.querySelector("span[aria-hidden='true']")?.textContent : price?.textContent;
        return [
          tile.dataset.storefrontTile ?? "",
          {
            now: now ?? "",
            was: struck?.textContent ?? null,
            chip: tile.querySelector("[data-tile-sale-badge]")?.textContent ?? null,
          },
        ];
      }),
    ),
  );
}

/** What a product's own page says: the price and the crossed-out one in cents,
 *  the percentage it claims, and how its ticket accounts for the crossing out. */
async function readProductPage(request: APIRequestContext, shop: Shop, id: string) {
  const response = await request.get(productPath(shop, id));
  expect(response.status(), `product page ${id}`).toBe(200);
  const html = await response.text();
  const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;
  const cents = attribute("data-product-price");
  expect(cents, `price on product page ${id}`).not.toBeNull();
  const struck = attribute("data-product-sale-was");
  const percent = attribute("data-product-sale-percent");
  return {
    cents: Number(cents),
    was: struck === null ? null : Number(struck),
    percent: percent === null ? null : Number(percent),
    account: attribute("data-product-sale-ticket"),
    look: attribute("data-product-sale"),
    html,
  };
}

test.describe("a sale on the storefront", () => {
  test("the seller makes a sale and the tile, the product page and the charge all follow, then all stop", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "sale-flow", [
      { title: "Stoneware vase", cents: 2400 },
      { title: "Linen apron", cents: 3800, records: "unrecorded" },
      { title: "Sticker", cents: 52, records: "new" },
    ]);
    const vase = item(shop, "Stoneware vase");
    const apron = item(shop, "Linen apron");
    const sticker = item(shop, "Sticker");

    const context = await browser.newContext();
    const buyer = await context.newPage();

    // Before the sale: every tile at its listed price, nothing crossed out, no chip.
    await buyer.goto(shopPath(shop));
    expect(await readTiles(buyer)).toEqual({
      [vase.id]: { now: "€24.00", was: null, chip: null },
      [apron.id]: { now: "€38.00", was: null, chip: null },
      [sticker.id]: { now: "€0.52", was: null, chip: null },
    });

    // THE SELLER MAKES THE SALE, in the form. Its summary shows what it does to
    // one product: the regular price struck through, the new price, what comes off.
    await gotoApp(page, "/discounts/new");
    const form = page.locator("[data-discount-form]");
    // A sale is what a new discount starts as.
    await expect(form.getByRole("radio", { name: /^Sale/ })).toBeChecked();
    await form.getByLabel("Percentage off").fill("10");
    const example = form.locator("[data-discount-example]");
    await expect(example).toBeVisible();
    await expect(example.locator("[data-discount-example-off]")).toHaveText("-10%");
    // The catalogue's first product by name, worked through.
    await expect(example).toContainText("Linen apron");
    await expect(example.locator("[data-discount-example-was]")).toHaveText("€38.00");
    await expect(example.locator("[data-discount-example-now]")).toHaveText("€34.20");
    // One sentence for a screen reader, the same fact.
    await expect(example.locator("figcaption")).toHaveText("Example: Linen apron at €38.00 costs €34.20.");
    await form.getByRole("button", { name: "Create discount" }).click();
    await expectToast(page, "Discount created.");

    // THE BUYER'S STOREFRONT, read afresh. Every tile says the sale price with
    // the regular price crossed out beside it, and wears the sale chip.
    //   - the chip says what the sale takes off the crossed-out price, on each
    //     (the apron's records begin long after it was listed, which only its
    //     page has to say anything about);
    //   - the sticker's sale stops at the smallest amount a card can pay, so
    //     the chip says the 3% that really comes off, not the 10% asked for.
    await buyer.reload();
    expect(await readTiles(buyer)).toEqual({
      [vase.id]: { now: "€21.60", was: "€24.00", chip: "-10%" },
      [apron.id]: { now: "€34.20", was: "€38.00", chip: "-10%" },
      [sticker.id]: { now: "€0.50", was: "€0.52", chip: "-3%" },
    });
    // Heard as one sentence on the tile.
    await expect(buyer.locator(`[data-storefront-tile='${vase.id}'] [data-tile-price] .sr-only`)).toHaveText(
      "Was €24.00, now €21.60",
    );
    // The discount's id is nobody's business but the order's.
    const [sale] = (await serviceRest(`/discounts?owner_id=eq.${shop.sellerId}&select=id`)) as { id: string }[];
    expect(await buyer.content()).not.toContain(sale.id);

    // EACH PRODUCT'S OWN PAGE says the same price as its tile, crosses the same
    // regular price out, claims the same percentage, and says what the
    // crossed-out price is.
    expect(await readProductPage(buyer.request, shop, vase.id)).toMatchObject({
      cents: 2160,
      was: 2400,
      percent: 10,
      account: "proven",
    });
    expect(await readProductPage(buyer.request, shop, apron.id)).toMatchObject({
      cents: 3420,
      was: 3800,
      percent: null,
      account: "regular",
    });
    expect(await readProductPage(buyer.request, shop, sticker.id)).toMatchObject({
      cents: 50,
      was: 52,
      percent: 3,
      account: "proven",
    });
    // And the tile leads to it.
    await buyer.locator(`[data-storefront-tile='${vase.id}']`).click();
    await buyer.waitForURL((url) => url.pathname === productPath(shop, vase.id));
    await expect(buyer.locator("[data-product-price]").first()).toHaveAttribute("data-product-price", "2160");
    await expect(buyer.locator("[data-product-sale-was]").first()).toHaveText("€24.00");
    await expect(buyer.locator("[data-product-sale-ticket]")).toContainText(
      "Crossed-out price: the lowest price in the 30 days before this sale.",
    );
    await buyer.goto(productPath(shop, apron.id));
    await expect(buyer.locator("[data-product-sale-was]").first()).toHaveText("€38.00");
    await expect(buyer.locator("[data-product-sale-ticket]")).toContainText("Crossed-out price: the regular price.");
    await expect(buyer.locator("[data-product-sale-percent]")).toHaveCount(0);

    // THE SELLER'S OWN CANVAS shows what buyers see, chip and all.
    await gotoApp(page, `/storefront/${shop.storefrontId}`);
    const canvasTile = page.locator(`[data-grid-key='p_${vase.id}']`).first();
    await expect(canvasTile.locator("[data-tile-price]")).toContainText("€21.60");
    await expect(canvasTile.locator("[data-tile-price-was]")).toHaveText("€24.00");
    await expect(canvasTile.locator("[data-tile-sale-badge]")).toHaveText("-10%");

    // WHAT IS CHARGED. Only what the buyer saw: the sale total goes through,
    // the listed total is refused as a price that changed.
    const checkout = await buyer.request.get(`${productPath(shop, vase.id)}/checkout`, { maxRedirects: 0 });
    if (checkout.status() === 200) {
      const order = {
        optionIds: [],
        quantity: 1,
        email: "tester@example.test",
        locale: "en",
        shipTo: { name: "T Ester", line1: "1 Main St", city: "Galway", postalCode: "H91", country: "IE" },
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      };
      const api = `/api/checkout/${shop.storefrontId}/${vase.id}`;
      const listed = await buyer.request.post(api, {
        headers: SAME_ORIGIN,
        data: { ...order, attemptId: crypto.randomUUID(), expectedTotalCents: 2400 + 450 },
      });
      expect(listed.status()).toBe(409);
      expect(await listed.json()).toMatchObject({ ok: false, error: "price_changed" });
      const placed = await buyer.request.post(api, {
        headers: SAME_ORIGIN,
        data: { ...order, attemptId: crypto.randomUUID(), expectedTotalCents: 2160 + 450 },
      });
      expect(placed.status()).toBe(201);
      const [recorded] = (await serviceRest(
        `/orders?seller_id=eq.${shop.sellerId}&select=amount_cents,product_price_cents,discount_cents,discount_id`,
      )) as Record<string, unknown>[];
      expect(recorded).toEqual({ amount_cents: 2610, product_price_cents: 2400, discount_cents: 240, discount_id: sale.id });
    } else {
      test.info().annotations.push({ type: "skipped-step", description: "charge: stack started without CHECKOUT_TEST_PAYMENTS=1" });
    }

    // THE SELLER ENDS THE SALE, and every surface is back at the listed price.
    await gotoApp(page, "/discounts");
    await page.locator(`[data-discount-row='${sale.id}']`).getByRole("button", { name: "End now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "End sale" }).click();
    await expect(page.locator(`[data-discount-row='${sale.id}']`)).toHaveAttribute("data-discount-status", "ended");

    await buyer.goto(shopPath(shop));
    expect(await readTiles(buyer)).toEqual({
      [vase.id]: { now: "€24.00", was: null, chip: null },
      [apron.id]: { now: "€38.00", was: null, chip: null },
      [sticker.id]: { now: "€0.52", was: null, chip: null },
    });
    expect(await readProductPage(buyer.request, shop, vase.id)).toMatchObject({ cents: 2400, was: null, percent: null });
    await context.close();
  });

  test("the seller edits the chip for one product on the canvas, and picks how the page crosses the price out", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "sale-design", [
      { title: "Stoneware vase", cents: 2400 },
      { title: "Linen apron", cents: 3800 },
    ]);
    const [vase, apron] = shop.items;
    await seedSale(shop, { percent_off: 10, starts_at: at(-5 * DAY) });

    // ON THE CANVAS: the vase's own chip. Selected, the tile arms it like its
    // title and price, and pressing it opens its own settings.
    await gotoApp(page, `/storefront/${shop.storefrontId}`);
    const tile = page.locator(`[data-grid-key='p_${vase.id}']`).first();
    await expect(tile.locator("[data-tile-sale-badge]")).toHaveText("-10%");
    await tile.click();
    await canvasStill(page);
    await tile.getByRole("button", { name: /^Sale chip at top left/ }).click();
    const chip = page.locator("[data-sale-badge-controls]").first();
    await expect(chip).toBeVisible();
    // Four things it can show, and nowhere to type.
    const shows = chip.getByRole("group", { name: "Shows" });
    await expect(shows.getByRole("button")).toHaveText(["Percentage", "Amount", "Sale", "Hidden"]);
    await expect(chip.getByRole("textbox")).toHaveCount(0);
    // Four looks, each pictured saying what this product's chip will say.
    const looks = chip.getByRole("group", { name: "Style" });
    await expect(looks.getByRole("button")).toHaveText(["-10%Pill", "-10%Sticker", "-10%Flag", "-10%Ribbon"]);
    await shows.getByRole("button", { name: "Amount" }).click();
    await looks.getByRole("button", { name: "Ribbon" }).click();
    await chip.getByRole("button", { name: "Sale chip bottom right" }).click();
    // The canvas shows it at once: this tile's chip changed, its neighbour's did not.
    await expect(tile.locator("[data-tile-sale-badge]")).toHaveText("-€2.40");
    await expect(tile.locator("[data-tile-sale-badge]")).toHaveAttribute("data-sale-chip-look", "ribbon");
    await expect(page.locator(`[data-grid-key='p_${apron.id}'] [data-tile-sale-badge]`).first()).toHaveText("-10%");
    const moved = await tile.evaluate((node) => {
      const badge = node.querySelector("[data-tile-sale-badge]")!.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return { right: badge.left + badge.width / 2 > box.left + box.width / 2, low: badge.top > box.top + box.height / 3 };
    });
    expect(moved).toEqual({ right: true, low: true });
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /saved/i, 15_000);

    // THE PRODUCT PAGE'S LOOK, through the page settings route: one of two.
    const settings = `/api/storefronts/${shop.storefrontId}/product-page`;
    const refused = await page.request.patch(settings, { headers: SAME_ORIGIN, data: { saleStyle: "neon" } });
    expect(refused.status()).toBe(400);
    const patched = await page.request.patch(settings, { headers: SAME_ORIGIN, data: { saleStyle: "slash" } });
    expect(patched.status()).toBe(200);
    expect(((await patched.json()) as { productPage: { saleStyle?: string } }).productPage.saleStyle).toBe("slash");

    // WHAT A BUYER GETS. The vase's ribbon says "-€2.40" bottom right; the
    // apron still follows the storefront. Both product pages cross the price out with a
    // stroke, the regular price in front.
    const context = await browser.newContext();
    const buyer = await context.newPage();
    await buyer.goto(shopPath(shop));
    expect(await readTiles(buyer)).toEqual({
      [vase.id]: { now: "€21.60", was: "€24.00", chip: "-€2.40" },
      [apron.id]: { now: "€34.20", was: "€38.00", chip: "-10%" },
    });
    await expect(buyer.locator(`[data-storefront-tile='${vase.id}'] [data-tile-sale-badge]`)).toHaveAttribute(
      "data-sale-chip-look",
      "ribbon",
    );
    await buyer.goto(productPath(shop, vase.id));
    const struck = buyer.locator("[data-product-sale-was]").first();
    await expect(buyer.locator("[data-product-sale]").first()).toHaveAttribute("data-product-sale", "slash");
    await expect(struck).toHaveText("€24.00");
    const drawn = await struck.evaluate((node) => {
      const style = getComputedStyle(node);
      const price = node.parentElement!.querySelector("span[aria-hidden='true']")!.getBoundingClientRect();
      return {
        line: style.textDecorationLine,
        stroke: style.backgroundImage.startsWith("linear-gradient"),
        inFront: node.getBoundingClientRect().right <= price.left + 1,
      };
    });
    expect(drawn).toEqual({ line: "none", stroke: true, inFront: true });

    // Back to the default look is no key at all, and the page follows.
    const cleared = await page.request.patch(settings, { headers: SAME_ORIGIN, data: { saleStyle: null } });
    expect(cleared.status()).toBe(200);
    expect(((await cleared.json()) as { productPage: { saleStyle?: string } }).productPage.saleStyle).toBeUndefined();
    await buyer.reload();
    await expect(buyer.locator("[data-product-sale]").first()).toHaveAttribute("data-product-sale", "strike");
    expect(await struck.evaluate((node) => getComputedStyle(node).textDecorationLine)).toBe("line-through");

    // The board's chip can also be switched off for everything at once, or
    // recoloured: the storefront's own setting, which a tile's override beats.
    await saveConfig(shop.storefrontId, shop.items, { theme: { ...THEME, saleBadge: "hidden" } });
    await buyer.goto(shopPath(shop));
    expect(Object.values(await readTiles(buyer)).map((entry) => entry.chip)).toEqual([null, null]);
    await saveConfig(shop.storefrontId, shop.items, { theme: { ...THEME, saleBadge: "sale", saleBadgeColor: "#dc2626" } });
    await buyer.reload();
    const badge = buyer.locator(`[data-storefront-tile='${apron.id}'] [data-tile-sale-badge]`);
    await expect(badge).toHaveText("Sale");
    expect(await badge.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(220, 38, 38)");
    await context.close();
  });

  test("every tile agrees with its own product page under overlapping sales of every kind", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const shop = await seedShop(page, "sale-many", [
      { title: "Vase", cents: 2400 },
      { title: "Apron", cents: 3800 },
      { title: "Table", cents: 74_500 },
      { title: "Plate", cents: 2800, records: "unrecorded" },
      { title: "Zine", cents: 1200 },
      { title: "Sticker", cents: 60 },
      { title: "Ticket", cents: 9500, currency: "USD" },
      { title: "Mug", cents: 1999 },
      { title: "Bowl", cents: 3333 },
    ]);
    const id = (title: string) => item(shop, title).id;

    // Sales that overlap, that name products, that are in the wrong currency,
    // that have not started, that are over, that were deleted, and one that
    // belongs to somebody else. Started five days ago unless said otherwise.
    const started = at(-5 * DAY);
    await seedSale(shop, { percent_off: 10, starts_at: started });
    await seedSale(shop, { percent_off: 25, applies_to: "products", product_ids: [id("Table"), id("Mug")], starts_at: started });
    await seedSale(shop, {
      value_type: "amount",
      amount_off_cents: 500,
      currency: "EUR",
      applies_to: "products",
      product_ids: [id("Zine"), id("Sticker"), id("Ticket")],
      starts_at: started,
    });
    await seedSale(shop, { percent_off: 90, starts_at: at(DAY) });
    // Over, but it ran inside the 30 days before the others began: 80% off
    // everything, so nothing since is a reduction against the lowest price.
    await seedSale(shop, { percent_off: 80, starts_at: at(-20 * DAY), ends_at: at(-10 * DAY) });
    await seedSale(shop, { percent_off: 70, starts_at: started, archived_at: at(-DAY), ends_at: at(-DAY) });
    // A code is not a sale: it takes nothing off a tile.
    await serviceRest(`/discounts`, {
      method: "POST",
      body: { owner_id: shop.sellerId, kind: "code", code: "HALF50", value_type: "percent", percent_off: 50 },
    });
    const elsewhere = await browser.newContext();
    const other = await seedShop(await elsewhere.newPage(), "sale-other", [{ title: "Their vase", cents: 2400 }]);
    await seedSale(other, { percent_off: 60, starts_at: started });
    await elsewhere.close();

    // Worked out by hand, from the rules: the best running sale for each
    // product, a percentage rounded down, nothing below 50 cents.
    const expected: Record<string, number> = {
      Vase: 2160, // 10%
      Apron: 3420, // 10%
      Table: 55_875, // 25% beats 10%
      Plate: 2520, // 10%
      Zine: 700, // €5 beats 10%
      Sticker: 50, // €5 off, stopped at the floor
      Ticket: 8550, // a euro amount does nothing to a dollar price: 10%
      Mug: 1500, // 25% of 19.99 is 4.9975, taken off as 4.99
      Bowl: 3000, // 10% of 33.33 is 3.333, taken off as 3.33
    };
    // And what each chip says: the winning sale's own percentage where it
    // applied in full, the share that really came off (rounded down) where not.
    const chips: Record<string, string> = {
      Vase: "-10%",
      Apron: "-10%",
      Table: "-25%",
      Plate: "-10%",
      Zine: "-41%", // €5 of €12.00 is 41.7%
      Sticker: "-16%", // only €0.10 of €0.60 comes off
      Ticket: "-10%",
      Mug: "-25%",
      Bowl: "-10%",
    };

    const context = await browser.newContext();
    const buyer = await context.newPage();
    await buyer.goto(shopPath(shop));
    const tiles = await readTiles(buyer);
    expect(Object.keys(tiles)).toHaveLength(shop.items.length);

    for (const product of shop.items) {
      const tile = tiles[product.id];
      const own = await readProductPage(buyer.request, shop, product.id);
      expect(own.cents, `${product.title}: product page`).toBe(expected[product.title]);
      expect(tile.now, `${product.title}: tile`).toBe(money(expected[product.title], product.currency));
      // The regular price crossed out, on both.
      expect(tile.was, `${product.title}: tile strikes the regular price`).toBe(money(product.cents, product.currency));
      expect(own.was, `${product.title}: page strikes the regular price`).toBe(product.cents);
      // The 80% sale ten days ago took every price below today's: no
      // percentage on any page. The chip still says what today's sale takes
      // off the price it crosses out.
      expect(own.percent, `${product.title}: no percentage against a lower earlier price`).toBeNull();
      expect(tile.chip, `${product.title}: chip`).toBe(chips[product.title]);
      // The page says so in figures, except where the records cannot (the plate).
      expect(own.account, `${product.title}: what the crossed-out price is`).toBe(
        product.title === "Plate" ? "regular" : "lower",
      );
    }
    // In words, on the page: the lower price is stated beside the struck one.
    await buyer.goto(productPath(shop, id("Vase")));
    await expect(buyer.locator("[data-product-sale-ticket]")).toContainText(
      "Crossed-out price: the regular price. Lowest price in the 30 days before this sale: €4.80.",
    );
    await context.close();
  });

  test("an open storefront reads its prices again when the sale ends", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const shop = await seedShop(page, "sale-ends", [{ title: "Stoneware vase", cents: 2400 }]);
    const [vase] = shop.items;

    const context = await browser.newContext();
    const buyer = await context.newPage();
    // Warm the route first, so the sale's short life is not spent compiling it.
    await buyer.goto(shopPath(shop));
    await buyer.goto(productPath(shop, vase.id));

    await seedSale(shop, { percent_off: 10, starts_at: at(-5 * DAY), ends_at: at(12_000) });
    await buyer.goto(shopPath(shop));
    expect((await readTiles(buyer))[vase.id]).toEqual({ now: "€21.60", was: "€24.00", chip: "-10%" });
    const own = await context.newPage();
    await own.goto(productPath(shop, vase.id));
    await expect(own.locator("[data-product-price]").first()).toHaveAttribute("data-product-price", "2160");

    // Nobody reloads. Both pages come back to the listed price on their own.
    const tile = buyer.locator(`[data-storefront-tile='${vase.id}']`);
    await expect(tile.locator("[data-tile-price]")).toHaveText("€24.00", { timeout: 40_000 });
    await expect(tile.locator("[data-tile-sale-badge]")).toHaveCount(0);
    await expect(own.locator("[data-product-price]").first()).toHaveAttribute("data-product-price", "2400", {
      timeout: 40_000,
    });
    await expect(own.locator("[data-product-sale-ticket]")).toHaveCount(0);
    await context.close();
  });

  test("nothing is clipped: the struck price gives way on a tile too small for both, and the chip stays inside", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const products = [
      { title: "Stoneware vase", cents: 2400 },
      { title: "Roundhouse coffee table", cents: 174_500 },
      { title: "Linen apron", cents: 3800 },
    ];
    const context = await browser.newContext();
    const buyer = await context.newPage();

    // The price in the title band, then floated over the picture in a corner
    // and in the middle (every place a seller can put it). The second time the
    // chip is asked for in the price's own corner while an overlaid title holds
    // the other edge: the one layout where the two share a row, and each has
    // to make room for the other.
    for (const [tag, placement] of [
      ["clip-band", { priceTagPosition: "below", titleStyle: "bar" }],
      ["clip-corner", { priceTagPosition: "top-left", titleStyle: "overlay", saleBadgePosition: "top-left" }],
      ["clip-middle", { priceTagPosition: "middle-center", titleStyle: "shadow", saleBadgePosition: "bottom-right" }],
      // Every other look in the shared row, where each takes its own room.
      ...(["sticker", "flag", "ribbon"] as const).map(
        (saleBadgeLook) =>
          [
            `clip-${saleBadgeLook}`,
            { priceTagPosition: "top-left", titleStyle: "overlay", saleBadgePosition: "top-left", saleBadgeLook },
          ] as const,
      ),
    ] as const) {
      const elsewhere = await browser.newContext();
      const shop = await seedShop(await elsewhere.newPage(), tag, products, { ...THEME, ...placement });
      await elsewhere.close();
      await seedSale(shop, { percent_off: 10, starts_at: at(-5 * DAY) });

      let struckSomewhere = false;
      let chipSomewhere = false;
      for (const width of [320, 360, 390, 430, 768, 1280]) {
        await buyer.setViewportSize({ width, height: 900 });
        await buyer.goto(shopPath(shop));
        const measured = await buyer.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("[data-storefront-tile]")].map((tile) => {
            const chip = tile.querySelector<HTMLElement>("[data-tile-price]")!;
            const struck = chip.querySelector<HTMLElement>("[data-tile-price-was]");
            const price = (struck ? chip.querySelector<HTMLElement>("span[aria-hidden='true']") : chip)!;
            const badge = tile.querySelector<HTMLElement>("[data-tile-sale-badge]")!;
            const box = tile.getBoundingClientRect();
            const inside = (node: HTMLElement) => {
              const rect = node.getBoundingClientRect();
              return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5;
            };
            const a = chip.getBoundingClientRect();
            const b = badge.getBoundingClientRect();
            return {
              price: price.textContent,
              priceInside: inside(price),
              chipInside: inside(chip),
              badgeInside: inside(badge),
              // The sale chip and the price never sit on top of each other.
              apart: a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5,
              struckShown: struck ? struck.getBoundingClientRect().width > 1 : false,
              badgeShown: b.width > 1,
            };
          }),
        );
        expect(measured).toHaveLength(products.length);
        for (const tile of measured) {
          expect(tile.priceInside, `${tag} at ${width}px: ${tile.price} inside its tile`).toBe(true);
          expect(tile.chipInside, `${tag} at ${width}px: the chip around ${tile.price} inside its tile`).toBe(true);
          expect(tile.badgeInside, `${tag} at ${width}px: the sale chip inside its tile`).toBe(true);
          expect(tile.apart, `${tag} at ${width}px: the sale chip clear of ${tile.price}`).toBe(true);
          struckSomewhere ||= tile.struckShown;
          chipSomewhere ||= tile.badgeShown;
        }
        // Nothing runs off the side of the screen either.
        expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      // And neither is always given way: where there is room, both are drawn.
      expect(struckSomewhere, `${tag}: struck price drawn at some width`).toBe(true);
      expect(chipSomewhere, `${tag}: sale chip drawn at some width`).toBe(true);
    }
    await context.close();
  });

  test("holds under a burst: every answer carries the sale price, none the listed one alone", async ({ page }) => {
    test.setTimeout(180_000);
    const shop = await seedShop(page, "sale-burst", [
      { title: "Stoneware vase", cents: 2400 },
      { title: "Linen apron", cents: 3800 },
    ]);
    const [vase, apron] = shop.items;
    await seedSale(shop, { percent_off: 10, starts_at: at(-5 * DAY) });
    // Warm both routes before the burst.
    await readProductPage(page.request, shop, vase.id);
    expect((await page.request.get(shopPath(shop))).status()).toBe(200);

    const board = async () => {
      const response = await page.request.get(shopPath(shop));
      return { status: response.status(), html: await response.text() };
    };
    const boards = await Promise.all(Array.from({ length: 30 }, board));
    const pages = await Promise.all(
      Array.from({ length: 30 }, (_, index) => readProductPage(page.request, shop, index % 2 === 0 ? vase.id : apron.id)),
    );

    for (const answer of boards) {
      expect(answer.status).toBe(200);
      // Both sale prices are there, each with its regular price crossed out
      // and its chip: a board that fell back to the listed prices has none.
      expect(answer.html).toContain("€21.60");
      expect(answer.html).toContain("€34.20");
      expect(answer.html.split("data-tile-price-was").length - 1).toBe(2);
      expect(answer.html.split("data-tile-sale-badge").length - 1).toBe(2);
    }
    for (const [index, answer] of pages.entries()) {
      expect(answer.cents, `product page ${index}`).toBe(index % 2 === 0 ? 2160 : 3420);
      expect(answer.was, `product page ${index}: regular price`).toBe(index % 2 === 0 ? 2400 : 3800);
    }
  });
});
