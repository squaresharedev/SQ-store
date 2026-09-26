import { expect, test, type Page } from "@playwright/test";
import {
  clearAuthRateLimits,
  freshUser,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A TAKEDOWN, FROM THE SELLER'S SIDE: what to fix, the record, the appeal.
 *
 * Staff decide in the admin panel, a different app; what it writes is the
 * contract, so this spec makes that exact write (the decision row, then the
 * content row pointing at it, as Admin actions.ts takeDownContent does) and
 * drives everything SQ-store owns after it:
 *
 *   - a pause really hides the product everywhere, not just in the dashboard;
 *   - the edit page lights up the parts staff named, and one save leads
 *     straight into "send it back for review";
 *   - the statement of reasons downloads as a PDF, for this store only;
 *   - an appeal goes from the banner into the table staff read, and their
 *     answer comes back to the banner;
 *   - a buyer can report the product, the storefront or the seller, and the
 *     wider two only appear when they differ from the product;
 *   - a paused storefront says what to change in its editor too.
 *
 * The admin panel's own screens are driven by 72-admin-moderation.cross-app.
 */

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

/** The one site the storefront may embed on (the endpoint denies anything
 *  else, and a request without an Origin). */
const EMBED_HOST = "shop.example.com";

type Seeded = {
  sellerId: string;
  storefrontId: string;
  embedKey: string;
  productId: string;
  productIds: string[];
};

async function seed(
  page: Page,
  tag: string,
  options: { products?: number; storefronts?: number } = {},
): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  const storefrontCount = options.storefronts ?? 1;
  await seedStorefronts(
    sellerId,
    Array.from({ length: storefrontCount }, (_, i) => ({ name: `Fix studio ${i + 1}` })),
  );
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id,embed_key,name&order=name.asc`,
  )) as { id: string; embed_key: string }[];

  const productCount = options.products ?? 1;
  await seedProducts(
    sellerId,
    Array.from({ length: productCount }, (_, i) => ({
      title: i === 0 ? "Brass lamp" : `Shelf ${i}`,
      price_cents: 9900,
      description: "A lamp.",
      image_key: `https://images.example/fix-${i}.jpg`,
      purchase_url: "https://pay.example/lamp",
    })),
  );
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title&order=title.asc`,
  )) as { id: string; title: string }[];
  const productIds = [
    products.find((p) => p.title === "Brass lamp")!.id,
    ...products.filter((p) => p.title !== "Brass lamp").map((p) => p.id),
  ];
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);

  const storefront = storefronts[0]!;
  await serviceRest(`/storefronts?id=eq.${storefront.id}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        embed: { enabled: true, domains: [EMBED_HOST] },
        blocks: productIds.map((productId, i) => ({
          type: "product",
          productId,
          x: (i * 2) % 6,
          y: Math.floor((i * 2) / 6) * 2,
          w: 2,
          h: 2,
        })),
      },
    },
  });

  return {
    sellerId,
    storefrontId: storefront.id,
    embedKey: storefront.embed_key,
    productId: productIds[0]!,
    productIds,
  };
}

/** The admin panel's takedown write: the decision, then the content row. */
async function decide(
  target: { type: "product" | "storefront"; id: string; ownerId: string; title: string },
  action: "paused" | "removed",
  fields: string[],
  note = "Remove the brand logo from the main photo.",
): Promise<string> {
  const [decision] = (await serviceRest(`/moderation_decisions`, {
    method: "POST",
    body: {
      target_type: target.type,
      target_id: target.id,
      owner_id: target.ownerId,
      target_title: target.title,
      action,
      ground: "counterfeit",
      note,
      fields,
      report_count: 2,
      report_reasons: ["counterfeit", "scam"],
    },
  })) as { id: string }[];
  await serviceRest(`/${target.type === "product" ? "products" : "storefronts"}?id=eq.${target.id}`, {
    method: "PATCH",
    body: {
      moderation_status: action,
      moderation_ground: "counterfeit",
      moderation_note: note,
      moderated_at: new Date().toISOString(),
      moderation_review_requested_at: null,
      moderation_fields: fields.length > 0 ? fields : null,
      moderation_decision_id: decision!.id,
    },
  });
  return decision!.id;
}

function fetchEmbed(page: Page, embedKey: string) {
  return page.request.get(`/api/embed/${embedKey}`, {
    headers: { origin: `https://${EMBED_HOST}` },
  });
}

test.describe("a paused product", () => {
  test("is really hidden: its page, the embed and the share card all stop serving it", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "fix-hidden", { products: 2 });
    await context.clearCookies();

    const pageBefore = await page.request.get(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    expect(pageBefore.status()).toBe(200);
    const embedBefore = (await (await fetchEmbed(page, seeded.embedKey)).json()) as {
      blocks: { productId?: string }[];
    };
    expect(embedBefore.blocks.map((b) => b.productId)).toContain(seeded.productId);
    const ogBefore = await page.request.get(`/api/og/p/${seeded.productId}`, { maxRedirects: 0 });
    expect(ogBefore.status()).toBe(302);

    await decide(
      { type: "product", id: seeded.productId, ownerId: seeded.sellerId, title: "Brass lamp" },
      "paused",
      ["photos"],
    );

    expect((await page.request.get(`/s/${seeded.storefrontId}/p/${seeded.productId}`)).status()).toBe(404);
    const embedAfter = (await (await fetchEmbed(page, seeded.embedKey)).json()) as {
      blocks: { productId?: string }[];
    };
    expect(embedAfter.blocks.map((b) => b.productId)).not.toContain(seeded.productId);
    // Only that tile: the rest of the storefront still sells.
    expect(embedAfter.blocks.map((b) => b.productId)).toContain(seeded.productIds[1]);
    const ogAfter = await page.request.get(`/api/og/p/${seeded.productId}`, { maxRedirects: 0 });
    expect(ogAfter.status()).toBe(404);
  });

  test("lights up exactly what to change, and one save sends it back for review", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "fix-edit");
    await decide(
      { type: "product", id: seeded.productId, ownerId: seeded.sellerId, title: "Brass lamp" },
      "paused",
      ["title", "photos", "purchaseLink"],
    );

    await page.goto(`/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="paused"]');
    await expect(notice).toBeVisible();

    // WHAT: the parts, in the order the form shows them.
    await expect(notice.locator("[data-fix-field]")).toHaveText(["Title", "Purchase link", "Photos"]);
    await expect(notice.locator("[data-decision-reference]")).toHaveText(/^MD-[0-9A-F]{10}$/);

    // WHERE: those sections, and only those, say so; so does the index.
    const flagged = page.locator("[data-product-section][data-fix-flag]");
    await expect(flagged).toHaveCount(3);
    for (const id of ["basics", "media", "photos"]) {
      await expect(page.locator(`[data-product-section="${id}"]`)).toHaveAttribute(
        "data-fix-flag",
        "needs",
      );
    }
    await expect(page.locator('[data-product-section="basics"] [data-fix-callout]')).toContainText(
      "SquareShare asked you to change Title here.",
    );
    await expect(page.locator('[data-product-section="media"] [data-fix-callout]')).toContainText(
      "Purchase link",
    );
    await expect(page.locator("[data-product-form-nav] [data-fix-flag]")).toHaveCount(3);
    await expect(page.locator('[data-fix-mark="title"]')).toHaveText("Change this");
    await expect(page.locator('[data-fix-mark="purchaseLink"]')).toHaveText("Change this");

    await page.screenshot({ path: testInfo.outputPath("paused-edit-top.png") });

    // One click from the banner to the part.
    await notice.getByRole("button", { name: "Show Photos on this page" }).click();
    await expect(page.locator('[data-product-section="photos"]')).toBeInViewport();
    await expect(page).toHaveURL(/#product-section-photos$/);
    await page.screenshot({ path: testInfo.outputPath("paused-edit-photos.png") });

    // Changing a part says so where it was asked for.
    await page.locator('[data-product-field="title"]').fill("Brass lamp, no logo");
    await expect(page.locator('[data-product-section="basics"]')).toHaveAttribute(
      "data-fix-flag",
      "changed",
    );
    await expect(page.locator('[data-fix-mark="title"]')).toHaveCount(0);
    await expect(page.locator('[data-product-section="media"]')).toHaveAttribute(
      "data-fix-flag",
      "needs",
    );

    // Saving the fix asks the one question left, instead of leaving.
    await page.getByRole("button", { name: "Save changes" }).click();
    const prompt = page.getByRole("dialog", { name: "Saved. Send it back for review?" });
    await expect(prompt).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("paused-save-prompt.png") });
    await prompt.getByRole("button", { name: "Send for review" }).click();

    await page.waitForLoadState("load");
    await expect(page.locator('[data-takedown="paused"] [data-review-requested]')).toContainText(
      /Sent for review on/,
    );
    await expect(page.locator('[data-product-section="basics"]')).toHaveAttribute(
      "data-fix-flag",
      "review",
    );
    const [row] = (await serviceRest(
      `/products?id=eq.${seeded.productId}&select=title,moderation_status,moderation_review_requested_at`,
    )) as { title: string; moderation_status: string; moderation_review_requested_at: string | null }[];
    expect(row).toMatchObject({ title: "Brass lamp, no logo", moderation_status: "paused" });
    expect(row!.moderation_review_requested_at).not.toBeNull();
  });

  test("remembers a fixed part after saving and choosing to keep editing", async ({ page }) => {
    const seeded = await seed(page, "fix-keep");
    await decide(
      { type: "product", id: seeded.productId, ownerId: seeded.sellerId, title: "Brass lamp" },
      "paused",
      ["title", "description"],
    );
    await page.goto(`/products/${seeded.productId}/edit`);
    await page.locator('[data-product-field="title"]').fill("Brass lamp, renamed");
    await page.getByRole("button", { name: "Save changes" }).click();
    const prompt = page.getByRole("dialog", { name: "Saved. Send it back for review?" });
    await prompt.getByRole("button", { name: "Keep editing" }).click();
    await page.waitForLoadState("load");

    // The page reloaded from the database, and still knows the title is done.
    await expect(page.locator('[data-product-field="title"]')).toHaveValue("Brass lamp, renamed");
    await expect(page.locator('[data-fix-mark="title"]')).toHaveCount(0);
    await expect(page.locator('[data-fix-mark="description"]')).toHaveText("Change this");
    await expect(page.locator('[data-product-section="basics"]')).toHaveAttribute(
      "data-fix-flag",
      "needs",
    );
    const [row] = (await serviceRest(
      `/products?id=eq.${seeded.productId}&select=moderation_review_requested_at`,
    )) as { moderation_review_requested_at: string | null }[];
    expect(row!.moderation_review_requested_at).toBeNull();
  });
});

test.describe("the statement of reasons", () => {
  test("downloads as a PDF for the store it is about, and for nobody else", async ({
    page,
    browser,
  }, testInfo) => {
    const seeded = await seed(page, "fix-statement");
    const decisionId = await decide(
      { type: "product", id: seeded.productId, ownerId: seeded.sellerId, title: "Brass lamp" },
      "removed",
      ["photos"],
    );

    await page.goto(`/products/${seeded.productId}/edit`);
    const link = page.getByRole("link", { name: "Download the decision (PDF)" });
    await expect(link).toHaveAttribute("href", `/api/moderation/decisions/${decisionId}/statement`);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^squareshare-md-[0-9a-f]{10}\.pdf$/);
    const saved = testInfo.outputPath("statement.pdf");
    await download.saveAs(saved);

    const response = await page.request.get(`/api/moderation/decisions/${decisionId}/statement`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.body();
    expect(body.subarray(0, 8).toString("latin1")).toBe("%PDF-1.7");
    expect(body.subarray(-6).toString("latin1")).toBe("%%EOF\n");

    // Another seller: not theirs, so it does not exist.
    const otherContext = await browser.newContext({ baseURL: "http://localhost:3100" });
    const other = await otherContext.newPage();
    await signUp(other, freshUser("fix-statement-other"));
    const theirs = await other.request.get(`/api/moderation/decisions/${decisionId}/statement`);
    expect(theirs.status()).toBe(404);
    await otherContext.close();

    // Nobody signed in.
    const anonContext = await browser.newContext({ baseURL: "http://localhost:3100" });
    const anon = await anonContext.request.get(`/api/moderation/decisions/${decisionId}/statement`);
    expect(anon.status()).toBe(401);
    await anonContext.close();
  });
});

test.describe("an appeal", () => {
  test("goes from the banner to the staff queue, and staff's answer comes back", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "fix-appeal");
    const decisionId = await decide(
      { type: "product", id: seeded.productId, ownerId: seeded.sellerId, title: "Brass lamp" },
      "removed",
      [],
    );

    await page.goto(`/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="removed"]');
    await notice.getByRole("button", { name: "Appeal this decision" }).click();
    const dialog = page.getByRole("dialog", { name: "Appeal this decision" });
    const send = dialog.getByRole("button", { name: "Send appeal" });
    await dialog.getByLabel("Why do you think this decision is wrong?").fill("It is ours.");
    await expect(send).toBeDisabled();
    const message = "The logo is our own registered trademark, number 123456 in the EUIPO register.";
    await dialog.getByLabel("Why do you think this decision is wrong?").fill(message);
    await page.screenshot({ path: testInfo.outputPath("appeal-dialog.png") });
    await send.click();

    await expect(notice.locator('[data-appeal-status="open"]')).toContainText(/You appealed on/);
    await expect(notice.getByRole("button", { name: "Appeal this decision" })).toHaveCount(0);

    const appeals = (await serviceRest(
      `/moderation_appeals?decision_id=eq.${decisionId}&select=status,message,owner_id,target_id,target_type`,
    )) as { status: string; message: string; owner_id: string; target_id: string; target_type: string }[];
    expect(appeals).toEqual([
      {
        status: "open",
        message,
        owner_id: seeded.sellerId,
        target_id: seeded.productId,
        target_type: "product",
      },
    ]);

    // It is state, not a toast: a reload still says so.
    await page.reload();
    await expect(page.locator('[data-appeal-status="open"]')).toBeVisible();

    // Staff turn it down (the admin panel's decideAppeal write).
    await serviceRest(`/moderation_appeals?decision_id=eq.${decisionId}`, {
      method: "PATCH",
      body: {
        status: "upheld",
        decided_at: new Date().toISOString(),
        decision_note: "The logo on the box is a different mark.",
      },
    });
    await page.reload();
    const answered = page.locator('[data-appeal-status="upheld"]');
    await expect(answered).toContainText(/We reviewed your appeal on .*\. The decision stands\./);
    await expect(answered).toContainText("Our answer: The logo on the box is a different mark.");
    await page.screenshot({ path: testInfo.outputPath("appeal-answered.png") });

    // The statement now records the appeal too.
    const pdf = await page.request.get(`/api/moderation/decisions/${decisionId}/statement`);
    expect(pdf.status()).toBe(200);
  });
});

test.describe("reporting from a product page", () => {
  test("offers only the product when the seller sells one thing from one storefront", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "scope-one");
    await context.clearCookies();
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await page.getByRole("button", { name: "Report this product" }).click();
    const dialog = page.getByRole("dialog", { name: "Report this product" });
    await expect(dialog.locator("[data-report-scopes]")).toHaveCount(0);
  });

  test("lets a buyer report the storefront or the seller, filed against the right thing", async ({
    page,
    context,
  }, testInfo) => {
    const seeded = await seed(page, "scope-all", { products: 2, storefronts: 2 });
    await context.clearCookies();
    await clearAuthRateLimits();

    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await page.getByRole("button", { name: "Report a problem" }).click();
    const dialog = page.getByRole("dialog");
    const scopes = dialog.locator("[data-report-scopes]");
    await expect(scopes.locator("[data-report-scope]")).toHaveCount(3);
    await expect(scopes.getByRole("radio", { name: /This product/ })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("report-scopes.png") });

    await scopes.getByRole("radio", { name: /This seller/ }).check();
    await expect(dialog.getByRole("heading", { name: "Report this seller" })).toBeVisible();
    await dialog.getByRole("radio", { name: /Scam or fraud/ }).check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(
      dialog.getByText(
        "Thanks. A person will review this seller. We do not share who reported something with them.",
      ),
    ).toBeVisible();

    // Filed against the ACCOUNT behind the storefront, which the page never
    // had to know.
    const sellerReports = (await serviceRest(
      `/reports?target_id=eq.${seeded.sellerId}&select=target_type,reason`,
    )) as { target_type: string; reason: string }[];
    expect(sellerReports).toEqual([{ target_type: "profile", reason: "scam" }]);

    await dialog.getByRole("button", { name: "Close" }).last().click();
    await page.getByRole("button", { name: "Report a problem" }).click();
    await dialog.locator("[data-report-scopes]").getByRole("radio", { name: /This storefront/ }).check();
    await dialog.getByRole("radio", { name: /Spam/ }).check();
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByText(/A person will review this storefront/)).toBeVisible();
    const storefrontReports = (await serviceRest(
      `/reports?target_id=eq.${seeded.storefrontId}&select=target_type,reason`,
    )) as { target_type: string; reason: string }[];
    expect(storefrontReports).toEqual([{ target_type: "storefront", reason: "spam" }]);
  });
});

test.describe("a paused storefront", () => {
  test("says what to change on the list and inside its editor", async ({ page }, testInfo) => {
    const seeded = await seed(page, "fix-storefront");
    await decide(
      { type: "storefront", id: seeded.storefrontId, ownerId: seeded.sellerId, title: "Fix studio 1" },
      "paused",
      ["images", "text"],
      "Replace the photo in the header with one you took yourself.",
    );

    await page.goto("/storefront");
    const notice = page.locator('[data-removal-notice="storefront"]');
    await expect(notice.locator("[data-fix-field]")).toHaveText(["Text", "Images"]);
    await expect(notice.getByRole("link", { name: "Download the decision (PDF)" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("storefront-list.png") });

    await notice.getByRole("link", { name: "Open the storefront to change it" }).click();
    await page.waitForURL(new RegExp(`/storefront/${seeded.storefrontId}$`));
    const strip = page.locator('[data-takedown-strip="paused"]');
    await expect(strip).toContainText("This storefront is paused until you change it");
    await expect(strip.locator("[data-fix-field]")).toHaveText(["Text", "Images"]);
    await page.screenshot({ path: testInfo.outputPath("storefront-editor.png") });

    await strip.getByRole("link", { name: "Why, and what to do next" }).click();
    await page.waitForURL(/\/storefront#moderation-notice-/);
    await expect(page.locator('[data-removal-notice="storefront"]')).toBeVisible();
  });
});
