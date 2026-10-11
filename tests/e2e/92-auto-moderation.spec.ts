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
 * THE MODERATION WALL, START TO FINISH, FROM THE SELLER'S SIDE.
 *
 * Nothing a seller writes is public until that exact version has been
 * approved. The database is what holds that line (tests/integration/
 * 37-auto-moderation proves it there); this walks the product built on top of
 * it, through the real app and the real database, with the development
 * stand-in answering for the classifier (lib/moderation/auto/test-provider.ts:
 * clean unless the content carries a marker):
 *
 *   - a clean edit to a live product never hides it,
 *   - a violation pauses it automatically: the buyer gets a 404, the seller
 *     gets the banner, the notification and a statement that says a machine
 *     decided, and saving a fix has it checked again with no person involved,
 *   - an "unsure" verdict holds it for a person, and a person's approval
 *     publishes it,
 *   - a row written straight through the REST API is hidden until the sweep
 *     settles it,
 *   - seller text on the profile is refused before it is stored,
 *   - a handle is approved by value, and the public directory lists a profile
 *     only under an approved one.
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

const CRON_SECRET = "e2e-cron-secret-not-a-real-one-0123456789";

type Seeded = { sellerId: string; email: string; storefrontId: string; productId: string };

/** A seller with one live product on one live storefront. Seeded with the
 *  service role, like every fixture: trusted rows start live. */
async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Wall studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  await seedProducts(sellerId, [
    { title: "Wall lamp", price_cents: 9900, description: "A lamp for a wall." },
  ]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
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
  return { sellerId, email: user.email, storefrontId, productId };
}

async function productState(productId: string) {
  const rows = (await serviceRest(
    `/products?id=eq.${productId}&select=moderation_status,moderation_ground,moderation_fields,moderation_decision_id,moderation_checked_at`,
  )) as {
    moderation_status: string;
    moderation_ground: string | null;
    moderation_fields: string[] | null;
    moderation_decision_id: string | null;
    moderation_checked_at: string | null;
  }[];
  return rows[0]!;
}

/** Edit the description on the product's own form and save. */
async function saveDescription(page: Page, productId: string, description: string) {
  await gotoApp(page, `/products/${productId}/edit`);
  await page.locator('[data-product-field="description"]').fill(description);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/products$/, { timeout: 90_000 });
}

async function publicStatus(page: Page, seeded: Seeded): Promise<number> {
  const response = await page.request.get(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
  return response.status();
}

test.describe("automatic moderation", () => {
  // The first spec after the stack boots compiles every route it walks.
  test.describe.configure({ timeout: 180_000 });

  test("a clean edit to a live product never hides it", async ({ page }) => {
    const seeded = await seed(page, "wall-clean");
    expect(await publicStatus(page, seeded)).toBe(200);

    await saveDescription(page, seeded.productId, "A lamp for a wall, now with a longer cable.");

    const state = await productState(seeded.productId);
    expect(state.moderation_status).toBe("ok");
    // Not merely left alone: this exact version was looked at and passed.
    expect(state.moderation_checked_at).not.toBeNull();
    expect(await publicStatus(page, seeded)).toBe(200);
  });

  test("a violation is paused automatically, explained, and re-checked when fixed", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "wall-violation");

    await saveDescription(page, seeded.productId, "A lamp. [[violation:hate]] words nobody may publish.");

    // Hidden from buyers, by a decision recorded as a machine's.
    const paused = await productState(seeded.productId);
    expect(paused.moderation_status).toBe("paused");
    expect(paused.moderation_ground).toBe("hate");
    expect(paused.moderation_fields).toEqual(["description"]);
    expect(await publicStatus(page, seeded)).toBe(404);
    const decisions = (await serviceRest(
      `/moderation_decisions?id=eq.${paused.moderation_decision_id}&select=automated,action,decided_by,fields`,
    )) as { automated: boolean; action: string; decided_by: string | null; fields: string[] }[];
    expect(decisions[0]).toEqual({
      automated: true,
      action: "paused",
      decided_by: null,
      fields: ["description"],
    });

    // The list says so in a word.
    await expect(page.locator('[data-removal-badge="paused"]')).toBeVisible();

    // The seller's banner: what to change, that no person decided, and that
    // saving a change is all it takes. No "I've made the changes" button,
    // because there is nobody to send it to.
    await gotoApp(page, `/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="paused"]');
    await expect(notice).toContainText("An automatic check made this decision");
    await expect(notice.locator("[data-fix-hint]")).toContainText("checked again straight away");
    await expect(notice.getByRole("button", { name: /made the changes/i })).toHaveCount(0);
    await expect(notice.getByRole("button", { name: "Appeal this decision" })).toBeVisible();
    await expect(page.locator('[data-fix-mark="description"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("auto-paused-edit.png"), fullPage: true });

    // They were told, in the bell, with a way straight to the listing.
    const notifications = (await serviceRest(
      `/notifications?user_id=eq.${seeded.sellerId}&type=eq.policy&select=title,data`,
    )) as { title: string; data: { kind: string; automated: boolean; href: string } }[];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.title).toBe('Action needed: your product "Wall lamp" is paused');
    expect(notifications[0]!.data).toMatchObject({
      kind: "content_paused",
      automated: true,
      href: `/products/${seeded.productId}/edit`,
    });

    // The statement of reasons says a machine decided (DSA Art. 17(3)(c)).
    const statement = await page.request.get(
      `/api/moderation/decisions/${paused.moderation_decision_id}/statement`,
    );
    expect(statement.status()).toBe(200);
    expect(statement.headers()["content-type"]).toContain("application/pdf");

    // Fixing it is the whole remedy: no prompt, no person, live again.
    await page.locator('[data-product-field="description"]').fill("A lamp for a wall. Nothing else.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog", { name: /Send it back for review/ })).toHaveCount(0);
    await page.waitForURL(/\/products$/, { timeout: 90_000 });

    const fixed = await productState(seeded.productId);
    expect(fixed.moderation_status).toBe("ok");
    expect(fixed.moderation_ground).toBeNull();
    expect(fixed.moderation_decision_id).toBeNull();
    expect(await publicStatus(page, seeded)).toBe(200);
  });

  test("an unsure verdict holds the product until a person approves it", async ({
    page,
  }, testInfo) => {
    const seeded = await seed(page, "wall-unsure");

    await saveDescription(page, seeded.productId, "A lamp. [[unsure]] Something borderline.");

    expect((await productState(seeded.productId)).moderation_status).toBe("review");
    expect(await publicStatus(page, seeded)).toBe(404);
    await expect(page.locator('[data-removal-badge="review"]')).toBeVisible();

    // The seller is told a person is looking: no reasons, nothing to appeal,
    // because nothing has been decided against them.
    await gotoApp(page, `/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="review"]');
    await expect(notice).toContainText("A person is checking this product");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("held-for-review.png"), fullPage: true });

    // The admin panel's approval (its restoreContent write).
    await serviceRest(`/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      body: { moderation_status: "ok" },
    });
    expect(await publicStatus(page, seeded)).toBe(200);

    // And it is remembered: a change that leaves those exact words alone
    // (the price is not content) does not send it back.
    await gotoApp(page, `/products/${seeded.productId}/edit`);
    await expect(page.locator("[data-takedown]")).toHaveCount(0);
  });

  test("a row written around the app stays hidden until the sweep settles it", async ({ page }) => {
    const seeded = await seed(page, "wall-rest");
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: seeded.sellerId,
      email: seeded.email,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 3600,
    });

    // Straight to PostgREST with the seller's own session: no server action,
    // no validation, no checker. They even ask for it to be approved.
    const direct = await fetch(`${GATEWAY_URL}/rest/v1/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: "Written around the app. [[violation]]" }),
    });
    expect(direct.status).toBe(204);
    expect((await productState(seeded.productId)).moderation_status).toBe("pending");
    expect(await publicStatus(page, seeded)).toBe(404);

    const forged = await fetch(`${GATEWAY_URL}/rest/v1/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ moderation_status: "ok" }),
    });
    expect(forged.status).toBe(403);

    // Nobody without the scheduler's secret can start a sweep, or even learn
    // that the route exists.
    expect((await page.request.post("/api/cron/moderation")).status()).toBe(404);

    // The sweep finds it, and it is judged like anything else.
    let outcome = "pending";
    for (let run = 0; run < 12 && outcome === "pending"; run += 1) {
      const sweep = await page.request.post("/api/cron/moderation", {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(sweep.status()).toBe(200);
      outcome = (await productState(seeded.productId)).moderation_status;
    }
    expect(outcome).toBe("paused");
    expect(await publicStatus(page, seeded)).toBe(404);
  });

  test("seller text on the profile is refused before it is stored", async ({ page }) => {
    const seeded = await seed(page, "wall-profile");

    await gotoApp(page, "/settings/account");
    const card = page.locator("#bio");
    const readBio = async () =>
      (
        (await serviceRest(`/profiles?id=eq.${seeded.sellerId}&select=seller_bio`)) as {
          seller_bio: string | null;
        }[]
      )[0]!.seller_bio;

    await card.locator("#seller_bio").fill("Makers of [[violation]] things");
    await card.getByRole("button", { name: /save/i }).click();
    await expect(
      page.getByText("This text breaks the platform rules, so it was not saved.").first(),
    ).toBeVisible();
    expect(await readBio()).toBeNull();

    // The same field takes ordinary words, written by the server for them.
    await card.locator("#seller_bio").fill("Makers of lamps for walls");
    await card.getByRole("button", { name: /save/i }).click();
    await expect.poll(readBio).toBe("Makers of lamps for walls");

    // And never from the seller's own session, whatever it sends.
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: seeded.sellerId,
      email: seeded.email,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 3600,
    });
    const direct = await fetch(`${GATEWAY_URL}/rest/v1/profiles?id=eq.${seeded.sellerId}`, {
      method: "PATCH",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ seller_bio: "Written around the app" }),
    });
    expect(direct.status).toBe(403);
    expect(await readBio()).toBe("Makers of lamps for walls");
  });

  test("a handle is public only once that exact handle has been approved", async ({ page }) => {
    const seeded = await seed(page, "wall-handle");
    const stamp = Date.now().toString(36);
    const listed = async () =>
      (
        (await serviceRest(`/public_profiles?id=eq.${seeded.sellerId}&select=username`)) as {
          username: string;
        }[]
      )[0]?.username ?? null;
    const approved = async (handle: string) =>
      (
        (await serviceRest(
          `/moderation_checks?subject=eq.handle:${handle}&select=verdict`,
        )) as { verdict: string }[]
      )[0]?.verdict ?? null;
    const saveHandle = async (handle: string) => {
      await gotoApp(page, "/settings/account");
      const field = page.locator("#username");
      await field.fill(handle);
      await field.locator("xpath=ancestor::form").getByRole("button", { name: /save/i }).click();
    };

    // The account opts in to the public directory while its handle is still
    // the one it signed up with, which nobody has looked at: not listed.
    await serviceRest(`/profiles?id=eq.${seeded.sellerId}`, {
      method: "PATCH",
      body: { is_public: true },
    });
    expect(await listed()).toBeNull();

    // A handle that breaks the rules is refused and never stored.
    const bad = `wall_violation_${stamp}`;
    await saveHandle(bad);
    await expect(
      page.getByText("This text breaks the platform rules, so it was not saved.").first(),
    ).toBeVisible();
    expect(await approved(bad)).toBe("violation");
    expect(await listed()).toBeNull();

    // An ordinary one is saved, and saving it is what approves it.
    const good = `wall_maker_${stamp}`;
    await saveHandle(good);
    await expect.poll(() => approved(good)).toBe("clean");
    await expect.poll(listed).toBe(good);

    // Written around the app, with the seller's own session: stored, since
    // nothing stops that, and simply not public.
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({
      sub: seeded.sellerId,
      email: seeded.email,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 3600,
    });
    const direct = await fetch(`${GATEWAY_URL}/rest/v1/profiles?id=eq.${seeded.sellerId}`, {
      method: "PATCH",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: `wall_sneaky_${stamp}` }),
    });
    expect(direct.status).toBe(204);
    expect(await listed()).toBeNull();
  });
});
