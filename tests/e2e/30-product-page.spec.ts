import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  anonRest,
  canvasStill,
  expectToast,
  freshUser,
  gotoApp,
  seedProducts,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

// The hosted product page, end to end: what a buyer gets, what they must NOT
// get, how the widget learns where a tile goes, and the editor's "Product
// page" node that designs it. One seller per test (sign-up is the only way the
// stack mints a user); everything else is seeded straight in.

const COLOUR_GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0";
const RED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BLUE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const COVER = "https://images.example/lamp-cover.jpg";
const BLUE_SHOT = "https://images.example/lamp-blue.jpg";
const CERT_PDF = "https://images.example/lamp-ce-certificate.pdf";

/** The default theme, spelled out: the spec must not reach into src/. */
const THEME = {
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
  displayMode: "grid",
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

/** The product page's stored options, spelled out for the same reason THEME
 *  is: the spec must not reach into src/. */
const PRODUCT_PAGE = {
  enabled: true,
  layout: "gallery-left",
  gallery: "thumbnails",
  imageFit: "contain",
  ctaLabel: "Buy now",
  ctaStyle: "accent",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: true,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map(
    (id) => ({ id, show: true }),
  ),
};

/** A named shipping exception, the way the storefront config stores one. */
const BULKY_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

type Seeded = {
  sellerId: string;
  storefrontId: string;
  active: string;
  draft: string;
  unplaced: string;
  bulky: string;
  plain: string;
};

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  await seedProducts(sellerId, [
    {
      title: "Oak lamp",
      price_cents: 12900,
      image_key: COVER,
      description: "Warm light for long evenings.\n\nHand finished.",
      gallery: [{ key: BLUE_SHOT, alt: "Blue lamp", optionId: BLUE }],
      option_groups: [
        {
          id: COLOUR_GROUP,
          name: "Colour",
          display: "swatch",
          options: [
            { id: RED, name: "Red", swatch: "#cc0000", available: true },
            { id: BLUE, name: "Blue", swatch: "#0000cc", available: true },
          ],
        },
      ],
      details: { materials: "Oak", dimensions: { length: 40, width: 20, height: 30, unit: "cm" } },
      documents: [{ key: CERT_PDF, label: "CE Certificate" }],
      purchase_url: "https://shop.example.com/lamp",
    },
    // Ships on its own terms rather than the store's: the exception that
    // shipping profiles exist for.
    {
      title: "Oak sideboard",
      price_cents: 89900,
      image_key: COVER,
      shipping_profile_id: BULKY_PROFILE,
    },
    // No image and no gallery ON PURPOSE: seeded photo keys are https:// URLs
    // (the stack has no R2), and the write path rightly refuses a key it
    // cannot prove the seller owns — so this is the product a spec can save
    // through the real form.
    { title: "Plain shelf", price_cents: 4900 },
    { title: "Hidden draft", status: "draft" },
    { title: "Never placed" },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const byTitle = (title: string) => products.find((p) => p.title === title)!.id;
  const seeded = {
    sellerId,
    storefrontId,
    active: byTitle("Oak lamp"),
    bulky: byTitle("Oak sideboard"),
    plain: byTitle("Plain shelf"),
    draft: byTitle("Hidden draft"),
    unplaced: byTitle("Never placed"),
  };

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [
          { type: "product", productId: seeded.active, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.bulky, x: 4, y: 0, w: 2, h: 2 },
          { type: "product", productId: seeded.plain, x: 0, y: 2, w: 2, h: 2 },
          { type: "product", productId: seeded.draft, x: 2, y: 0, w: 2, h: 2 },
        ],
        seller: { businessName: "Lamp Studio Ltd", email: "hi@lamp.example", country: "IE" },
        policies: {
          shipping: "Ships in 3 days.",
          dispatch: "Ships within 24 hours",
          returns: "30 days, no questions.",
        },
        shippingProfiles: [
          {
            id: BULKY_PROFILE,
            name: "Bulky items",
            dispatch: "Made to order, allow 3 weeks",
            body: "Delivered by pallet courier to a ground-floor address.",
          },
        ],
      },
    },
  });
  return seeded;
}

const pagePath = (s: Seeded, productId: string) => `/s/${s.storefrontId}/p/${productId}`;

/**
 * Expand one of the fold's sections, whatever state it starts in.
 *
 * The FIRST section renders open, and which section that is depends on what
 * the product has to say — Specifications for the lamp, Shipping for the
 * sideboard that has no specs. A blind summary click would shut the one it
 * meant to open.
 */
async function openSection(page: Page, id: string) {
  const section = page.locator(`[data-product-section='${id}']`);
  if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await section.locator("summary").click();
  }
  return section;
}

test.describe("hosted product page", () => {
  test("a buyer gets the page: title, price, options that swap the photo, and the buy link", async ({
    page,
  }) => {
    const s = await seed(page, "pdp-buyer");
    // A buyer has no session. Drop the seller's cookies to be sure.
    await page.context().clearCookies();

    const response = await page.goto(pagePath(s, s.active));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Oak lamp" })).toBeVisible();
    await expect(page.getByText("€129.00").first()).toBeVisible();
    await expect(page.getByText("incl. VAT, plus shipping").first()).toBeVisible();
    await expect(page.getByText("Sold by Lamp Studio Ltd")).toBeVisible();

    // The option picker swaps the hero photo.
    const hero = page.locator("[data-product-gallery] figure img").first();
    await expect(hero).toHaveAttribute("src", /lamp-cover/);
    await page.getByRole("radio", { name: "Blue" }).click();
    await expect(page.getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
    await expect(hero).toHaveAttribute("src", /lamp-blue/);
    // The choice is reflected in the address, so the link can be shared.
    await expect(page).toHaveURL(new RegExp(`o=${BLUE}`));

    // The buy button is the seller's own link, and says so.
    const buy = page.getByRole("link", { name: /buy now/i }).first();
    await expect(buy).toHaveAttribute("href", "https://shop.example.com/lamp");
    await expect(buy).toHaveAttribute("rel", /noopener/);
    await expect(page.getByText("shop.example.com").first()).toBeVisible();

    // The description reads in the buy box, between the title and the price,
    // and is NOT repeated in the fold below.
    const info = page.locator("[data-product-description]");
    await expect(info).toContainText("Warm light for long evenings.");
    await expect(page.locator("[data-product-section='description']")).toHaveCount(0);
    await expect(page.locator("[data-product-details-heading]")).toBeVisible();

    // Sections, statutory lines for an EU seller, and the specs table. Only
    // the first section starts open; the rest expand on their heading. With
    // the description up in the buy box, Specifications is that first one.
    await expect(page.locator("[data-product-section='seller']")).toBeVisible();
    await expect(page.locator("[data-product-statutory]")).toHaveCount(1);
    await expect(page.getByText("40 × 20 × 30 cm")).toBeVisible();
    // Scoped to the section: the same sentence is also the trust line beside
    // the button, which is always visible.
    const returns = page.locator("[data-product-section='returns']");
    await expect(returns.getByText("30 days, no questions.")).toBeHidden();
    await returns.locator("summary").click();
    await expect(returns.getByText("30 days, no questions.")).toBeVisible();

    // The compliance document: public, not gated behind checkout.
    await page.locator("[data-product-section='documents'] summary").click();
    const certLink = page.getByRole("link", { name: /CE Certificate/i });
    await expect(certLink).toBeVisible();
    await expect(certLink).toHaveAttribute("href", /lamp-ce-certificate\.pdf/);
    await expect(certLink).toHaveAttribute("target", "_blank");

    // Head: refused to search engines by default, described for sharing.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Oak lamp");

    // Nothing private in the markup.
    const html = await page.content();
    expect(html).not.toContain("digital_file_key");
    expect(html).not.toContain("stock_quantity");
    expect(html).not.toContain(s.sellerId);

    // Same bar as the a11y suite: serious and critical fail the build.
    const axe = await new AxeBuilder({ page }).analyze();
    const blocking = axe.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("the seller stands open at the foot of the page, and shipping follows the profile", async ({
    page,
  }) => {
    const s = await seed(page, "pdp-shipping");
    await page.context().clearCookies();

    await page.goto(pagePath(s, s.active));

    // WHO IS SELLING is readable without opening anything. It used to be a
    // shut <details> in the accordion, which is exactly the wrong place for
    // the one block a buyer must never have to ask for.
    const sellerBlock = page.locator("[data-product-section='seller']");
    await expect(sellerBlock).toBeVisible();
    await expect(sellerBlock.getByText("Lamp Studio Ltd")).toBeVisible();
    await expect(sellerBlock.getByRole("link", { name: "hi@lamp.example" })).toBeVisible();
    await expect(sellerBlock.locator("summary")).toHaveCount(0);

    // The store's default terms, which this product never had to be told.
    const shipping = await openSection(page, "shipping");
    await expect(shipping.getByText("Ships in 3 days.")).toBeVisible();
    // The dispatch line leads the trust list beside the button.
    const trust = page.locator("[data-product-trust]");
    await expect(trust.getByText("Ships within 24 hours")).toBeVisible();

    // The exception: a product that names a profile gets THAT profile, and
    // the store's default is gone rather than printed alongside it.
    await page.goto(pagePath(s, s.bulky));
    const bulkyShipping = await openSection(page, "shipping");
    await expect(bulkyShipping.getByText(/pallet courier/)).toBeVisible();
    await expect(bulkyShipping.getByText("Ships in 3 days.")).toHaveCount(0);
    await expect(
      page.locator("[data-product-trust]").getByText("Made to order, allow 3 weeks"),
    ).toBeVisible();
    await expect(
      page.locator("[data-product-trust]").getByText("Ships within 24 hours"),
    ).toHaveCount(0);
  });

  test("the product form inherits shipping terms instead of asking for them again", async ({
    page,
  }) => {
    const s = await seed(page, "pdp-form-shipping");

    await gotoApp(page, `/products/${s.plain}/edit`);
    const section = page.locator("[data-product-section='shipping']");
    await expect(section).toBeVisible();
    // The section asks for a CHOICE, never for prose: no textarea to fill in,
    // and the store's own terms shown so "uses your store's terms" is
    // something the seller can check rather than take on faith.
    await expect(section.locator("textarea")).toHaveCount(0);
    await expect(section.getByText("Ships in 3 days.")).toBeVisible();
    await expect(section.getByText("Ships within 24 hours")).toBeVisible();
    await expect(section.getByRole("link", { name: /edit your shipping terms/i })).toBeVisible();

    // The rail and the header summarise it as a real answer, not as "Empty".
    await expect(page.getByRole("link", { name: /^Shipping/ }).first()).toContainText("Store terms");

    // Switching this product onto the named profile is one pick, and it sticks
    // across a save.
    await section.getByRole("combobox").click();
    await page.getByRole("option", { name: /Bulky items/ }).click();
    await expect(section.getByText(/pallet courier/)).toBeVisible();
    await page.getByRole("button", { name: /save changes/i }).click();
    await expectToast(page, /was saved/i);

    await gotoApp(page, `/products/${s.plain}/edit`);
    await expect(
      page.locator("[data-product-field='shippingProfile']"),
    ).toHaveAttribute("data-product-value", BULKY_PROFILE);

    // ...and the buyer's page now quotes those terms.
    await page.context().clearCookies();
    await page.goto(pagePath(s, s.plain));
    const shipping = await openSection(page, "shipping");
    await expect(shipping.getByText(/pallet courier/)).toBeVisible();
  });

  test("the indexing switch really decides what a crawler is told", async ({ page }) => {
    const s = await seed(page, "pdp-index");
    await page.context().clearCookies();

    // OFF (the default): refused, and no canonical to follow either. The
    // (public) layout refuses everything under it, so this is also the case
    // that proves the page is not quietly opting itself in.
    await page.goto(pagePath(s, s.active));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

    // ON: the page's own metadata has to OVERRIDE the layout's blanket
    // refusal, which is the whole of what this switch does. Without that, a
    // seller could turn indexing on and still be invisible.
    await serviceRest(`/storefronts?id=eq.${s.storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: s.active, x: 0, y: 0, w: 2, h: 2 }],
          productPage: { ...PRODUCT_PAGE, allowIndexing: true },
        },
      },
    });
    await page.goto(pagePath(s, s.active));
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /(^|,\s*)index/);
    await expect(robots).not.toHaveAttribute("content", /noindex/);
    await expect(robots).not.toHaveAttribute("content", /nofollow/);
    // A canonical is what stops the same product ranking twice once it is
    // allowed in at all.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${s.storefrontId}/p/${s.active}$`),
    );
  });

  test("every way a page can be unavailable is the same 404", async ({ page }) => {
    const s = await seed(page, "pdp-404");
    await page.context().clearCookies();

    const cases = [
      ["a draft product", pagePath(s, s.draft)],
      ["a product not on the storefront", pagePath(s, s.unplaced)],
      ["an unknown product", pagePath(s, "00000000-0000-4000-8000-000000000000")],
      ["a garbage id", `/s/${s.storefrontId}/p/not-a-uuid`],
    ] as const;
    for (const [label, path] of cases) {
      const response = await page.goto(path);
      expect(response?.status(), label).toBe(404);
      await expect(page.getByText("This product isn't available"), label).toBeVisible();
    }

    // Switching product pages off takes the live one down too.
    await serviceRest(`/storefronts?id=eq.${s.storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: s.active, x: 0, y: 0, w: 2, h: 2 }],
          // Carries the RETIRED `surface` key on purpose: a config saved
          // before the page stopped floating on a card must still parse, or
          // this switch would appear not to work at all.
          productPage: { ...PRODUCT_PAGE, enabled: false, surface: "card" },
        },
      },
    });
    const off = await page.goto(pagePath(s, s.active));
    expect(off?.status()).toBe(404);

    // And the anon key still reads nothing from products directly.
    const probe = await anonRest(
      `/products?select=id,gallery,documents,purchase_url&id=eq.${s.active}`,
    );
    expect(probe.status === 200 ? probe.json : []).toEqual([]);
  });

  test("the embed payload tells the widget where a tile goes", async ({ page }) => {
    const s = await seed(page, "pdp-embed");
    await serviceRest(`/storefronts?id=eq.${s.storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          theme: THEME,
          blocks: [{ type: "product", productId: s.active, x: 0, y: 0, w: 2, h: 2 }],
          embed: { enabled: true, domains: ["allowed.example"] },
        },
      },
    });
    const rows = (await serviceRest(
      `/storefronts?id=eq.${s.storefrontId}&select=embed_key`,
    )) as { embed_key: string }[];
    const response = await page.request.get(`/api/embed/${rows[0]!.embed_key}`, {
      headers: { origin: "https://allowed.example" },
    });
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as {
      blocks: { type: string; productId?: string; productUrl?: string }[];
    };
    const block = payload.blocks.find((b) => b.type === "product");
    expect(block?.productUrl).toContain(pagePath(s, s.active));
    // Still no product facts in the storefront payload: the page is the read.
    expect(JSON.stringify(payload)).not.toContain("Oak lamp");
  });

  test("a tile's node opens its page on the canvas, connected to the tile", async ({ page }) => {
    const s = await seed(page, "pdp-editor");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();

    // Click the product: that is what brings its node within reach.
    await page.getByRole("button", { name: /edit oak lamp/i }).click();
    await canvasStill(page);
    const node = page.getByRole("button", { name: /^open the product page for oak lamp$/i });
    await expect(node).toBeVisible();
    await node.click();

    // The page arrives beside the board, joined to the tile by a line.
    const artboard = page.locator(`[data-artboard-id="${s.active}"]`);
    await expect(artboard).toBeVisible();
    await expect(artboard.getByRole("heading", { level: 1 })).toHaveText("Oak lamp");
    await expect(page.locator("[data-page-connectors]")).toHaveCount(1);
    // The board did not go anywhere: a page is another thing on the same
    // canvas, not a mode the editor switches into.
    await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();
    // The design panel came with it, on the page's own settings.
    await expect(page.getByRole("switch", { name: "Show a product page" })).toBeVisible();

    // The arrangement is fixed: no layout or gallery choice is offered, and
    // the page has one shape whatever the seller does.
    const root = artboard.locator("[data-product-page]");
    await expect(root).toBeVisible();
    await expect(page.getByRole("button", { name: "Photos right" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "One after another" })).toHaveCount(0);

    // A change that IS offered shows on the artboard at once, and undoes.
    await page.getByRole("button", { name: "Fill", exact: true }).click();
    await expect(artboard.locator("[data-product-gallery] figure img").first()).toHaveClass(
      /object-cover/,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(artboard.locator("[data-product-gallery] figure img").first()).toHaveClass(
      /object-contain/,
    );

    // The Buy button section is collapsed until opened, and offers no fill to
    // choose: the theme accent is the seller's brand colour already.
    await page.getByRole("button", { name: /^buy button$/i }).click();
    await expect(page.getByRole("group", { name: "Button style" })).toHaveCount(0);

    // The description reads under the title and nowhere else, and its switch
    // is what hides it.
    await expect(artboard.locator("[data-product-description]")).toBeVisible();
    await expect(artboard.locator("[data-product-section='description']")).toHaveCount(0);
    await page.getByRole("button", { name: /^sections$/i }).click();
    await page.getByRole("switch", { name: "Description" }).click();
    await expect(artboard.locator("[data-product-description]")).toHaveCount(0);
    await page.getByRole("switch", { name: "Description" }).click();
    await expect(artboard.locator("[data-product-description]")).toBeVisible();

    // Save, reload, and the toolbar's own node brings the page back as saved.
    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);
    await page.reload();
    await page.getByRole("button", { name: /^show the product page$/i }).click();
    // The saved change (the description switched off, then back on) survived.
    await expect(
      page.locator(`[data-artboard-id="${s.active}"] [data-product-description]`),
    ).toBeVisible();

    // And the artboard's own control puts it away again.
    await page
      .getByRole("button", { name: /^close the product page for oak lamp$/i })
      .first()
      .click();
    await expect(page.locator(`[data-artboard-id="${s.active}"]`)).toHaveCount(0);
    await canvasStill(page);

    // The buyer sees the saved design.
    await page.context().clearCookies();
    await page.goto(pagePath(s, s.active));
    await expect(page.locator("[data-product-description]")).toBeVisible();
  });

  test("a shipping profile is written once in the designer and used by name", async ({ page }) => {
    const s = await seed(page, "pdp-profiles");
    await gotoApp(page, `/storefront/${s.storefrontId}`);

    // Open the page's settings the way a seller does: the tile's node.
    await page.getByRole("button", { name: /edit oak lamp/i }).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
    await page.getByRole("button", { name: /^shipping and returns$/i }).click();

    // The store's default terms and its dispatch line, both already written.
    await expect(page.getByLabel("Dispatch time").first()).toHaveValue("Ships within 24 hours");

    // A second profile, added here rather than on any product.
    await page.getByRole("button", { name: /^add a profile$/i }).click();
    const added = page.locator("[data-shipping-profile]").last();
    await added.getByLabel("Name", { exact: true }).fill("Fragile glass");
    await added.getByLabel("Dispatch time").fill("Packed by hand, 2-4 days");
    await added.getByLabel("Shipping", { exact: true }).fill("Double-boxed and signed for.");

    await page.getByRole("button", { name: /^save$/i }).click();
    await expectToast(page, /storefront saved/i, 15_000);

    // It is stored on the storefront, once, with an id a product can name.
    const [row] = (await serviceRest(
      `/storefronts?id=eq.${s.storefrontId}&select=config`,
    )) as { config: { shippingProfiles?: { id: string; name: string }[] } }[];
    const profiles = row!.config.shippingProfiles ?? [];
    expect(profiles.map((profile) => profile.name).sort()).toEqual([
      "Bulky items",
      "Fragile glass",
    ]);
    const fragile = profiles.find((profile) => profile.name === "Fragile glass")!;

    // And the product form offers it by name, without a word being retyped.
    await gotoApp(page, `/products/${s.plain}/edit`);
    const section = page.locator("[data-product-section='shipping']");
    await section.getByRole("combobox").click();
    await page.getByRole("option", { name: /Fragile glass/ }).click();
    await expect(section.getByText("Double-boxed and signed for.")).toBeVisible();
    await expect(page.locator("[data-product-field='shippingProfile']")).toHaveAttribute(
      "data-product-value",
      fragile.id,
    );
  });

  test("gives the page its own face, or follows the storefront's", async ({ page }) => {
    const s = await seed(page, "pdp-font");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByRole("button", { name: /edit oak lamp/i }).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
    const root = page.locator(`[data-artboard-id="${s.active}"] [data-product-page]`);
    await expect(root).toBeVisible();

    // The default names what following the storefront currently gets you, and
    // there is no surface left to choose: the page sits on the storefront's
    // own background, full stop.
    await expect(page.getByRole("combobox", { name: "Font" })).toHaveText(
      "Same as storefront (Sans)",
    );
    await expect(page.getByText("Surface")).toHaveCount(0);
    await expect(root).toHaveClass(/font-sans/);

    // Its own face, applied to the whole page at once.
    await page.getByRole("combobox", { name: "Font" }).click();
    await page.getByRole("option", { name: "Handwritten" }).click();
    await expect(root).toHaveClass(/font-hand/);

    // And a buyer gets it too.
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await page.context().clearCookies();
    await page.goto(pagePath(s, s.active));
    await expect(page.locator("[data-product-page]")).toHaveClass(/font-hand/);
  });

  test("clicking a part of the page opens the setting behind it", async ({ page }) => {
    const s = await seed(page, "pdp-hotspot");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await page.getByRole("button", { name: /edit oak lamp/i }).click();
    await canvasStill(page);
    await page.getByRole("button", { name: /^open the product page for oak lamp$/i }).click();
    const artboard = page.locator(`[data-artboard-id="${s.active}"]`);
    await expect(artboard).toBeVisible();

    // The buy button: the panel arrives on the section that owns its wording.
    await artboard.locator("[data-product-cta]").first().click();
    await expect(page.getByLabel("Button text")).toBeVisible();

    // The price: same section, because the notes printed with it are set
    // beside the button's own label.
    await artboard.locator("[data-product-price]").first().click();
    await expect(page.getByLabel("Button text")).toBeVisible();

    // A section in the fold below leads to the panel holding its words, not
    // to the list that merely toggles it.
    await artboard.locator("[data-product-section='returns'] summary").click();
    await expect(page.getByLabel("Returns")).toBeVisible();

    // The title block leads to Sections, which is where "Sold by" and the
    // description are switched on and off.
    await artboard.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("switch", { name: "Description" })).toBeVisible();

    // The store's name bar is a STOREFRONT setting, so the click leaves the
    // Product page group entirely rather than opening a section that could
    // not change what was clicked.
    await artboard.locator("[data-product-page-header]").click();
    await expect(page.getByRole("switch", { name: "Show header" })).toBeVisible();

    // The option picker is the PRODUCT's, not the page's: clicking one
    // still just picks a version, and moves the panel nowhere. Park the panel
    // on the buy button first, so "nowhere" is something we can see.
    await artboard.locator("[data-product-cta]").first().click();
    await expect(page.getByLabel("Button text")).toBeVisible();
    await artboard.getByRole("radio", { name: "Blue" }).click();
    await expect(artboard.getByRole("radio", { name: "Blue" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("Button text")).toBeVisible();
  });
});
