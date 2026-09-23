import { expect, test, type Page } from "@playwright/test";
import {
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
 * PAUSE, THE SELLER'S HALF.
 *
 * Staff can now pause a listing instead of removing it: hidden until the
 * seller changes what they were told to change and asks for another look.
 * This walks everything SQ-store owns of that loop, starting from the exact
 * write the admin panel makes (a service_role PATCH, the contract between the
 * two apps):
 *
 *   - a paused product is hidden from buyers exactly like a removed one,
 *   - the seller sees it on the list and gets the note on the edit page,
 *   - one button sends it back, and that is the only moderation column the
 *     seller's action can move (and only through the server),
 *   - a REMOVED product never offers that button.
 *
 * The admin UI's half is driven by 72-admin-moderation.cross-app.spec.ts,
 * which needs the admin panel running and is opt-in.
 */

/** Same storefront shape as 66-content-reports.spec.ts: enough for the hosted
 *  product page to render, so "hidden" is a real 404 and not a bad config. */
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

type Seeded = { sellerId: string; storefrontId: string; productId: string };

async function seed(page: Page, tag: string): Promise<Seeded> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Pause studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  await seedProducts(sellerId, [
    { title: "Paused lamp", price_cents: 9900, description: "A lamp." },
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
  return { sellerId, storefrontId, productId };
}

/** The admin panel's takedown write (Admin actions.ts takeDownContent). */
async function takeDown(
  table: "products" | "storefronts",
  id: string,
  status: "paused" | "removed",
) {
  await serviceRest(`/${table}?id=eq.${id}`, {
    method: "PATCH",
    body: {
      moderation_status: status,
      moderation_ground: "counterfeit",
      moderation_note: "Remove the brand logo from the main photo.",
      moderated_at: new Date().toISOString(),
      moderation_review_requested_at: null,
    },
  });
}

async function moderationOf(table: "products" | "storefronts", id: string) {
  const rows = (await serviceRest(
    `/${table}?id=eq.${id}&select=moderation_status,moderation_review_requested_at`,
  )) as { moderation_status: string; moderation_review_requested_at: string | null }[];
  return rows[0]!;
}

test.describe("a paused product", () => {
  test("is hidden from buyers, explained to the seller, and sent back with one button", async ({
    page,
  }) => {
    const seeded = await seed(page, "pause-product");
    const before = await page.request.get(`/s/${seeded.storefrontId}/p/${seeded.productId}`);
    expect(before.status(), "live before the pause").toBe(200);

    await takeDown("products", seeded.productId, "paused");

    // Hidden from buyers by the same gate as a removal.
    const publicPage = await page.request.get(
      `/s/${seeded.storefrontId}/p/${seeded.productId}`,
    );
    expect(publicPage.status()).toBe(404);

    // The list says which kind of takedown it is.
    await page.goto("/products");
    const card = page.locator("li", { hasText: "Paused lamp" });
    await expect(card.locator('[data-removal-badge="paused"]')).toHaveText("Paused");

    // The edit page carries the reviewer's note and the way back.
    await page.goto(`/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="paused"]');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading")).toHaveText(
      "This product is paused until you change it",
    );
    await expect(notice.locator("[data-takedown-reason]")).toContainText(
      "Remove the brand logo from the main photo.",
    );

    // The listing is still editable while paused: fixing it is the point.
    await expect(page.getByLabel(/title/i).first()).toBeEditable();

    await notice.getByRole("button", { name: /I've made the changes, review it/i }).click();
    await expect(notice.locator("[data-review-requested]")).toContainText(/Sent for review on/);

    const after = await moderationOf("products", seeded.productId);
    expect(after.moderation_status).toBe("paused");
    expect(after.moderation_review_requested_at).not.toBeNull();

    // Survives a reload: the request is state, not a toast.
    await page.reload();
    await expect(
      page.locator('[data-takedown="paused"] [data-review-requested]'),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /I've made the changes, review it/i }),
    ).toHaveCount(0);

    // Still hidden: asking is not approving.
    const stillHidden = await page.request.get(
      `/s/${seeded.storefrontId}/p/${seeded.productId}`,
    );
    expect(stillHidden.status()).toBe(404);
  });

  test("comes back once staff approve, with nothing left over", async ({ page }) => {
    const seeded = await seed(page, "pause-approve");
    await takeDown("products", seeded.productId, "paused");

    // Staff approve: the admin panel's restore write.
    await serviceRest(`/products?id=eq.${seeded.productId}`, {
      method: "PATCH",
      body: {
        moderation_status: "ok",
        moderation_ground: null,
        moderation_note: null,
        moderated_at: null,
        moderation_review_requested_at: null,
      },
    });

    const publicPage = await page.request.get(
      `/s/${seeded.storefrontId}/p/${seeded.productId}`,
    );
    expect(publicPage.status()).toBe(200);

    await page.goto(`/products/${seeded.productId}/edit`);
    await expect(page.locator("[data-removal-notice]")).toHaveCount(0);
  });
});

test.describe("a removed product", () => {
  test("offers no way back but an appeal", async ({ page }) => {
    const seeded = await seed(page, "removed-final");
    await takeDown("products", seeded.productId, "removed");

    await page.goto("/products");
    await expect(
      page.locator("li", { hasText: "Paused lamp" }).locator('[data-removal-badge="removed"]'),
    ).toHaveText("Removed");

    await page.goto(`/products/${seeded.productId}/edit`);
    const notice = page.locator('[data-takedown="removed"]');
    await expect(notice).toContainText(/This is final/);
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(notice.getByRole("link", { name: /ask us to look again/i })).toBeVisible();
  });

  test("cannot be sent back through the server action either", async ({ page }) => {
    // The button is absent, but a Server Action is an endpoint: re-check the
    // server half refuses a removed item even when called directly. Driven
    // through a paused item first to get the action's id onto the page, then
    // the item is removed underneath the open page.
    const seeded = await seed(page, "removed-direct");
    await takeDown("products", seeded.productId, "paused");
    await page.goto(`/products/${seeded.productId}/edit`);
    const button = page.getByRole("button", { name: /I've made the changes, review it/i });
    await expect(button).toBeVisible();

    await takeDown("products", seeded.productId, "removed");
    await button.click();

    // Scoped: Next's route announcer is also a role="alert" on every page.
    await expect(page.locator("[data-removal-notice]").getByRole("alert")).toContainText(
      /removed, not paused/,
    );
    const after = await moderationOf("products", seeded.productId);
    expect(after.moderation_status).toBe("removed");
    expect(after.moderation_review_requested_at).toBeNull();
  });
});

test.describe("a paused storefront", () => {
  test("is explained on the storefront list, with the same button", async ({ page }) => {
    const seeded = await seed(page, "pause-storefront");
    await takeDown("storefronts", seeded.storefrontId, "paused");

    await page.goto("/storefront");
    const notice = page.locator('[data-removal-notice="storefront"][data-takedown="paused"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Remove the brand logo from the main photo.");
    await expect(page.locator('[data-storefront-removed="paused"]')).toContainText(
      "needs changes",
    );

    await notice.getByRole("button", { name: /I've made the changes, review it/i }).click();
    await expect(notice.locator("[data-review-requested]")).toBeVisible();
    expect(
      (await moderationOf("storefronts", seeded.storefrontId)).moderation_review_requested_at,
    ).not.toBeNull();
  });
});
