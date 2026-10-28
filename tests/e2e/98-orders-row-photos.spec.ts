import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  freshUser,
  gotoApp,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * EVERY ORDER ROW SHOWS WHAT WAS BOUGHT.
 *
 *   - Each row of /orders leads with the photo of its product (the bought
 *     version's own photo when it has one, else the cover; a quiet placeholder
 *     when there is none). The photos arrive with the page's one orders query,
 *     embedded through orders.product_id, so this also proves that embed holds
 *     against the real PostgREST and its RLS.
 *   - Every row of one product carries the same URL, so the picture is fetched
 *     once, not once per row.
 *   - Paging swaps in the next page's photos, and paging back restores them.
 *   - On a phone the queue still fits: the photo sits inside the product
 *     column's width rather than adding to it.
 */

/** Real pictures for the stack's https passthrough keys (see seedProducts). */
const PHOTO_HOST = "https://images.e2e.invalid";
const PHOTOS = {
  lamp: `${PHOTO_HOST}/rows-lamp.webp`,
  table: `${PHOTO_HOST}/rows-table.webp`,
  walnut: `${PHOTO_HOST}/rows-table-walnut.webp`,
  cup: `${PHOTO_HOST}/rows-cup.webp`,
};
const SAMPLE = (name: string) => readFileSync(path.join("public", "sample-storefront", name));
const BYTES: Record<string, Buffer> = {
  [PHOTOS.lamp]: SAMPLE("camera.webp"),
  [PHOTOS.table]: SAMPLE("speaker.webp"),
  [PHOTOS.walnut]: SAMPLE("headphones.webp"),
  [PHOTOS.cup]: SAMPLE("succulent.webp"),
};

const FINISH = "bbbbbbbb-0000-4000-8000-0000000000f0";
const WALNUT = "bbbbbbbb-0000-4000-8000-000000000001";
const OAK = "bbbbbbbb-0000-4000-8000-000000000002";

/** Serves the fake photo host and counts each picture's fetches. */
async function servePhotos(page: Page): Promise<Map<string, number>> {
  const fetched = new Map<string, number>();
  await page.route(`${PHOTO_HOST}/**`, (route) => {
    const url = route.request().url();
    fetched.set(url, (fetched.get(url) ?? 0) + 1);
    const body = BYTES[url];
    return body
      ? route.fulfill({ status: 200, contentType: "image/webp", body })
      : route.fulfill({ status: 404, body: "" });
  });
  return fetched;
}

async function newSeller(page: Page, tag: string): Promise<string> {
  const user = freshUser(tag);
  await signUp(page, user);
  const id = await userIdByEmail(user.email);
  await seedSellerIdentity(id, PUBLISHABLE_SELLER);
  return id;
}

async function productIds(sellerId: string): Promise<Record<string, string>> {
  const rows = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as {
    id: string;
    title: string;
  }[];
  return Object.fromEntries(rows.map((row) => [row.title, row.id]));
}

const rows = (page: Page) => page.locator("tbody tr");

/** Each row's product title and the photo it shows ("none" for the placeholder). */
async function rowPhotos(page: Page): Promise<{ title: string; photo: string }[]> {
  return rows(page).evaluateAll((trs) =>
    trs.map((tr) => ({
      title: tr.querySelector("td span.font-medium")?.textContent?.trim() ?? "",
      photo: tr.querySelector("td img")?.getAttribute("src") ?? (tr.querySelector("td svg.lucide-image") ? "none" : "?"),
    })),
  );
}

/** Every photo on the page has arrived and decoded into a real picture. */
async function expectPhotosLoaded(page: Page) {
  await page.locator("tbody tr").last().scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator("tbody img").evaluateAll((imgs) =>
        imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
}

test.describe("order rows show what was bought", () => {
  test("each row leads with its photo, one fetch per picture, and paging swaps them", async ({ page }) => {
    test.setTimeout(180_000);
    const fetched = await servePhotos(page);
    const sellerId = await newSeller(page, "rowphoto");
    await seedProducts(sellerId, [
      { title: "Brass lamp", image_key: PHOTOS.lamp },
      {
        title: "Oak table",
        image_key: PHOTOS.table,
        gallery: [{ key: PHOTOS.walnut, alt: "", optionId: WALNUT }],
        option_groups: [
          {
            id: FINISH,
            name: "Finish",
            display: "chip",
            options: [
              { id: WALNUT, name: "Walnut", available: true },
              { id: OAK, name: "Oak", available: true },
            ],
          },
        ],
      },
      { title: "Plain card" },
      { title: "Clay cup", image_key: PHOTOS.cup },
    ]);
    const id = await productIds(sellerId);

    // 25 orders, an hour apart: the newest 20 are page 1, and the oldest five
    // (every cup) are page 2 on their own.
    const start = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const at = (i: number) => new Date(start + i * 60 * 60 * 1000).toISOString();
    const sale = (i: number, title: string, extra: Record<string, unknown> = {}) => ({
      amount_cents: 2000,
      product_id: id[title],
      product_title: title,
      buyer_email: `b${i}@e2e.test`,
      created_at: at(i),
      ...extra,
    });
    const walnut = { selected_options: [{ label: "Finish", value: "Walnut" }] };
    const oak = { selected_options: [{ label: "Finish", value: "Oak" }] };
    await seedOrders(sellerId, [
      ...[0, 1, 2, 3, 4].map((i) => sale(i, "Clay cup")),
      ...Array.from({ length: 12 }, (_, k) => sale(5 + k, "Brass lamp")),
      sale(17, "Oak table", walnut),
      sale(18, "Oak table", walnut),
      sale(19, "Oak table", oak),
      sale(20, "Oak table", oak),
      sale(21, "Plain card"),
      sale(22, "Plain card"),
      sale(23, "Brass lamp"),
      sale(24, "Brass lamp"),
    ]);

    await gotoApp(page, "/orders?view=all");
    await expect(rows(page)).toHaveCount(20);
    await expectPhotosLoaded(page);

    const firstPage = await rowPhotos(page);
    const expected: Record<string, string> = {
      "Brass lamp": PHOTOS.lamp,
      "Plain card": "none",
      "Clay cup": PHOTOS.cup,
    };
    for (const row of firstPage) {
      if (row.title === "Oak table") continue;
      expect(row.photo, row.title).toBe(expected[row.title]);
    }
    // The version decides: Walnut has its own photo, Oak falls back to the cover.
    const versions = await rows(page)
      .filter({ hasText: "Oak table" })
      .evaluateAll((trs) =>
        trs.map((tr) => ({
          version: tr.querySelector("[data-order-selection]")?.textContent ?? "",
          photo: tr.querySelector("td img")?.getAttribute("src"),
        })),
      );
    expect(versions).toHaveLength(4);
    for (const row of versions) {
      expect(row.photo, row.version).toBe(row.version.includes("Walnut") ? PHOTOS.walnut : PHOTOS.table);
    }
    expect(firstPage.filter((row) => row.title === "Brass lamp")).toHaveLength(14);
    expect(firstPage.some((row) => row.title === "Clay cup")).toBe(false);

    // Fourteen lamp rows, one lamp download: every row of a product shares a URL.
    expect(fetched.get(PHOTOS.lamp)).toBe(1);
    expect(fetched.get(PHOTOS.cup) ?? 0).toBe(0);
    await page.locator("main").screenshot({ path: test.info().outputPath("orders-page-1.png") });

    // Page 2: the five cups, each with its photo.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(rows(page)).toHaveCount(5);
    await expectPhotosLoaded(page);
    const secondPage = await rowPhotos(page);
    expect(secondPage).toEqual(Array.from({ length: 5 }, () => ({ title: "Clay cup", photo: PHOTOS.cup })));
    expect(fetched.get(PHOTOS.cup)).toBe(1);
    await page.locator("main").screenshot({ path: test.info().outputPath("orders-page-2.png") });

    // And back: page 1's photos return with its rows.
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page).not.toHaveURL(/page=2/);
    await expect(rows(page)).toHaveCount(20);
    await expectPhotosLoaded(page);
    expect(await rowPhotos(page)).toEqual(firstPage);
    console.log("photo fetches:", JSON.stringify(Object.fromEntries(fetched)));
  });

  test("on a phone the queue still fits beside its photos", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await servePhotos(page);
    const sellerId = await newSeller(page, "rowphone");
    await seedProducts(sellerId, [
      { title: "Hand-thrown stoneware serving bowl", image_key: PHOTOS.cup },
      { title: "Brass lamp", image_key: PHOTOS.lamp },
    ]);
    const id = await productIds(sellerId);
    const waiting = { fulfilment_status: "unfulfilled" as const };
    const address = { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", country: "IE" };
    await seedOrders(sellerId, [
      {
        amount_cents: 6400,
        product_id: id["Hand-thrown stoneware serving bowl"],
        product_title: "Hand-thrown stoneware serving bowl",
        ship_to: address,
        ...waiting,
      },
      { amount_cents: 4200, product_id: id["Brass lamp"], product_title: "Brass lamp", ship_to: address, ...waiting },
    ]);

    await gotoApp(page, "/orders?view=to-ship");
    await expect(rows(page)).toHaveCount(2);
    await expectPhotosLoaded(page);
    // The table's own scroller does not have to scroll, and the date column
    // is not pushed off the edge.
    const fit = await page.locator("table").evaluate((table) => {
      const scroller = table.parentElement!;
      const lastCell = table.querySelector("tbody tr td:last-child")!.getBoundingClientRect();
      return {
        overflow: scroller.scrollWidth - scroller.clientWidth,
        dateRight: Math.round(lastCell.right),
        viewport: window.innerWidth,
      };
    });
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.dateRight).toBeLessThanOrEqual(fit.viewport);
    await page.locator("main").screenshot({ path: test.info().outputPath("orders-queue-phone.png") });
  });
});
