import { test, expect } from "@playwright/test";
import { freshUser, gotoApp, signUp } from "./helpers";

/**
 * The product display-image upload, end to end: pick a file, save, and see
 * THAT image on the product.
 *
 * This path had no coverage at all, which is how it broke unnoticed — every
 * other product spec fills in text fields and never touches the dropzone.
 *
 * Needs real object storage, so it is skipped unless E2E_REAL_R2=1 (see
 * tests/e2e/stack/server.mjs). Without it the presign route correctly answers
 * 503 and there is nothing to assert about a real upload.
 */

// A 1x1 PNG — the smallest thing that is genuinely a PNG by magic bytes.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("product display image", () => {
  test.skip(
    process.env.E2E_REAL_R2 !== "1",
    "needs real R2: run with E2E_REAL_R2=1",
  );

  test("uploads, stores, and renders the seller's own image", async ({ page }) => {
    const failures: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/uploads/") && !res.ok()) {
        failures.push(`${new URL(res.url()).pathname} -> ${res.status()}`);
      }
    });

    await signUp(page, freshUser("image"));

    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Image Upload Probe");
    await page.getByLabel(/price/i).fill("9.00");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "probe.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 30_000 });

    expect(failures, "upload requests must all succeed").toEqual([]);

    // The card must show the uploaded object, not a placeholder and not a
    // seeded stock photo.
    const card = page.locator("li", { hasText: "Image Upload Probe" }).first();
    const img = card.locator("img").first();
    await expect(img).toBeVisible({ timeout: 15_000 });
    const src = await img.getAttribute("src");
    expect(src, "product image src").toBeTruthy();
    expect(src, "must be the seller's own R2 object, not a stock photo").toContain(
      "r2.cloudflarestorage.com",
    );
  });
});
