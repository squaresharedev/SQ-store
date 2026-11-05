import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  canvasStill,
  createStorefrontViaUI,
  expectToast,
  fillStable,
  freshUser,
  gotoApp,
  openProductExtra,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * PREDICTIONS (src/lib/predictions.ts) as a seller meets them: an empty board
 * offers a real product, new products, discounts, storefronts and shipping
 * terms start from what the store already does, the ship form starts on the
 * store's carrier, and the overview warns before something sells out. The
 * rules' finer points are in tests/unit/predictions.test.ts. What matters most
 * here is what must NOT happen: a suggestion is never saved until the seller
 * takes it.
 */

/** A seller with these products, one per test (sign-up mints the only users). */
async function sellerWith(page: Page, tag: string, titles: string[]) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  if (titles.length > 0) await seedProducts(sellerId, titles.map((title) => ({ title })));
  return sellerId;
}

async function openNewStorefront(page: Page) {
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  await expect(page.getByRole("toolbar", { name: "Editor tools" })).toBeVisible();
  await canvasStill(page);
}

const suggested = (page: Page) => page.locator("[data-suggested-tile]");
const placedTiles = (page: Page) => page.locator("[data-grid-cell]");

type StoredConfig = {
  blocks: unknown[];
  theme: Record<string, unknown>;
  header?: { name: string };
  productPage?: Record<string, unknown>;
  checkoutPage?: Record<string, unknown>;
  embed?: { enabled: boolean; domains: string[] };
};

/** The newest storefront's row. */
async function newestStorefront(sellerId: string) {
  const rows = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id,name,config&order=created_at.desc&limit=1`,
  )) as { id: string; name: string; config: StoredConfig }[];
  const row = rows[0];
  if (!row) throw new Error("no storefront");
  return row;
}

/** The newest storefront's stored config. */
async function newestConfig(sellerId: string) {
  return (await newestStorefront(sellerId)).config;
}

/** A stored photo key of the shape uploads produce, owned by this seller. */
const photoKey = (sellerId: string, name: string) =>
  `images/${sellerId}/11111111-1111-4111-8111-111111111111-${name}.webp`;

/** Open the palette once the page can hear it (a press before hydration is lost). */
async function openSearch(page: Page) {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("combobox")).toBeFocused({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("an empty board", () => {
  test("offers the product last touched, and it costs nothing to ignore", async ({ page }) => {
    const sellerId = await sellerWith(page, "predict-ghost", ["Mug", "Bowl", "Plate"]);
    await serviceRest(`/products?owner_id=eq.${sellerId}&title=eq.Bowl`, {
      method: "PATCH",
      body: { description: "Just edited" },
    });

    await openNewStorefront(page);
    const accept = page.getByRole("button", { name: "Add Bowl to this storefront" });
    await expect(accept).toBeVisible();
    await expect(placedTiles(page)).toHaveCount(0);
    await expect(page.getByText("Your grid is empty")).toHaveCount(0);

    // Saving with the suggestion on show stores no block at all.
    await page.getByRole("textbox", { name: /storefront name/i }).fill("Ignored suggestion");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect.poll(async () => (await newestConfig(sellerId)).blocks, { timeout: 15_000 }).toEqual([]);
  });

  test("takes it in one press, undo brings it back, and anything else clears it", async ({ page }) => {
    await sellerWith(page, "predict-take", ["Mug"]);
    await openNewStorefront(page);

    await page.getByRole("button", { name: "Add Mug to this storefront" }).click();
    await expect(placedTiles(page)).toHaveCount(1);
    await expect(suggested(page)).toHaveCount(0);

    await page.getByRole("button", { name: /^undo/i }).click();
    await expect(placedTiles(page)).toHaveCount(0);
    await expect(suggested(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await expect(placedTiles(page)).toHaveCount(1);
    await expect(suggested(page)).toHaveCount(0);
  });

  test("keeps the empty state with nothing it could offer", async ({ page }) => {
    const sellerId = await sellerWith(page, "predict-none", []);
    await seedProducts(sellerId, [{ title: "Unfinished", status: "draft" }]);
    await openNewStorefront(page);
    await expect(page.getByText("Your grid is empty")).toBeVisible();
    await expect(suggested(page)).toHaveCount(0);
  });

  test("passes an accessibility scan", async ({ page }) => {
    await sellerWith(page, "predict-axe", ["Mug"]);
    await openNewStorefront(page);
    await expect(suggested(page)).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).include("[data-suggested-tile]").analyze();
    expect(violations).toEqual([]);
  });

  test.describe("on a phone", () => {
    const phone = devices["iPhone 13"];
    test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true });

    test("pans from the tile without taking it, and a tap takes it", async ({ page }) => {
      await sellerWith(page, "predict-phone", ["Mug"]);
      await openNewStorefront(page);
      const accept = page.getByRole("button", { name: "Add Mug to this storefront" });
      await expect(accept).toBeVisible();

      const box = await accept.boundingBox();
      if (!box) throw new Error("no tile");
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const transform = () =>
        page.evaluate(
          () => (document.querySelector("[data-canvas-stage]") as HTMLElement | null)?.style.transform ?? "",
        );
      const before = await transform();
      await page.evaluate(
        ({ x, y }) => {
          const start = document.elementFromPoint(x, y);
          if (!start) throw new Error("nothing under the finger");
          const base = { pointerId: 91, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1 };
          start.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y }));
          for (let step = 1; step <= 8; step += 1) {
            window.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x, clientY: y + step * 10 }));
          }
          window.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: x, clientY: y + 80, buttons: 0 }));
          start.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y + 80 }));
        },
        from,
      );
      await expect.poll(transform).not.toBe(before);
      await expect(placedTiles(page)).toHaveCount(0);

      await canvasStill(page);
      await accept.tap();
      await expect(placedTiles(page)).toHaveCount(1);
    });
  });
});

test.describe("a new product", () => {
  test("starts in the store's currency, offers the last product in one tap, and takes it back in one", async ({ page }) => {
    const sellerId = await sellerWith(page, "predict-form", []);
    await seedProducts(sellerId, [
      {
        title: "Bowl",
        details: {
          safety: { manufacturerName: "Kiln Co", manufacturerAddress: "1 Clay Road", manufacturerEmail: "hi@kiln.example" },
        },
      },
    ]);
    await serviceRest(`/products?owner_id=eq.${sellerId}`, { method: "PATCH", body: { currency: "USD" } });

    await gotoApp(page, "/products/new");
    await expect(page.locator('[data-product-field="currency"]')).toHaveAttribute("data-product-value", "USD");

    // Offered under the title, never filled in: it is a claim made to buyers.
    const maker = page.locator('[data-product-field="safety.manufacturerName"]');
    await expect(maker).toHaveCount(0);
    const sameAs = page.getByRole("button", { name: "Same as Bowl" });
    // Marked as a guess by the flowing rim, and it says what it copies, on
    // hover and to a screen reader.
    await expect(sameAs).toHaveClass(/suggestion-surface/);
    const copies = /^Copies the options, specifications and maker details from Bowl into the sections/;
    await expect(sameAs).toHaveAccessibleDescription(copies);
    await sameAs.hover();
    await expect(page.locator("[data-tooltip]")).toHaveText(copies);
    await sameAs.click();
    await expect(maker).toHaveValue("Kiln Co");

    // One tap out: the curved arrow, no text on it, its name on hover.
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toHaveText("");
    await undo.hover();
    await expect(page.locator("[data-tooltip]")).toHaveText("Undo");
    await undo.click();
    await expect(maker).toHaveCount(0);

    // From the keyboard, focus follows: onto the arrow, then back onto the chip.
    await sameAs.focus();
    await page.keyboard.press("Enter");
    await expect(maker).toHaveValue("Kiln Co");
    await expect(undo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(maker).toHaveCount(0);
    await expect(sameAs).toBeFocused();
  });

  test("copies options, specifications, maker and EU contact from ONE product, and saves them like typed", async ({
    page,
  }) => {
    const sellerId = await sellerWith(page, "predict-same", []);
    await seedProducts(sellerId, [
      {
        title: "Shirt",
        max_per_order: 2,
        option_groups: [
          {
            id: "10300000-0000-4000-8000-000000000001",
            name: "Size",
            display: "chip",
            options: [
              { id: "10300000-0000-4000-8000-000000000002", name: "S", available: true },
              { id: "10300000-0000-4000-8000-000000000003", name: "M", available: false },
            ],
          },
        ],
        details: {
          materials: "Organic cotton",
          origin: "Portugal",
          care: "Wash cold",
          badges: [{ icon: "hand-heart", label: "Sewn in Porto" }],
          safety: {
            manufacturerName: "Kiln Co",
            manufacturerAddress: "1 Clay Road",
            manufacturerEmail: "hi@kiln.example",
            responsibleName: "EU Rep Co",
            responsibleAddress: "2 Rue du Port, Lyon",
            responsibleEmail: "rep@eurep.example",
          },
        },
      },
    ]);
    // Newer, with nothing to copy: the copy comes from the newest product that has something.
    await seedProducts(sellerId, [{ title: "Cap", max_per_order: 2 }]);

    await gotoApp(page, "/products/new");
    await fillStable(page, "Title", "Linen shirt");
    await fillStable(page, /price/i, "40");
    // The order limit both earlier products share, shown in its opened fold.
    await expect(page.locator('[data-product-field="maxPerOrder"]')).toHaveValue("2");

    // A shirt is sold in sizes, but the copy brings its own: once taken, the size guess steps aside.
    await expect(page.getByRole("button", { name: "Sizes XS to XXL" })).toBeVisible();
    await page.getByRole("button", { name: "Same as Shirt" }).click();
    await expect(page.getByRole("button", { name: "Sizes XS to XXL" })).toHaveCount(0);
    await expect(page.locator('[data-product-field="optionGroups"]')).toHaveAttribute("data-product-value", "1");
    await expect(page.locator('[data-product-field="materials"]')).toHaveValue("Organic cotton");
    await expect(page.locator('[data-product-field="origin"]')).toHaveValue("Portugal");
    await expect(page.locator('[data-product-field="safety.manufacturerName"]')).toHaveValue("Kiln Co");
    await expect(page.locator('[data-product-field="safety.responsibleName"]')).toHaveValue("EU Rep Co");

    await openProductExtra(page, "badges");
    const own = page.locator('[data-badge-suggestion="own"]');
    await expect(own).toHaveText("Sewn in Porto");
    // An own badge is offered first, and every ready-made one stays offered after it.
    await expect(page.locator("[data-badge-suggestion]")).toHaveCount(5);
    await own.click();
    await expect(page.locator("[data-product-badge-label]").first()).toHaveValue("Sewn in Porto");

    // Saved like anything typed: the sizes under ids of their own, all on sale.
    await page.getByRole("button", { name: /save product|save as draft/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });
    const [saved] = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&title=eq.Linen shirt&select=option_groups,details,max_per_order`,
    )) as {
      option_groups: { id: string; options: { id: string; name: string; available: boolean }[] }[];
      details: { materials?: string; safety?: { responsibleName?: string }; badges?: { label: string }[] };
      max_per_order: number;
    }[];
    expect(saved.option_groups[0]?.options.map(({ name, available }) => ({ name, available }))).toEqual([
      { name: "S", available: true },
      { name: "M", available: true },
    ]);
    expect(saved.option_groups[0]?.id).not.toBe("10300000-0000-4000-8000-000000000001");
    expect(saved.details.materials).toBe("Organic cotton");
    expect(saved.details.safety?.responsibleName).toBe("EU Rep Co");
    expect(saved.details.badges?.map(({ label }) => label)).toEqual(["Sewn in Porto"]);
    expect(saved.max_per_order).toBe(2);
  });

  test("a clothing title offers its sizes, and a size offers the next ones", async ({ page }) => {
    await sellerWith(page, "predict-sizes", []);
    await gotoApp(page, "/products/new");
    // Nothing sure to offer for a mug.
    await fillStable(page, "Title", "Ceramic mug");
    await expect(page.locator("[data-product-starters]")).toHaveCount(0);

    await fillStable(page, "Title", "Oversized hoodie");
    const sizes = page.getByRole("button", { name: "Sizes XS to XXL" });
    await expect(sizes).toHaveAccessibleDescription(/^Your title sounds like clothing/);
    await sizes.click();
    const rows = page.locator("[data-option-row]");
    await expect(rows).toHaveCount(6);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('[data-product-section="options"]')).toHaveCount(0);

    // Typed by hand: "Small" brings Medium, Large and Extra large, one tap each.
    await openProductExtra(page, "options");
    await page.getByRole("button", { name: "Something else" }).click();
    const draft = page.getByLabel("Add options");
    await draft.fill("Small");
    await draft.press("Enter");
    const next = page.locator("[data-option-next]").getByRole("button");
    await expect(next).toHaveText(["Medium", "Large", "Extra large"]);
    // Guesses too: the same rim, and a word on where they came from.
    await expect(next.first()).toHaveClass(/suggestion-surface/);
    await expect(next.first()).toHaveAccessibleDescription("Guessed from the options you've added so far.");
    await page.getByRole("button", { name: "Add Medium" }).click();
    await expect(rows).toHaveCount(2);
    await expect(next).toHaveText(["Large", "Extra large"]);
  });

  test("a form nobody touched leaves without a warning", async ({ page }) => {
    const sellerId = await sellerWith(page, "predict-clean", ["Bowl"]);
    await serviceRest(`/products?owner_id=eq.${sellerId}`, { method: "PATCH", body: { currency: "USD" } });
    await gotoApp(page, "/products/new");
    await expect(page.locator('[data-product-field="currency"]')).toHaveAttribute("data-product-value", "USD");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.locator('main a[href="/products"]').first().click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });
  });
});

test("a new discount follows two that agree", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-discount", ["Bowl"]);
  const day = 86_400_000;
  const sale = (startedDaysAgo: number) => {
    const start = Date.now() - startedDaysAgo * day;
    return {
      owner_id: sellerId,
      kind: "automatic",
      value_type: "percent",
      percent_off: 20,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + 7 * day).toISOString(),
    };
  };
  await serviceRest(`/discounts`, { method: "POST", body: [sale(60), sale(30)] });

  await gotoApp(page, "/discounts/new");
  await expect(page.getByRole("spinbutton")).toHaveValue("20");
  await expect(page.getByLabel("Time")).toBeVisible();
});

test("a new code offers the channel the seller shares on first", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-channel", ["Bowl"]);
  const code = (value: string) => ({
    owner_id: sellerId,
    kind: "code",
    code: value,
    share_channel: "Pinterest",
    value_type: "percent",
    percent_off: 10,
  });
  await serviceRest(`/discounts`, { method: "POST", body: [code("PIN10"), code("PIN15")] });

  await gotoApp(page, "/discounts/new");
  const form = page.locator("[data-discount-form]");
  await form.locator("[data-discount-kind-option='code']").click();
  const chips = form.getByRole("group", { name: "Suggested channels" }).getByRole("button");
  await expect(chips.first()).toHaveText("Pinterest");
  // The seller's own come first, and every usual one stays after them.
  await expect(chips).toHaveCount(6);
  await chips.first().click();
  await expect(form.getByLabel("Shared on (optional)")).toHaveValue("Pinterest");
});

test("a second storefront is named after the business and starts designed like the first, without its files", async ({
  page,
}) => {
  const sellerId = await sellerWith(page, "predict-look", []);
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: "Kiln and Co" });
  await openNewStorefront(page);
  const first = await newestStorefront(sellerId);
  expect(first.name).toBe("Kiln and Co");
  expect(first.config.header?.name).toBe("Kiln and Co");
  await serviceRest(`/storefronts?id=eq.${first.id}`, {
    method: "PATCH",
    body: {
      config: {
        ...first.config,
        theme: {
          ...first.config.theme,
          accent: "#aa0044",
          background: { kind: "image", key: photoKey(sellerId, "backdrop"), x: 50, y: 50, scale: 100 },
        },
        productPage: { ...first.config.productPage, ctaLabel: "Get yours", backgroundImage: { key: photoKey(sellerId, "page") } },
        checkoutPage: {
          layout: "compact",
          giftMessage: true,
          celebrate: "confetti",
          note: "Thanks for shopping small",
          backgroundImage: { key: photoKey(sellerId, "checkout") },
        },
      },
    },
  });

  await openNewStorefront(page);
  const second = await newestStorefront(sellerId);
  // " 2" tells the seller's own list apart; buyers read the business's name.
  expect(second.name).toBe("Kiln and Co 2");
  expect(second.config.header?.name).toBe("Kiln and Co");
  expect(second.config.theme.accent).toBe("#aa0044");
  expect((second.config.theme.background as { kind: string }).kind).toBe("solid");
  expect(second.config.productPage?.ctaLabel).toBe("Get yours");
  expect(second.config.checkoutPage).toMatchObject({ layout: "compact", note: "Thanks for shopping small" });
  expect(JSON.stringify(second.config)).not.toMatch(/backdrop\.webp|page\.webp|checkout\.webp/);
});

test("a storefront's embed page offers another storefront's domains, and saves nothing by itself", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-embed", []);
  await openNewStorefront(page);
  const first = await newestStorefront(sellerId);
  await serviceRest(`/storefronts?id=eq.${first.id}`, {
    method: "PATCH",
    body: { name: "Main shop", config: { ...first.config, embed: { enabled: false, domains: ["shop.example", "www.shop.example"] } } },
  });
  await openNewStorefront(page);
  const second = await newestStorefront(sellerId);

  await gotoApp(page, `/storefront/${second.id}/embed`);
  const field = page.locator("#embed-domains");
  await expect(field).toHaveValue("");
  await page.getByRole("button", { name: "Same as Main shop" }).click();
  await expect(field).toHaveValue("shop.example, www.shop.example");
  expect((await newestConfig(sellerId)).embed?.domains ?? []).toEqual([]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("");
});

test("shipping terms offer the business's country and start in the catalogue's currency", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-ship", ["Bowl"]);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await serviceRest(`/products?owner_id=eq.${sellerId}`, { method: "PATCH", body: { currency: "USD" } });

  await gotoApp(page, "/settings/shipping");
  await expect(page.locator("#rates_currency")).toContainText("USD");
  await expect(page.locator("#ships_from")).toContainText("Not set");
  const offer = page.getByRole("button", { name: "Same as your business: Ireland" });
  await offer.click();
  await expect(page.locator("#ships_from")).toContainText("Ireland");
  await expect(offer).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#ships_from")).toContainText("Not set");
  await expect(offer).toBeVisible();
});

test("the ship form opens on the carrier last used to that country, and follows the next one", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-carrier", []);
  const toIreland = { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", postalCode: "D02 X285", country: "IE" };
  const toFrance = { name: "Camille Roux", line1: "3 Rue Neuve", city: "Lyon", postalCode: "69001", country: "FR" };
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  // DHL to France two days ago, then An Post at home yesterday.
  await seedOrders(sellerId, [
    { amount_cents: 1000, product_title: "Old parcel to France", tracking_number: "JD0001", ship_to: toFrance, created_at: daysAgo(2) },
    { amount_cents: 1000, product_title: "Old parcel to Ireland", tracking_number: "JD0002", ship_to: toIreland, created_at: daysAgo(1) },
  ]);
  const carried = (title: string, carrier: string) =>
    serviceRest(`/orders?seller_id=eq.${sellerId}&product_title=eq.${title}`, {
      method: "PATCH",
      body: { tracking_carrier: carrier },
    });
  await carried("Old parcel to France", "dhl");
  await carried("Old parcel to Ireland", "an-post");
  await seedOrders(sellerId, [
    { amount_cents: 1000, product_title: "First parcel", fulfilment_status: "unfulfilled", ship_to: toFrance },
    { amount_cents: 1000, product_title: "Second parcel", fulfilment_status: "unfulfilled", ship_to: toFrance },
    { amount_cents: 1000, product_title: "Third parcel", fulfilment_status: "unfulfilled", ship_to: toIreland },
  ]);

  await gotoApp(page, "/orders?view=to-ship");
  const panel = page.getByRole("dialog", { name: /order details/i });
  const ship = async (title: string, tracking: string) => {
    await page.locator("tr", { hasText: title }).click();
    await panel.getByRole("button", { name: "Mark as shipped" }).click();
    await panel.getByLabel("Tracking number (optional)").fill(tracking);
    return panel.getByRole("combobox", { name: "Carrier (optional)" });
  };
  const shipAndClose = async () => {
    await panel.getByRole("button", { name: "Mark shipped" }).click();
    await expectToast(page, /Marked as shipped/);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  };

  // France went with DHL, though An Post was used since.
  const first = await ship("First parcel", "123456");
  await expect(first).toContainText("DHL");
  await first.click();
  await page.getByRole("option", { name: "GLS" }).click();
  await shipAndClose();

  // Ireland keeps its own.
  await expect(await ship("Third parcel", "777777")).toContainText("An Post");
  await shipAndClose();

  // The next parcel to France, without leaving the page, starts on the one just used.
  await expect(await ship("Second parcel", "654321")).toContainText("GLS");
});

test("the overview warns before a product sells out", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-restock", []);
  await seedProducts(sellerId, [
    { title: "Glaze kit", track_stock: true, stock_quantity: 3 },
    // Selling as fast, but its low-stock alert is off: a last batch nobody wants to hear about.
    { title: "Last batch", track_stock: true, stock_quantity: 3, low_stock_threshold: 0 },
  ]);
  const ids = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const id = ids.find(({ title }) => title === "Glaze kit")!.id;
  const lastBatch = ids.find(({ title }) => title === "Last batch")!.id;
  // Twenty sold in the last four weeks: three left last about four days.
  await seedOrders(sellerId, [
    { amount_cents: 1000, product_id: id, product_title: "Glaze kit", quantity: 10 },
    { amount_cents: 1000, product_id: id, product_title: "Glaze kit", quantity: 10 },
    { amount_cents: 1000, product_id: lastBatch, product_title: "Last batch", quantity: 20 },
  ]);

  await gotoApp(page, "/dashboard");
  await expect(page.getByText("1 product selling out soon")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('At this pace "Glaze kit" sells out in about 4 days.')).toBeVisible();
  await expect(page.getByRole("link", { name: "Update stock" })).toHaveAttribute("href", `/products/${id}/edit`);
});

test("the buy button starts on the storefront edited last", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-button", ["Lamp"]);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await seedStorefronts(sellerId, [{ name: "Spring" }, { name: "Autumn" }]);
  const [{ id: lamp }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  // Each write moves the storefront's updated_at, which is what "edited last" reads.
  const place = async (name: string) => {
    const where = `/storefronts?owner_id=eq.${sellerId}&name=eq.${name}`;
    const [{ config }] = (await serviceRest(`${where}&select=config`)) as { config: StoredConfig }[];
    await serviceRest(where, {
      method: "PATCH",
      body: { config: { ...config, blocks: [{ type: "product", productId: lamp, x: 0, y: 0, w: 2, h: 2 }] } },
    });
  };
  const openButton = async () => {
    await gotoApp(page, "/products");
    await page.getByRole("button", { name: "More actions for Lamp" }).click();
    await page.getByRole("button", { name: "Add to your website" }).click();
    return page.getByRole("dialog", { name: "Add a buy button to your website" }).getByRole("combobox", { name: "Page design" });
  };

  await place("Autumn");
  await place("Spring");
  await expect(await openButton()).toContainText("Spring");
  await place("Autumn");
  await expect(await openButton()).toContainText("Autumn");
});

test("search's Recent rail leads with the product touched last", async ({ page }) => {
  const sellerId = await sellerWith(page, "predict-recent", ["Mug"]);
  await seedProducts(sellerId, [{ title: "Bowl" }]);
  await seedProducts(sellerId, [{ title: "Plate" }]);
  await serviceRest(`/products?owner_id=eq.${sellerId}&title=eq.Mug`, { method: "PATCH", body: { description: "Just edited" } });

  await gotoApp(page, "/discounts");
  await openSearch(page);
  await expect(page.getByRole("group", { name: "Recent" }).getByRole("option").first()).toContainText("Mug");
});
