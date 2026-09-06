import { expect, test, type Page } from "@playwright/test";
import {
  canvasStill,
  freshUser,
  gotoApp,
  seedProducts,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * The design panel's search field, against the product page it can only
 * describe once the page is on the canvas.
 *
 * The gate is the whole point: a product page setting is edited while LOOKING
 * at the page, so with no page out the group collapses to one row that opens
 * one, and with a page out every control has its own row.
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

async function seed(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);

  await seedStorefronts(sellerId, [{ name: "Lamp studio" }]);
  const storefronts = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[];
  const storefrontId = storefronts[0]!.id;

  await seedProducts(sellerId, [{ title: "Oak lamp", price_cents: 12900 }]);
  const products = (await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id,title`,
  )) as { id: string; title: string }[];
  const lamp = products.find((p) => p.title === "Oak lamp")!.id;

  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        blocks: [{ type: "product", productId: lamp, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });

  return { storefrontId, lamp };
}

function field(page: Page) {
  return page.getByRole("combobox", { name: "Find a setting or object" });
}

async function search(page: Page, query: string): Promise<string[]> {
  await field(page).fill("");
  await field(page).fill(query);
  const rows = page.getByRole("option");
  await expect(async () => {
    expect(await rows.count()).toBeGreaterThan(0);
  }).toPass({ timeout: 5_000 });
  return rows.allInnerTexts();
}

test.describe("finding a product page setting from the design panel", () => {
  test("gates the page's settings on the page being on the canvas", async ({ page }) => {
    const s = await seed(page, "pgsearch");
    await gotoApp(page, `/storefront/${s.storefrontId}`);
    await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();

    // ---- NO PAGE OUT -----------------------------------------------------
    // The words still answer, but with the step that has to come first.
    const closed = await search(page, "photo fit");
    expect(closed.join(" | ")).toContain("Open the product page");
    expect(closed.join(" | ")).not.toContain("Product page photos");

    // Picking it puts the page on the canvas — the thing the seller could not
    // have searched for, because they were asking about a control on it.
    await page.getByRole("option").first().click();
    const artboard = page.locator(`[data-artboard-id="${s.lamp}"]`);
    await expect(artboard).toBeVisible();
    await expect(artboard.getByRole("heading", { level: 1 })).toHaveText("Oak lamp");
    // The board did not go anywhere: the page is another thing on the canvas.
    await expect(page.getByRole("button", { name: "Add product", exact: true })).toBeVisible();
    // And the panel landed on the page's own settings.
    await expect(page.getByRole("switch", { name: "Show a product page" })).toBeVisible();

    // ---- A PAGE IS OUT ---------------------------------------------------
    // Back to the root menu, where the field lives.
    await page.getByRole("button", { name: /^back to all settings/i }).first().click();
    await canvasStill(page);

    const open = await search(page, "photo fit");
    expect(open[0]).toContain("Product page photos");
    expect(open.join(" | ")).not.toContain("Open the product page");

    // The control it names is the one that opens.
    await page.getByRole("option").first().click();
    await expect(page.getByRole("group", { name: "Photo fit" })).toBeVisible();

    // Each control answers to its own name rather than to its section's.
    await page.getByRole("button", { name: /^back to all settings/i }).first().click();
    expect((await search(page, "incl vat"))[0]).toContain("Price note");
    expect((await search(page, "sold by"))[0]).toContain("Sold by byline");
    expect((await search(page, "keep it out of google"))[0]).toContain(
      "Search engine listing",
    );

    // ---- THE PAGE GOES AWAY AGAIN ---------------------------------------
    // The gate is live state, not a first-paint decision.
    await page.getByRole("button", { name: /^close the product page for oak lamp$/i }).first().click();
    await expect(artboard).toHaveCount(0);
    const reclosed = await search(page, "photo fit");
    expect(reclosed.join(" | ")).toContain("Open the product page");
    expect(reclosed.join(" | ")).not.toContain("Product page photos");
  });
});
