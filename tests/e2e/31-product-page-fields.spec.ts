import { test, expect } from "@playwright/test";
import { freshUser, gotoApp, serviceRest, signUp } from "./helpers";

/**
 * The product form's Options/Photos/Documents fields, end to end: name an
 * axis, fill its choices in one paste, drop a photo into ONE option's bucket
 * (not the general one), add a compliance PDF, save, and see it all survive a
 * reload.
 *
 * Needs real object storage, same as 11-product-image.spec.ts, which this
 * mirrors: skipped unless E2E_REAL_R2=1, because the hermetic stack has no R2
 * credentials and the presign route correctly 503s without them.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// A 1-page, effectively-empty PDF — the smallest thing that is genuinely a
// PDF by magic bytes (starts "%PDF-").
const PDF = Buffer.from(
  "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbM" +
    "SAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMyAzXT4+ZW5kb2JqCn" +
    "hyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKdHJhaWxlcjw8L1NpemUgNC9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjAKJSVFT0Y=",
  "base64",
);

test.describe("product form: options, photos, documents", () => {
  test.skip(
    process.env.E2E_REAL_R2 !== "1",
    "needs real R2: run with E2E_REAL_R2=1",
  );

  test("a photo dropped on an option, and a compliance PDF, both save and both come back", async ({
    page,
  }) => {
    await signUp(page, freshUser("pdp-fields"));
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Regulated Widget");
    await page.getByLabel(/price/i).fill("49.00");

    // The Colour preset names the axis and picks swatches in one click; the
    // values are the seller's own, pasted in as a list rather than typed one
    // at a time. That pair IS the ease claim, so it is what the test does.
    await page.getByRole("button", { name: "Colour", exact: true }).click();
    await page.getByLabel("Add options").fill("Red, Blue, Green");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-option-row]")).toHaveCount(3);

    // A second axis whose values are words, not colours — the case the old
    // colour-only field could not express at all.
    await page.getByRole("button", { name: "Size", exact: true }).click();
    await expect(page.locator("[data-option-group]")).toHaveCount(2);
    // The Size preset arrives already filled in.
    await expect(page.locator("[data-option-row]")).toHaveCount(9);

    // The OPTION's own upload tile, not the general one.
    const redBucket = page.locator("[data-gallery-bucket]", { hasText: "Red" });
    await redBucket.locator('input[type="file"]').setInputFiles({
      name: "red.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(redBucket.getByText("1 photo")).toBeVisible();

    // A compliance document, pre-labelled from its filename.
    await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
      name: "ce_certificate.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByLabel("Document name, shown to buyers")).toHaveValue("Ce certificate");

    // The document goes to its OWN route on save, not the digital file's:
    // that is the one that enforces PDF-only, the 20 MB cap and the document
    // rate-limit budget on what becomes a public download.
    const documentUpload = page.waitForRequest(
      (request) =>
        request.url().includes("/api/uploads/document") && request.method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /save product/i }).click();
    await documentUpload;
    await page.waitForURL(/\/products$/, { timeout: 30_000 });

    // And it is stored under the documents/ prefix, so a public manual and a
    // paywalled download are never the same key.
    const rows = (await serviceRest(
      "/products?title=eq.Regulated%20Widget&select=documents,option_groups,gallery",
    )) as {
      documents: { key: string; label: string }[];
      option_groups: { name: string; display: string; options: { id: string; name: string }[] }[];
      gallery: { key: string; optionId?: string }[];
    }[];
    expect(rows[0]!.documents[0]!.key).toMatch(/^documents\//);

    // Both axes stored, with the display each was given, and the photo tied to
    // an option that actually exists in them.
    const groups = rows[0]!.option_groups;
    expect(groups.map((group) => `${group.name}:${group.display}`)).toEqual([
      "Colour:swatch",
      "Size:chip",
    ]);
    expect(groups[0]!.options.map((option) => option.name)).toEqual(["Red", "Blue", "Green"]);
    const red = groups[0]!.options.find((option) => option.name === "Red")!;
    expect(rows[0]!.gallery[0]!.optionId).toBe(red.id);

    // Reopen the product and confirm it all survived the round trip. The card
    // body is not itself a link: the pencil is what opens the form.
    await page.getByRole("link", { name: "Edit Regulated Widget" }).click();
    await page.waitForURL(/\/products\/.+\/edit$/);

    await expect(page.locator("[data-option-group]")).toHaveCount(2);
    const savedRedBucket = page.locator("[data-gallery-bucket]", { hasText: "Red" });
    await expect(savedRedBucket.getByText("1 photo")).toBeVisible();
    await expect(page.getByLabel("Document name, shown to buyers")).toHaveValue("Ce certificate");
  });

  test("the document route refuses anything that is not really a PDF", async ({ page }) => {
    await signUp(page, freshUser("pdp-doc-guard"));
    // page.request shares the browser's cookies, so these are real requests
    // from a real session: the field's own checks are bypassed entirely, which
    // is exactly the case the route has to hold on its own.
    const post = (query: string, body: Buffer) =>
      page.request.post(`/api/uploads/document?${query}`, {
        headers: { "content-type": "application/pdf" },
        data: body,
      });

    // A declared type outside the one-entry allowlist.
    const wrongType = await post(
      "filename=manual.zip&contentType=application/zip",
      Buffer.from("PK000000000000"),
    );
    expect(wrongType.status()).toBe(415);
    expect((await wrongType.json()).error).toMatch(/PDF/i);

    // A zip RENAMED to .pdf and declared as one. The bytes decide, not the
    // name and not the header: this is the case that would otherwise put
    // arbitrary binary behind a public link on the product page.
    const liar = await post(
      "filename=manual.pdf&contentType=application/pdf",
      Buffer.from("PK000000000000"),
    );
    expect(liar.status()).toBe(415);
    expect((await liar.json()).error).toMatch(/isn't a PDF/i);

    // Over the cap, refused on the declared length before a byte is stored.
    const huge = await post(
      "filename=big.pdf&contentType=application/pdf",
      Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(21 * 1024 * 1024)]),
    );
    expect(huge.status()).toBe(413);
    expect((await huge.json()).fix).toMatch(/under 20 MB/i);
  });
});
