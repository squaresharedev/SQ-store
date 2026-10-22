import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { ANON_KEY, GATEWAY_URL, signJwt } from "./stack/keys.mjs";

/**
 * PRODUCT BADGES, START TO FINISH.
 *
 * A seller adds short highlights to a product ("Loved by 1,000+ people",
 * "Eco friendly", their own words), and a buyer sees them under the title.
 * Through the real app and the real database, with the development stand-in
 * answering for the classifier (lib/moderation/auto/test-provider.ts: clean
 * unless the words carry [[violation]] or [[unsure]]):
 *
 *   - one-click and searched presets, the seller's own words, icon, order,
 *     edits, and the number in a preset selected for typing over;
 *   - a written badge that breaks the rules is never added;
 *   - a save carrying one is refused with the badge named, and a LIVE
 *     product stays live and unchanged;
 *   - a badge written around the app (straight to PostgREST) hides the
 *     product until the sweep settles it, and the seller is pointed at it;
 *   - limits, duplicates, a phone screen, another language, and axe.
 */

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 8,
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

const CRON_SECRET = "e2e-cron-secret-not-a-real-one-0123456789";

type Seeded = { sellerId: string; email: string; storefrontId: string; productId: string };
type Badge = { icon: string; label: string; color?: string; placement?: string };

/** A seller with one live product on one live storefront (service role, so
 *  the fixture starts approved), optionally already carrying badges. */
async function seed(page: Page, tag: string, badges: Badge[] = []): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedStorefronts(sellerId, [{ name: "Badge studio" }]);
  const storefronts = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await seedProducts(sellerId, [
    { title: "Oak bench", price_cents: 34900, description: "Seats four." },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  const storefrontId = storefronts[0]!.id;
  const productId = products[0]!.id;
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        embed: { enabled: false, domains: [] },
        blocks: [{ type: "product", productId, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });
  await serviceRest(`/products?id=eq.${productId}`, {
    method: "PATCH",
    body: { details: { materials: "Solid oak", ...(badges.length ? { badges } : {}) } },
  });
  return { sellerId, email: user.email, storefrontId, productId };
}

async function stored(productId: string) {
  const rows = (await serviceRest(
    `/products?id=eq.${productId}&select=details,moderation_status,moderation_fields`,
  )) as {
    details: { badges?: Badge[]; materials?: string };
    moderation_status: string;
    moderation_fields: string[] | null;
  }[];
  return rows[0]!;
}

const productPath = (seeded: Seeded) => `/s/${seeded.storefrontId}/p/${seeded.productId}`;

async function publicStatus(page: Page, seeded: Seeded) {
  return (await page.request.get(productPath(seeded))).status();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/products$/, { timeout: 90_000 });
}

const badgesSection = (page: Page) => page.locator('[data-product-section="badges"]');
const searchButton = (page: Page) => page.getByRole("button", { name: "Search or write your own" });
const search = (page: Page) => page.getByRole("combobox", { name: "Search badges" });

async function openEdit(page: Page, seeded: Seeded) {
  await gotoApp(page, `/products/${seeded.productId}/edit`);
  await badgesSection(page).scrollIntoViewIfNeeded();
}

test.describe("product badges", () => {
  // The first spec after the stack boots compiles every route it walks.
  test.describe.configure({ timeout: 180_000 });

  test("a seller adds, writes, arranges and saves badges, and a buyer sees them", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "badges-journey");
    await openEdit(page, seeded);
    const section = badgesSection(page);
    await expect(section).toHaveAttribute("data-product-section-state", "empty");

    // One click, with the number ready to be typed over.
    await section.getByRole("button", { name: "Loved by 1,000+ people" }).click();
    const first = page.getByLabel("Words for badge 1");
    await expect(first).toBeFocused();
    await page.keyboard.type("250");
    await expect(first).toHaveValue("Loved by 250+ people");
    // Used, so not offered again even with the seller's own number in it.
    await expect(section.getByRole("button", { name: "Loved by 1,000+ people" })).toHaveCount(0);

    // Searched: a preset that answers the words is what Enter takes.
    await searchButton(page).click();
    await search(page).fill("planet");
    await expect(page.getByRole("option", { name: "Eco friendly" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("badge-search.png") });
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Words for badge 2")).toHaveValue("Eco friendly");

    // Their own words: checked, then added, leading with a fitting icon.
    await searchButton(page).click();
    await search(page).fill("Handmade in Lisbon");
    await expect(page.getByRole("option", { name: "Add “Handmade in Lisbon”" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Words for badge 3")).toHaveValue("Handmade in Lisbon");
    await expect(section.locator('[data-product-field="badge.2.icon"]')).toHaveAttribute(
      "data-product-value",
      "hand-heart",
    );

    // A different icon, and first in line.
    await page.getByRole("button", { name: "Icon and colour for badge 3" }).click();
    const grid = page.getByRole("group", { name: "Choose an icon" });
    // Six to a row, none on top of another.
    const cells = await grid.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y) };
      }),
    );
    expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length);
    expect(new Set(cells.map((cell) => cell.x)).size).toBe(6);
    await page.screenshot({ path: testInfo.outputPath("icon-grid.png") });
    await page.getByRole("button", { name: "Map pin" }).click();
    await page.getByLabel("Words for badge 3").hover();
    await page.getByRole("button", { name: "Move badge 3 earlier" }).click();
    await page.getByRole("button", { name: "Move badge 2 earlier" }).click();
    await expect(section.locator("[data-product-section-summary]")).toHaveText("3 badges");
    await section.screenshot({ path: testInfo.outputPath("badges-section.png") });

    await save(page);

    const row = await stored(seeded.productId);
    expect(row.details.badges).toEqual([
      { icon: "map-pin", label: "Handmade in Lisbon", color: "pink" },
      { icon: "heart", label: "Loved by 250+ people", color: "red" },
      { icon: "leaf", label: "Eco friendly", color: "green" },
    ]);
    expect(row.details.materials).toBe("Solid oak");
    // A clean edit to a live product never hides it.
    expect(row.moderation_status).toBe("ok");

    // The buyer's page, in the seller's order, under the title.
    await page.goto(productPath(seeded));
    const list = page.getByRole("list", { name: "Highlights", exact: true });
    await expect(list.getByRole("listitem")).toHaveText([
      "Handmade in Lisbon",
      "Loved by 250+ people",
      "Eco friendly",
    ]);
    await expect(list.locator("[data-product-badge]").first()).toHaveAttribute("data-product-badge", "map-pin");
    await expect(list.locator("svg")).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("buyer-page.png") });

    // Opening the form again is not a change.
    await openEdit(page, seeded);
    await expect(page.locator("[data-product-form]")).toHaveAttribute("data-product-form-dirty", "0");
    await expect(page.getByLabel("Words for badge 2")).toHaveValue("Loved by 250+ people");
  });

  test("a badge the seller writes that breaks the rules is never added", async ({ page }) => {
    const seeded = await seed(page, "badges-refused");
    await openEdit(page, seeded);

    await searchButton(page).click();
    await search(page).fill("Totally legit [[violation]]");
    await page.keyboard.press("Enter");
    await expect(page.getByText("The badge “Totally legit [[violation]]” breaks the platform rules, so it can't be used.")).toBeVisible();
    await expect(page.locator("[data-product-badge-label]")).toHaveCount(0);

    // Doubt is not a pass either, and it says so in its own words.
    await search(page).fill("Clinically proven [[unsure]]");
    await expect(page.getByText(/breaks the platform rules/)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/“Clinically proven \[\[unsure\]\]” could not be approved automatically/)).toBeVisible();
    await expect(page.locator("[data-product-badge-label]")).toHaveCount(0);

    // Escape: nothing added, nothing changed.
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveCount(0);
    await expect(page.locator("[data-product-form]")).toHaveAttribute("data-product-form-dirty", "0");
    expect((await stored(seeded.productId)).details.badges).toBeUndefined();
  });

  test("a save carrying a bad badge is refused, and the live product stays exactly as it was", async ({
    page,
  }) => {
    const seeded = await seed(page, "badges-save", [{ icon: "leaf", label: "Eco friendly" }]);
    expect(await publicStatus(page, seeded)).toBe(200);
    await openEdit(page, seeded);

    // Edited in place: no add step, so the save is where it is caught.
    const words = page.getByLabel("Words for badge 1");
    await words.fill("Best [[violation]] in town");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("The badge “Best [[violation]] in town” breaks the platform rules, so it can't be used.").first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`/products/${seeded.productId}/edit$`));
    // The seller is put on the badge itself: the section says so, and its
    // words are selected for changing.
    await expect(badgesSection(page)).toHaveAttribute("data-product-section-state", "invalid");
    await expect(words).toBeFocused();
    expect(
      await words.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!),
    ).toBe("Best [[violation]] in town".length);

    const row = await stored(seeded.productId);
    expect(row.details.badges).toEqual([{ icon: "leaf", label: "Eco friendly" }]);
    expect(row.moderation_status).toBe("ok");
    expect(await publicStatus(page, seeded)).toBe(200);

    // The seller changes the words (closing the toast that sat over the
    // button, as anyone would), and the save goes through.
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await words.fill("Climate neutral");
    await save(page);
    expect((await stored(seeded.productId)).details.badges).toEqual([
      { icon: "leaf", label: "Climate neutral" },
    ]);
  });

  test("a badge written around the app hides the product until the sweep pauses it, and points at it", async ({
    page,
  }) => {
    const seeded = await seed(page, "badges-rest");
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: seeded.sellerId,
      email: seeded.email,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 3600,
    });

    // Straight to PostgREST with the seller's own session: no form, no badge
    // check, not even the schema (an icon nobody draws).
    const direct = await fetch(`${GATEWAY_URL}/rest/v1/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        details: {
          materials: "Solid oak",
          badges: [
            { icon: "skull", label: "No icon like it" },
            { icon: "star", label: "Cheap [[violation]] here" },
          ],
        },
      }),
    });
    expect(direct.status).toBe(204);
    expect((await stored(seeded.productId)).moderation_status).toBe("pending");
    expect(await publicStatus(page, seeded)).toBe(404);

    let outcome = "pending";
    for (let run = 0; run < 12 && outcome === "pending"; run += 1) {
      const sweep = await page.request.post("/api/cron/moderation", {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(sweep.status()).toBe(200);
      outcome = (await stored(seeded.productId)).moderation_status;
    }
    expect(outcome).toBe("paused");
    expect((await stored(seeded.productId)).moderation_fields).toEqual(["specs"]);
    expect(await publicStatus(page, seeded)).toBe(404);

    // The edit page lights the Badges section, and reads the badge it can
    // draw while leaving out the one it cannot.
    await openEdit(page, seeded);
    await expect(badgesSection(page)).toHaveAttribute("data-fix-flag", "needs");
    await expect(badgesSection(page).locator("[data-fix-callout]")).toContainText("Badges and specifications");
    await expect(page.locator("[data-product-badge-label]")).toHaveCount(1);
    await expect(page.getByLabel("Words for badge 1")).toHaveValue("Cheap [[violation]] here");

    // Removing it is the fix, checked again with no person involved.
    await page.getByLabel("Words for badge 1").hover();
    await page.getByRole("button", { name: "Remove badge 1" }).click();
    await expect(badgesSection(page)).toHaveAttribute("data-fix-flag", "changed");
    await save(page);
    const fixed = await stored(seeded.productId);
    expect(fixed.moderation_status).toBe("ok");
    expect(fixed.details.badges).toBeUndefined();
    expect(await publicStatus(page, seeded)).toBe(200);
  });

  test("limits: six at most, the same words once, and the form says why", async ({ page }) => {
    const six = ["One", "Two", "Three", "Four", "Five", "Six"].map((label) => ({ icon: "star", label }));
    const seeded = await seed(page, "badges-limits", six);
    await openEdit(page, seeded);
    const section = badgesSection(page);
    await expect(section.locator("[data-product-badges-full]")).toHaveText(
      "That's 6 badges, the most one product can show. Remove one to add another.",
    );
    await expect(searchButton(page)).toHaveCount(0);

    await page.getByLabel("Words for badge 6").hover();
    await page.getByRole("button", { name: "Remove badge 6" }).click();
    await expect(searchButton(page)).toBeVisible();

    // The same words as another badge: not offered, and refused on save.
    await searchButton(page).click();
    await search(page).fill("one");
    await expect(page.getByText("This product already has that badge.")).toBeVisible();
    await expect(page.getByRole("option", { name: /^Add “/ })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByLabel("Words for badge 5").fill("ONE");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(section.getByRole("alert")).toHaveText(
      "Two badges say the same thing. Change the words of one, or remove it.",
    );
    await expect(page.getByLabel("Words for badge 5")).toBeFocused();
    expect((await stored(seeded.productId)).details.badges).toHaveLength(6);
  });

  test("on a phone: the search is a sheet, and the buyer's badges stay on the screen", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const seeded = await seed(page, "badges-phone", [
      { icon: "award", label: "Ausgezeichnet mit dem Bundespreis Handwerk" },
    ]);
    await openEdit(page, seeded);

    // Row controls cannot wait for a hover a finger never makes.
    await expect(page.getByRole("button", { name: "Remove badge 1" })).toHaveCSS("opacity", "1");

    await searchButton(page).click();
    const sheet = page.getByRole("dialog", { name: "Add a badge" });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(370);
    await search(page).fill("free ship");
    await page.getByRole("option", { name: "Free shipping" }).click();
    await expect(page.getByLabel("Words for badge 2")).toHaveValue("Free shipping");
    await page.screenshot({ path: testInfo.outputPath("phone-form.png") });
    await save(page);

    await page.goto(productPath(seeded));
    const list = page.getByRole("list", { name: "Highlights", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const item of await list.getByRole("listitem").all()) {
      const rect = (await item.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(375);
    }
    await page.screenshot({ path: testInfo.outputPath("phone-buyer.png") });
    await context.close();
  });

  test("the ready-made badges speak the seller's language", async ({ page }) => {
    const seeded = await seed(page, "badges-german");
    await page.context().addCookies([{ name: "ss_locale", value: "de", url: "http://localhost:3100" }]);
    await openEdit(page, seeded);
    await page.locator('[data-badge-suggestion="handmade"]').click();
    const german = await page.locator("[data-product-badge-label]").first().inputValue();
    expect(german).not.toBe("Handmade");
    await page.locator('[data-badge-suggestion="lovedBy"]').click();
    // German groups thousands with a point, and that is what is selected.
    const selected = await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement;
      return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    });
    expect(selected).toBe("1.000");
  });

  test("no serious axe violations in the section or the open search", async ({ page }) => {
    const seeded = await seed(page, "badges-axe", [{ icon: "leaf", label: "Eco friendly" }]);
    await openEdit(page, seeded);
    await searchButton(page).click();
    await search(page).fill("hand");
    // Let the popover's entrance settle: axe mid-fade invents contrast failures.
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page }).include('[data-product-section="badges"]').analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  test("no serious axe violations with the colour and placement pickers open", async ({ page }) => {
    const seeded = await seed(page, "badges-axe-style", [
      { icon: "leaf", label: "Eco friendly", color: "green", placement: "photo-top-left" },
      { icon: "star", label: "Top rated" },
    ]);
    await openEdit(page, seeded);
    const scan = async () => {
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).include('[data-product-section="badges"]').analyze();
      return results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => `${violation.id}: ${violation.help}`);
    };
    await page.getByRole("button", { name: "Icon and colour for badge 1" }).click();
    expect(await scan()).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Where badge 2 goes" }).click();
    expect(await scan()).toEqual([]);
  });

  test("badges are coloured, dragged onto the photo, kept off a full one, and a live product stays live", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "badges-photo");
    expect(await publicStatus(page, seeded)).toBe(200);
    await openEdit(page, seeded);
    const section = badgesSection(page);

    // Ready-made badges arrive in their own colours.
    for (const name of ["Loved by 1,000+ people", "Eco friendly", "Free shipping", "Handmade"]) {
      await section.getByRole("button", { name }).click();
    }
    const field = (index: number, what: "color" | "placement") =>
      section.locator(`[data-product-field="badge.${index}.${what}"]`);
    await expect(field(0, "color")).toHaveAttribute("data-product-value", "red");
    await expect(field(1, "color")).toHaveAttribute("data-product-value", "green");
    await expect(field(2, "color")).toHaveAttribute("data-product-value", "blue");

    // A different colour for one, chosen in the same panel as its icon.
    await page.getByRole("button", { name: "Icon and colour for badge 3" }).click();
    await page.getByRole("group", { name: "Choose a colour" }).getByRole("button", { name: "Purple" }).click();
    await page.keyboard.press("Escape");
    await expect(field(2, "color")).toHaveAttribute("data-product-value", "purple");

    // Dragged in the preview: let go in a quarter of the photo, it goes to that corner.
    const preview = page.locator("[data-badge-preview]");
    await preview.scrollIntoViewIfNeeded();
    /** Grab a badge in the preview and let go at a point of the photo, given
     *  as fractions of it (measured afresh: the page scrolls between drags). */
    async function dragTo(label: string, fx: number, fy: number) {
      const pill = preview.locator(`[data-badge-preview-pill="${label}"]`);
      // Instant: the app scrolls smoothly, and a box measured mid-scroll is stale.
      await preview.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      const from = (await pill.boundingBox())!;
      const photo = (await preview.locator('[data-badge-zone="photo"]').boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(photo.x + photo.width * fx, photo.y + photo.height * fy, { steps: 8 });
      await page.mouse.up();
    }
    await dragTo("Loved by 1,000+ people", 0.2, 0.2);
    await expect(field(0, "placement")).toHaveAttribute("data-product-value", "photo-top-left");
    await dragTo("Free shipping", 0.8, 0.85);
    await expect(field(2, "placement")).toHaveAttribute("data-product-value", "photo-bottom-right");
    await expect(preview.locator('[data-badge-preview-corner="photo-bottom-right"]')).toHaveText("Free shipping");
    await page.screenshot({ path: testInfo.outputPath("preview-dragged.png") });

    // The keyboard's way, from the row: the third onto the photo.
    await page.getByRole("button", { name: "Where badge 4 goes" }).click();
    await page.getByRole("button", { name: "On the photo, bottom left" }).click();
    await expect(field(3, "placement")).toHaveAttribute("data-product-value", "photo-bottom-left");

    // The photo is full: a fourth is refused by drag, and by the row.
    await dragTo("Eco friendly", 0.8, 0.2);
    await expect(field(1, "placement")).toHaveAttribute("data-product-value", "beside");
    await expect(page.locator("[data-badge-preview-hint]")).toHaveText(
      "The photo holds up to 3 badges. Move one beside the product first.",
    );
    await page.getByRole("button", { name: "Where badge 2 goes" }).click();
    await expect(page.getByRole("button", { name: "On the photo, top right" })).toBeDisabled();
    await page.keyboard.press("Escape");

    // Moving between corners is still fine on a full photo.
    await dragTo("Free shipping", 0.8, 0.15);
    await expect(field(2, "placement")).toHaveAttribute("data-product-value", "photo-top-right");

    await save(page);
    const row = await stored(seeded.productId);
    expect(row.details.badges).toEqual([
      { icon: "heart", label: "Loved by 1,000+ people", color: "red", placement: "photo-top-left" },
      { icon: "leaf", label: "Eco friendly", color: "green" },
      { icon: "truck", label: "Free shipping", color: "purple", placement: "photo-top-right" },
      { icon: "hand-heart", label: "Handmade", color: "pink", placement: "photo-bottom-left" },
    ]);
    // Colours and places are new text to the wall; the save's own check
    // cleared them before writing, so the live product never went dark.
    expect(row.moderation_status).toBe("ok");
    expect(await publicStatus(page, seeded)).toBe(200);

    // The buyer's page: three on the photo, in their corners; one beside.
    await page.goto(productPath(seeded));
    const frame = (await page.locator('[data-product-gallery] figure, [data-product-gallery="empty"]').first().boundingBox())!;
    const onPhoto = page.getByRole("list", { name: "Highlights on the photo" });
    await expect(onPhoto.getByRole("listitem")).toHaveText([
      "Loved by 1,000+ people",
      "Free shipping",
      "Handmade",
    ]);
    const box = async (label: string) => (await onPhoto.getByRole("listitem").filter({ hasText: label }).boundingBox())!;
    const topLeft = await box("Loved by 1,000+ people");
    const topRight = await box("Free shipping");
    const bottomLeft = await box("Handmade");
    for (const item of [topLeft, topRight, bottomLeft]) {
      expect(item.x).toBeGreaterThanOrEqual(frame.x);
      expect(item.x + item.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      expect(item.y).toBeGreaterThanOrEqual(frame.y);
      expect(item.y + item.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
    }
    expect(topLeft.x - frame.x).toBeLessThan(20);
    expect(topLeft.y - frame.y).toBeLessThan(20);
    expect(frame.x + frame.width - (topRight.x + topRight.width)).toBeLessThan(20);
    expect(frame.y + frame.height - (bottomLeft.y + bottomLeft.height)).toBeLessThan(20);
    // The two top corners do not meet.
    expect(topLeft.x + topLeft.width).toBeLessThan(topRight.x);

    const iconColor = (label: string, list = onPhoto) =>
      list
        .getByRole("listitem")
        .filter({ hasText: label })
        .locator("svg")
        .evaluate((svg) => getComputedStyle(svg).color);
    expect(await iconColor("Loved by 1,000+ people")).toBe("rgb(220, 38, 38)");
    expect(await iconColor("Free shipping")).toBe("rgb(147, 51, 234)");
    const beside = page.getByRole("list", { name: "Highlights", exact: true });
    await expect(beside.getByRole("listitem")).toHaveText(["Eco friendly"]);
    expect(await iconColor("Eco friendly", beside)).toBe("rgb(22, 163, 74)");
    await page.screenshot({ path: testInfo.outputPath("buyer-photo-badges.png") });

    // A dark page: the icon beside the product takes the light shade; the
    // photo's pills stay light with dark words.
    const [{ config }] = (await serviceRest(`/storefronts?id=eq.${seeded.storefrontId}&select=config`)) as {
      config: { productPage: Record<string, unknown> };
    }[];
    await serviceRest(`/storefronts?id=eq.${seeded.storefrontId}`, {
      method: "PATCH",
      body: { config: { ...config, productPage: { ...config.productPage, backgroundColor: "#111111" } } },
    });
    await page.reload();
    expect(await iconColor("Eco friendly", page.getByRole("list", { name: "Highlights", exact: true }))).toBe("rgb(74, 222, 128)");
    expect(
      await onPhoto.getByRole("listitem").first().evaluate((item) => getComputedStyle(item).color),
    ).toBe("rgb(23, 23, 23)");
    await page.screenshot({ path: testInfo.outputPath("buyer-dark-page.png") });

    // A phone: everything on the photo stays inside it, and nothing scrolls sideways.
    await page.setViewportSize({ width: 375, height: 760 });
    await page.reload();
    const phoneFrame = (await page.locator('[data-product-gallery] figure, [data-product-gallery="empty"]').first().boundingBox())!;
    for (const item of await onPhoto.getByRole("listitem").all()) {
      const rect = (await item.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(phoneFrame.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(phoneFrame.x + phoneFrame.width + 0.5);
      expect(rect.y + rect.height).toBeLessThanOrEqual(phoneFrame.y + phoneFrame.height + 0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath("phone-photo-badges.png") });
  });

  test("a badge stored with a colour or place this build does not know still shows, in the defaults", async ({
    page,
  }) => {
    const seeded = await seed(page, "badges-unknown");
    // The service role writes past the schema, like a later build or a hand edit.
    await serviceRest(`/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      body: {
        details: {
          badges: [
            { icon: "star", label: "Mystery colour", color: "ultraviolet" },
            { icon: "star", label: "Mystery place", placement: "photo-centre" },
            ...["A", "B", "C", "D"].map((label) => ({ icon: "star", label, placement: "photo-top-left" })),
          ],
        },
      },
    });
    await page.goto(productPath(seeded));
    await expect(page.getByRole("list", { name: "Highlights", exact: true }).getByRole("listitem")).toHaveText([
      "Mystery colour",
      "Mystery place",
      "D",
    ]);
    await expect(page.getByRole("list", { name: "Highlights on the photo" }).getByRole("listitem")).toHaveText([
      "A",
      "B",
      "C",
    ]);
  });
});
