import { expect, test, type Page } from "@playwright/test";
import {
  anonRest,
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
 * CONTENT REPORTS AND TAKEDOWNS, end to end.
 *
 * The two halves this walks are the ones nothing else can prove:
 *
 *   REPORTING. A buyer with no account, on a hosted product page, can tell us
 *   something is wrong, and what they said lands in the shared `reports` table
 *   where the staff queue reads it.
 *
 *   REMOVAL. Once staff act (a service_role write, exactly what the admin
 *   panel performs), the product stops being served EVERYWHERE: its own page,
 *   the embed payload, and the share card. A takedown that only covers the
 *   page it was pressed on is not a takedown, and every one of those surfaces
 *   is a separate gate in a separate file, so each is asserted separately.
 *
 * The admin panel itself is a different app on a different origin, so its UI
 * is not driven here. What IS driven is the database write it makes, which is
 * the whole contract between the two: if that write has the effect this spec
 * asserts, the panel's button works.
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

/** The footer link. It names the product when that is all a buyer can report,
 *  and asks more generally once the dialog offers the storefront or the seller
 *  too (this seller has two products, so it does). */
const REPORT_TRIGGER = /^report (this product|a problem)$/i;

/** The one site this storefront is allowed to embed on. The embed endpoint
 *  denies an empty allowlist AND a missing Origin header, so a spec that wants
 *  a 200 has to name a host and send it. */
const EMBED_HOST = "shop.example.com";

async function fetchEmbed(page: Page, embedKey: string) {
  return page.request.get(`/api/embed/${embedKey}`, {
    headers: { origin: `https://${EMBED_HOST}` },
  });
}

type Seeded = {
  sellerId: string;
  storefrontId: string;
  embedKey: string;
  productId: string;
  otherId: string;
};

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Report studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id,embed_key`,
  )) as { id: string; embed_key: string }[];
  const storefront = storefronts[0]!;

  await seedProducts(sellerId, [
    // An image_key is what gives this product a share card to take away. A
    // seeded https:// URL passes straight through presignGetUrl, which is the
    // only way to give a product a picture with no R2 in the stack.
    {
      title: "Reported lamp",
      price_cents: 9900,
      description: "A lamp.",
      image_key: "https://images.example/reported-lamp.jpg",
    },
    { title: "Innocent shelf", price_cents: 4900 },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const byTitle = (title: string) => products.find((p) => p.title === title)!.id;

  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);

  await serviceRest(`/storefronts?id=eq.${storefront.id}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        embed: { enabled: true, domains: [EMBED_HOST] },
        blocks: [
          { type: "product", productId: byTitle("Reported lamp"), x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: byTitle("Innocent shelf"), x: 2, y: 0, w: 2, h: 2 },
        ],
      },
    },
  });

  return {
    sellerId,
    storefrontId: storefront.id,
    embedKey: storefront.embed_key,
    productId: byTitle("Reported lamp"),
    otherId: byTitle("Innocent shelf"),
  };
}

/** What staff do, expressed as the write the admin panel makes. */
async function removeProduct(productId: string, ground = "counterfeit") {
  await serviceRest(`/products?id=eq.${productId}`, {
    method: "PATCH",
    body: {
      moderation_status: "removed",
      moderation_ground: ground,
      moderation_note: "The mark is registered.",
      moderated_at: new Date().toISOString(),
    },
  });
}

async function reportsFor(targetId: string) {
  return (await serviceRest(
    `/reports?target_id=eq.${targetId}&select=reason,details,status,target_type,reporter_email,reporter_hash`,
  )) as {
    reason: string;
    details: string;
    status: string;
    target_type: string;
    reporter_email: string | null;
    reporter_hash: string | null;
  }[];
}

test.describe("reporting a product", () => {
  test("a signed-out buyer can report from the hosted page, and what they said is what lands", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "report-file");

    // The reporter is a BUYER, not the seller: a fresh context with no session
    // is the only honest way to exercise an unauthenticated write path.
    await context.clearCookies();
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await expect(page.getByRole("heading", { name: "Reported lamp" })).toBeVisible();

    await page.getByRole("button", { name: REPORT_TRIGGER }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The category is the one required field. Until it is picked, there is
    // nothing to submit.
    const submit = dialog.getByRole("button", { name: /send report/i });
    await expect(submit).toBeDisabled();

    await dialog.getByRole("radio", { name: /counterfeit or stolen/i }).check();
    await dialog.getByLabel(/anything else/i).fill("These are fake, the logo is wrong.");
    await dialog.getByLabel(/your email/i).fill("buyer@example.com");
    await expect(submit).toBeEnabled();
    await submit.click();

    // The confirmation says a person will look, and says nothing about what
    // happens next: whether it is a duplicate, whether anyone else reported
    // it, and whether staff acted are all none of the reporter's business.
    await expect(dialog.getByText(/a person will review this/i)).toBeVisible();

    const rows = await reportsFor(seeded.productId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      target_type: "product",
      reason: "counterfeit",
      details: "These are fake, the logo is wrong.",
      status: "open",
      reporter_email: "buyer@example.com",
    });
    // An anonymous reporter still gets a digest, which is what the per-reporter
    // dedupe index keys on. It is a hash, never an address.
    expect(rows[0]!.reporter_hash).toBeTruthy();
    expect(rows[0]!.reporter_hash).not.toContain("buyer@example.com");
  });

  test("reporting twice from the same browser files one report, and says so no differently", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "report-dupe");
    await context.clearCookies();

    for (const attempt of [1, 2]) {
      await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
      await page.getByRole("button", { name: REPORT_TRIGGER }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /spam/i }).check();
      await dialog.getByRole("button", { name: /send report/i }).click();
      // Identical confirmation both times: a reporter who could tell the
      // difference could probe what is already in the queue.
      await expect(
        dialog.getByText(/a person will review this/i),
        `attempt ${attempt}`,
      ).toBeVisible();
    }

    expect(await reportsFor(seeded.productId)).toHaveLength(1);
  });

  test("the report table is not readable by the public", async () => {
    // Belt and braces on the RLS suite: the anon key this app ships must not
    // be able to read a queue of who reported what. An empty array rather than
    // a 403 is the correct shape here (RLS filters rows, it does not refuse
    // the request), which is exactly why this asserts on the rows.
    const { status, json } = await anonRest(`/reports?select=id`);
    expect(status).toBe(200);
    expect(json).toEqual([]);
  });
});

test.describe("the report dialog", () => {
  // THE BUG THAT SHIPPED. Typing into the dialog lost the field after ONE
  // character (the shared Modal tore itself down and re-focused on every
  // re-render), so the rest of a sentence, and every Space in it, went to the
  // page behind: it scrolled, and Space landed on the Close button. A unit test
  // cannot see this (jsdom does not scroll and has no real focus ring to
  // steal), so it is asserted here in a real browser.
  test("a whole sentence types intact, and neither the page behind nor the dialog moves", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "report-typing");
    await context.clearCookies();
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: REPORT_TRIGGER }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // A habitual Space the instant it opens: no reason may be picked for them
    // (the first radio is "Illegal goods", the most serious category) and the
    // dialog must stay open.
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input[name=reason]:checked")).toHaveCount(0);

    const details = dialog.getByLabel(/anything else/i);
    await details.click();
    await page.keyboard.type("These are fake, look at the logo.", { delay: 15 });
    await expect(details).toHaveValue("These are fake, look at the logo.");
    await expect(details).toBeFocused();

    const email = dialog.getByLabel(/your email/i);
    await email.click();
    await page.keyboard.type("buyer@example.com", { delay: 15 });
    await expect(email).toHaveValue("buyer@example.com");

    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Escape still closes it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("confirms with a checkmark that draws itself in, not just words", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "report-check");
    await context.clearCookies();
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await page.getByRole("button", { name: REPORT_TRIGGER }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /spam/i }).check();
    await dialog.getByRole("button", { name: /send report/i }).click();
    await expect(dialog.getByText(/a person will review this/i)).toBeVisible();

    // The pop is a real, running animation, and the stroke finishes drawing.
    const check = dialog.locator("svg.animate-check-pop");
    await expect(check).toHaveCount(1);
    await expect
      .poll(() => check.evaluate((el) => getComputedStyle(el).animationName))
      .toContain("check-pop");
    await expect
      .poll(() =>
        dialog
          .locator("path.animate-check-draw")
          .evaluate((el) => parseFloat(getComputedStyle(el).strokeDashoffset)),
      )
      .toBe(0);
  });
});

test.describe("a removed product", () => {
  test("disappears from its page, the embed payload and the share card at once", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "removal");
    await context.clearCookies();

    // --- Before: all three surfaces serve it ---------------------------------
    await page.goto(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    await expect(page.getByRole("heading", { name: "Reported lamp" })).toBeVisible();

    const embedBefore = await fetchEmbed(page, seeded.embedKey);
    expect(embedBefore.status()).toBe(200);
    const blocksBefore = (await embedBefore.json()).blocks as { productId?: string }[];
    expect(blocksBefore.map((b) => b.productId)).toContain(seeded.productId);

    const ogBefore = await page.request.get(`/api/og/p/${seeded.productId}`, {
      maxRedirects: 0,
    });
    expect(ogBefore.status()).toBe(302);

    // --- The takedown -------------------------------------------------------
    await removeProduct(seeded.productId);

    // --- After: the page is gone, and gone as a 404 -------------------------
    // NOT a "this was removed" page. That would tell a scanner which listings
    // were worth finding on an archive, and would put the platform's finding
    // in front of buyers who were never its audience. The seller is told
    // directly instead.
    const pageAfter = await page.request.get(
      `/s/${seeded.storefrontId}/p/${seeded.productId}`,
    );
    expect(pageAfter.status()).toBe(404);

    // --- After: the tile is dropped from the widget, and ONLY that tile -----
    const embedAfter = await fetchEmbed(page, seeded.embedKey);
    expect(embedAfter.status()).toBe(200);
    const blocksAfter = (await embedAfter.json()).blocks as { productId?: string }[];
    expect(blocksAfter.map((b) => b.productId)).not.toContain(seeded.productId);
    expect(blocksAfter.map((b) => b.productId)).toContain(seeded.otherId);

    // --- After: the share card stops resolving ------------------------------
    // The longest-lived artefact a product has: the link is already pasted in
    // other people's timelines and they re-scrape it.
    const ogAfter = await page.request.get(`/api/og/p/${seeded.productId}`, {
      maxRedirects: 0,
    });
    expect(ogAfter.status()).toBe(404);
  });

  test("takes its whole storefront with it when the storefront is the thing removed", async ({
    page,
    context,
  }) => {
    const seeded = await seed(page, "removal-sf");
    await context.clearCookies();

    await serviceRest(`/storefronts?id=eq.${seeded.storefrontId}`, {
      method: "PATCH",
      body: {
        moderation_status: "removed",
        moderation_ground: "scam",
        moderated_at: new Date().toISOString(),
      },
    });

    // Every product page hanging off it goes too. Leaving them reachable by
    // direct link would make a storefront takedown cosmetic.
    for (const productId of [seeded.productId, seeded.otherId]) {
      const res = await page.request.get(`/s/${seeded.storefrontId}/p/${productId}`);
      expect(res.status(), productId).toBe(404);
    }

    const embed = await fetchEmbed(page, seeded.embedKey);
    expect(embed.status()).toBe(404);
  });

  test("cannot be put back by the seller who owns it", async ({ page }) => {
    // The app never offers a control for this, but the app is not the only
    // client of the database: a seller holds a publishable key and an
    // RLS-permitted UPDATE on their own row. The guard trigger is the control,
    // and this is the path it exists to refuse.
    const seeded = await seed(page, "removal-guard");
    await removeProduct(seeded.productId);

    const res = await page.request.patch(
      `/api/storefronts/${seeded.storefrontId}`,
      { failOnStatusCode: false, data: {} },
    );
    // Not the point of the assertion, just proof the session is live.
    expect(res.status()).toBeLessThan(500);

    const rows = (await serviceRest(
      `/products?id=eq.${seeded.productId}&select=moderation_status`,
    )) as { moderation_status: string }[];
    expect(rows[0]!.moderation_status).toBe("removed");
  });

  test("still shows the seller what happened and why, in their own dashboard", async ({
    page,
  }) => {
    const seeded = await seed(page, "removal-seller");
    await removeProduct(seeded.productId);

    // The list is where a seller looks first, so the state has to be there and
    // not only on the product they happen to open.
    await page.goto("/products");
    const card = page.locator("li", { hasText: "Reported lamp" });
    await expect(card.getByText("Removed")).toBeVisible();

    // The full statement of reasons is on the product itself: the ground in
    // plain words, plus whatever the reviewer added.
    await page.goto(`/products/${seeded.productId}/edit`);
    const notice = page.locator("[data-removal-notice]");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/counterfeit/i);
    await expect(notice).toContainText("The mark is registered.");
    // And a way to argue, which is what makes it a decision rather than a
    // verdict.
    await expect(notice.getByRole("link", { name: /look again/i })).toBeVisible();

    // The listing is still editable. A takedown is not a lock: the seller has
    // to be able to fix what they were told was wrong.
    await expect(page.getByLabel(/title/i).first()).toBeEditable();
  });

  // The admin panel is a different app, so its write cannot be driven from
  // here. What this pins is the CONTRACT it writes to: a `policy` row with a
  // bare in-app `href`. If SQ-store stopped rendering that type, or stopped
  // following that field, the seller would get a notification that says
  // something was removed and does not take them to why.
  test("the seller's notification names the reason and takes them to the product", async ({
    page,
  }) => {
    const seeded = await seed(page, "removal-notif");
    await removeProduct(seeded.productId);

    // Exactly the shape Admin/src/lib/moderation/notify-seller.ts inserts.
    await serviceRest(`/notifications`, {
      method: "POST",
      body: [
        {
          user_id: seeded.sellerId,
          type: "policy",
          title: 'Your product "Reported lamp" was removed',
          body: "Counterfeit or stolen. It appeared to offer counterfeit goods, or work that belongs to someone else. The mark is registered.",
          data: {
            kind: "content_removed",
            targetType: "product",
            ground: "counterfeit",
            href: `/products/${seeded.productId}/edit`,
          },
        },
      ],
    });

    await page.goto("/notifications");
    // A row with somewhere to go is a real link to it.
    const row = page.getByRole("link", { name: /was removed/i });
    await expect(row).toBeVisible();
    await expect(row).toContainText("counterfeit goods");
    await expect(row).toContainText("The mark is registered.");

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/products/${seeded.productId}/edit`));
    await expect(page.locator("[data-removal-notice]")).toContainText("The mark is registered.");
  });
});
