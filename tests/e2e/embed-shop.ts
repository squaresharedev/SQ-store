import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * A SELLER WITH AN EMBEDDED STOREFRONT, and the stand-in website it is pasted
 * into, for the embed specs (89-embed-frame, 97-embed-builders).
 *
 * The app (the loader and the frame) is http://localhost:3100; the seller's
 * website is /dev/embed-host opened on another name for the same machine,
 * http://shop.localhost:3100 (browsers resolve every *.localhost name to this
 * machine). The storefront lists `shop.localhost`; `other.localhost` is
 * everyone else.
 */

export const APP = "http://localhost:3100";
export const SELLER_SITE = "shop.localhost";
export const hostPage = (site: string, key: string, extra = "") => `http://${site}:3100/dev/embed-host?key=${key}${extra}`;

export const THEME = {
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

export const PRODUCT_PAGE = {
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

/** A stock count that appears nowhere else in the fixture, so finding it in
 *  the frame would mean the frame was sent it. */
export const SECRET_STOCK = 6173;

export type Shop = { sellerId: string; storefrontId: string; embedKey: string; store: string; vase: string };

export async function saveConfig(shop: Pick<Shop, "storefrontId" | "vase">, over: Record<string, unknown> = {}) {
  await serviceRest(`/storefronts?id=eq.${shop.storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        header: { show: true, name: "Clay House", bio: "Thrown by hand in Galway." },
        embed: { enabled: true, domains: [SELLER_SITE] },
        blocks: [
          { type: "product", productId: shop.vase, x: 0, y: 0, w: 2, h: 2 },
          {
            type: "text",
            id: "11111111-1111-4111-8111-111111111111",
            text: "New pieces every Friday",
            variant: "heading",
            align: "left",
            x: 0,
            y: 2,
            w: 4,
            h: 1,
          },
        ],
        ...over,
      },
    },
  });
}

/** A seller with one live product on a storefront that is embedded on
 *  shop.localhost: product pages on, trader details complete. */
export async function seedShop(page: Page, tag: string): Promise<Shop> {
  const user = freshUser(tag);
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  const store = `Clay House ${user.email.split("@")[0]}`;
  await seedSellerIdentity(sellerId, { ...PUBLISHABLE_SELLER, businessName: store });
  await seedStorefronts(sellerId, [{ name: "Clay house" }]);
  const [{ id: storefrontId, embed_key: embedKey }] = (await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id,embed_key`,
  )) as { id: string; embed_key: string }[];
  await seedProducts(sellerId, [
    { title: "Stoneware vase", price_cents: 2400, track_stock: true, stock_quantity: SECRET_STOCK },
  ]);
  const [{ id: vase }] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as { id: string }[];
  await saveConfig({ storefrontId, vase });
  return { sellerId, storefrontId, embedKey, store, vase };
}

/**
 * A visitor to the seller's site: no session, and a browser identity of their
 * own, because views are deduped per visitor (IP and user agent) per hour.
 */
export async function visitor(browser: Browser, name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ userAgent: `e2e-embed-${name}` });
  return { context, page: await context.newPage() };
}

/** Every response to a frame address, by status, as the page loads. */
export function frameStatuses(page: Page): number[] {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/e/")) statuses.push(response.status());
  });
  return statuses;
}

export const SLOT_FRAME = "[data-embed-slot] iframe";
export const frameHeight = (page: Page) =>
  page.locator(SLOT_FRAME).evaluate((frame) => (frame as HTMLIFrameElement).getBoundingClientRect().height);
