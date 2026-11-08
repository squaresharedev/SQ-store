import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
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
 * ARRANGING A STOREFRONT FOR PHONES, by hand, in the designer.
 *
 * The rules (where a pinned block sits, how the rest fill around it, what a
 * narrower phone board does to a rect) are pinned in
 * tests/unit/storefront/mobile-layout.test.ts. What only a browser can prove is
 * the whole path: the Canvas section's switch turns the arrangement on and
 * opens the phone view, a drag there pins the block without touching the
 * desktop board, Save writes it, and a buyer's phone draws the block where the
 * seller put it.
 */

const THEME = {
  background: { kind: "solid", color: "#f6f1e7" },
  accent: "#1f4d3a",
  font: "sans",
  columns: 6,
  rows: 6,
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

/** Product pages on, so the hosted storefront exists for a buyer to open. */
const PRODUCT_PAGE = {
  enabled: true,
  imageFit: "contain",
  ctaLabel: "Buy now",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: false,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map((id) => ({
    id,
    show: true,
  })),
};

type Block = { type: string; productId?: string; x: number; y: number; w: number; h: number; mobile?: unknown };
type Stored = { theme: { mobileColumns?: number }; blocks: Block[] };

/** A signed-in owner with two live products side by side on a 6-wide board,
 *  product pages on and trader details complete. With no phone arrangement a
 *  phone fits 4 columns, so each 2x2 tile there takes one: vase, then mug. */
async function seedShop(page: Page) {
  const user = freshUser("phone-arrange");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await seedStorefronts(sellerId, [{ name: "Phone shop" }]);
  const [{ id: storefrontId }] = (await serviceRest(`/storefronts?owner_id=eq.${sellerId}&select=id`)) as {
    id: string;
  }[];
  await seedProducts(sellerId, [
    { title: "Stoneware vase", price_cents: 2400 },
    { title: "Glazed mug", price_cents: 1800 },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  const vase = products.find((product) => product.title === "Stoneware vase")!.id;
  const mug = products.find((product) => product.title === "Glazed mug")!.id;
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        blocks: [
          { type: "product", productId: vase, x: 0, y: 0, w: 2, h: 2 },
          { type: "product", productId: mug, x: 2, y: 0, w: 2, h: 2 },
        ],
      },
    },
  });
  return { storefrontId, vase, mug };
}

/** The grid lines a cell is drawn on, as "column|row". */
function gridLines(cell: Locator) {
  return cell.evaluate((node) => {
    const style = (node as HTMLElement).style;
    return `${style.gridColumn}|${style.gridRow}`;
  });
}

async function storedConfig(storefrontId: string): Promise<Stored> {
  const [row] = (await serviceRest(`/storefronts?id=eq.${storefrontId}&select=config`)) as { config: Stored }[];
  return row.config;
}

test("a seller arranges the board for phones, and a buyer's phone draws it that way", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const shop = await seedShop(page);
  await gotoApp(page, `/storefront/${shop.storefrontId}`);
  await expect(page.locator("[data-canvas-board]")).toBeVisible();

  // Off by default, in the Canvas section of Theme, with a line saying what
  // phones get instead.
  await page.getByText("Theme", { exact: true }).first().click();
  const toggle = page.getByRole("switch", { name: "Arrange for phones" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Phones arrange this board automatically.")).toBeVisible();

  // On: at the width phones already used, and the phone view opens on it.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("slider", { name: "Phone width in blocks" })).toHaveAttribute("aria-valuenow", "4");
  await expect(page.getByRole("button", { name: "Mobile preview" })).toHaveAttribute("aria-pressed", "true");

  const board = page.locator("[data-canvas-board]");
  const vase = board.locator(`li[data-grid-cell][data-grid-key='p_${shop.vase}']`);
  const mug = board.locator(`li[data-grid-cell][data-grid-key='p_${shop.mug}']`);
  await expect.poll(() => gridLines(vase)).toBe("1 / span 1|1 / span 1");
  await expect.poll(() => gridLines(mug)).toBe("2 / span 1|1 / span 1");

  // Drag the vase two columns right and one row down, measured off the mug
  // beside it (one column over), the same press-and-drag as on desktop.
  const from = (await vase.boundingBox())!;
  const next = (await mug.boundingBox())!;
  const stride = next.x - from.x;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + stride, start.y + stride / 2, { steps: 6 });
  await page.mouse.move(start.x + stride * 2, start.y + stride, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => gridLines(vase)).toBe("3 / span 1|2 / span 1");

  // Saved: the phone width and the vase's phone rect, its desktop rect as it was.
  await page.locator("header").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await storedConfig(shop.storefrontId)).theme.mobileColumns, { timeout: 20_000 }).toBe(4);
  const saved = await storedConfig(shop.storefrontId);
  const savedVase = saved.blocks.find((block) => block.productId === shop.vase)!;
  expect(savedVase).toMatchObject({ x: 0, y: 0, w: 2, h: 2, mobile: { x: 2, y: 1, w: 1, h: 1 } });
  expect(saved.blocks.find((block) => block.productId === shop.mug)).not.toHaveProperty("mobile");

  // A buyer on a phone gets the board as the seller arranged it.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const buyer = await context.newPage();
  const response = await buyer.goto(`/s/${shop.storefrontId}`);
  expect(response?.status()).toBe(200);
  const shopBoard = buyer.locator(`[data-storefront-page='${shop.storefrontId}']`);
  await expect(shopBoard).toBeVisible();
  const buyerVase = shopBoard.locator(`li[data-grid-cell][data-grid-key='p_${shop.vase}']`);
  await expect.poll(() => gridLines(buyerVase)).toBe("3 / span 1|2 / span 1");
  await context.close();
});
