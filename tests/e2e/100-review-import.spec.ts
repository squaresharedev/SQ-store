import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { freshUser, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * A SELLER IMPORTS REVIEWS, AND IMPORTING THEM AGAIN ADDS NOTHING. Through the
 * real page and the real database:
 *
 *   - the file reads as counts (to import, already here, left out) and each
 *     product in it is matched in a picker that shows the products' photos;
 *   - the import lands its reviews and says how it went in place;
 *   - the SAME FILE again shows every review as already here before anything
 *     is sent, and offers nothing to import, whichever app it is said to be
 *     from; the route itself adds nothing a second time either;
 *   - a review newly matched alongside them lands alone, and the result says
 *     the rest were not added twice.
 */

const PHOTO_HOST = "https://images.example";

const CSV = [
  "title,body,rating,review_date,source,curated,reviewer_name,reviewer_email,product_id,product_handle,reply,reply_date,picture_urls,ip_address,location,metaobject_handle",
  "Beautiful finish,The brass has a soft brushed finish.,5,2026-01-08 15:36:22 UTC,web,ok,Eva Nováková,eva@example.com,1,brass-desk-lamp,,,,,,",
  "Arm is stiff,Stays exactly where you put it.,4,2026-04-17 10:58:09 UTC,web,ok,Oliver Hughes,oliver@example.com,1,brass-desk-lamp,,,,,,",
  '"Great, ""warm"" light","<p>Lovely <b>lamp</b> &amp; heavy base.</p>",5,2026-10-10 20:30:00 UTC,web,ok,Grace Liu,grace@example.com,1,brass-desk-lamp,,,,,,',
  "Great vinyl,Survived the dishwasher.,5,2026-02-03 13:21:55 UTC,web,ok,Maya Patel,maya@example.com,2,sticker-pack,,,,,,",
  "Small but cute,Check the sizes first.,4,2026-06-19 08:33:41 UTC,web,ok,Léo Moreau,leo@example.com,2,sticker-pack,,,,,,",
  "Calm,Perfect for focus.,5,2026-03-15 09:12:30 UTC,web,ok,Inês Costa,ines@example.com,3,ambient-loops,,,,,,",
  "Half a star,Nearly perfect.,4.5,2026-03-03 12:00:00 UTC,web,ok,Rachel Green,rachel@example.com,1,brass-desk-lamp,,,,,,",
  "Buy followers,Cheap followers,5,2026-05-01 06:00:00 UTC,web,spam,Spam Account,spam@example.com,2,sticker-pack,,,,,,",
].join("\n");

const FILE = { name: "judgeme-export.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8") };

const tile = (page: Page, id: string) => page.locator(`[data-review-import-tally="${id}"]`);

async function expectTally(page: Page, counts: Record<string, number>) {
  for (const [id, count] of Object.entries(counts)) {
    await expect(tile(page, id)).toContainText(String(count));
  }
}

test("a seller imports reviews, and importing the same file again adds nothing", async ({ page }) => {
  test.setTimeout(240_000);
  // The products' photos, served from a stand-in host.
  await page.route(`${PHOTO_HOST}/**`, (route) =>
    route.fulfill({ path: "public/sample-storefront/speaker.webp", contentType: "image/webp" }),
  );

  const user = freshUser("reviewimport");
  await signUp(page, user);
  const sellerId = await userIdByEmail(user.email);
  await seedProducts(sellerId, [
    { title: "Brass Desk Lamp", image_key: `${PHOTO_HOST}/lamp.webp` },
    { title: "Sticker Pack", image_key: `${PHOTO_HOST}/stickers.webp` },
    { title: "Ambient Loops Vol. 1" },
  ]);
  const products = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id,title`)) as { id: string; title: string }[];
  const reviewCount = async () => ((await serviceRest(`/reviews?seller_id=eq.${sellerId}&select=id`)) as unknown[]).length;

  // THE FILE, READ: counts first.
  await page.goto("/products/import-reviews");
  await page.locator("#review-import-file").setInputFiles(FILE);
  // 5 matched by name; the loops (no matching name), the half star and the
  // old store's spam are left out.
  await expectTally(page, { ready: 5, already: 0, leftOut: 3 });
  await expect(page.locator("[data-review-import-already]")).toHaveCount(0);

  // Each product in the file, matched in a picker with the products' photos.
  const lamp = page.locator('[data-review-import-key="brass-desk-lamp"]');
  await expect(lamp).toContainText("3 reviews");
  await expect(lamp.getByRole("img", { name: /out of 5 stars/ })).toBeVisible();
  const lampPicker = lamp.getByRole("combobox");
  await expect(lampPicker).toContainText("Brass Desk Lamp");
  await expect(lampPicker.locator("img")).toBeVisible();
  await lampPicker.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("option", { name: "Sticker Pack" }).locator("img")).toBeVisible();
  await expect(listbox.getByRole("option", { name: "Don't import" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-review-import-key="ambient-loops"]').getByRole("combobox")).toContainText("Don't import");

  // Why three are left out, one line away.
  const why = page.locator("[data-review-import-skipped]");
  await why.locator("summary").click();
  await expect(why).toContainText("1 for a product set to \"Don't import\"");
  await expect(why).toContainText("1 hidden or marked as spam on your old store");
  await expect(why).toContainText("Line 8: No rating from 1 to 5.");

  const axe = await new AxeBuilder({ page }).include("[data-review-import]").analyze();
  expect(
    axe.violations.map((violation) => violation.id),
    JSON.stringify(axe.violations.map((violation) => violation.nodes.map((node) => node.target))),
  ).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("preview.png"), fullPage: true });

  // IMPORTED, and said in place.
  await page.getByRole("button", { name: "Import 5 reviews" }).click();
  const result = page.locator("[data-review-import-result]");
  await expect(result).toHaveAttribute("data-review-import-result", "imported", { timeout: 30_000 });
  await expect(result.getByRole("heading", { name: "5 reviews imported" })).toBeFocused();
  await expectTally(page, { imported: 5, already: 0, leftOut: 3 });
  await page.screenshot({ path: test.info().outputPath("imported.png"), fullPage: true });
  expect(await reviewCount()).toBe(5);

  // THE SAME FILE AGAIN: already here, before anything is sent.
  await result.getByRole("button", { name: "Import another file" }).click();
  await page.locator("#review-import-file").setInputFiles(FILE);
  await expectTally(page, { ready: 0, already: 5, leftOut: 3 });
  await expect(page.locator("[data-review-import-already]")).toHaveText(
    "5 reviews in this file are already here, so they won't be added twice.",
  );
  await expect(lamp).toContainText("3 already here");
  const nothing = page.getByRole("button", { name: "Nothing new to import" });
  await expect(nothing).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("again.png"), fullPage: true });

  // Said to be from another app, they are still the same reviews.
  await page.locator("#review-import-source").click();
  await page.getByRole("option", { name: "Loox" }).click();
  await expectTally(page, { ready: 0, already: 5 });
  await expect(nothing).toBeDisabled();

  // The route itself adds nothing twice, whichever app it is told.
  const replay = await page.evaluate(
    async ({ csv, matches }) => {
      const response = await fetch("/api/sellers/import-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, fileName: "again.csv", source: "loox", matches }),
      });
      return { status: response.status, body: await response.json() };
    },
    {
      csv: CSV,
      matches: {
        "brass-desk-lamp": products.find((product) => product.title === "Brass Desk Lamp")!.id,
        "sticker-pack": products.find((product) => product.title === "Sticker Pack")!.id,
      },
    },
  );
  expect(replay).toMatchObject({ status: 201, body: { ok: true, imported: 0, duplicates: 5 } });
  expect(await reviewCount()).toBe(5);

  // A review newly matched lands alone; the rest are said not to be added twice.
  await page.locator('[data-review-import-key="ambient-loops"]').getByRole("combobox").click();
  await page.getByRole("option", { name: "Ambient Loops Vol. 1" }).click();
  await expectTally(page, { ready: 1, already: 5, leftOut: 2 });
  await page.getByRole("button", { name: "Import 1 review" }).click();
  await expect(result.getByRole("heading", { name: "1 review imported" })).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("5 were already here, so they weren't added twice.");
  expect(await reviewCount()).toBe(6);
});
