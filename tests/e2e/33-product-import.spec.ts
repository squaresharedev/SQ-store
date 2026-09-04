import { expect, test } from "@playwright/test";
import { freshUser, gotoApp, serviceRest, signUp, userIdByEmail } from "./helpers";

// Importing a catalogue from a CSV, end to end: the preview a seller reads
// before committing, and the rows that actually reach the database.

/** A Shopify product export, in the shape Shopify really writes one: variants
 *  as extra rows under a shared handle, descriptions as HTML, and a quoted
 *  cell carrying a comma. */
const SHOPIFY_CSV = [
  "Handle,Title,Body (HTML),Variant SKU,Variant Price,Variant Inventory Qty,Status",
  'oak-lamp,Oak lamp,"<p>Warm light, hand finished.</p>",LAMP-1,129.00,4,active',
  "oak-lamp,,,LAMP-2,129.00,2,active",
  "wall-hook,Wall hook,<p>Solid brass.</p>,HOOK-1,\"19,50\",0,draft",
  "no-price,Missing price,<p>Nothing.</p>,NP-1,,0,draft",
].join("\n");

async function upload(page: import("@playwright/test").Page, csv: string, name = "products.csv") {
  await page.setInputFiles("#import-file", {
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
}

test.describe("product import", () => {
  test("previews a Shopify export honestly, then imports exactly what it showed", async ({
    page,
  }) => {
    const user = freshUser("import");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await gotoApp(page, "/products");
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import products" })).toBeVisible();

    await upload(page, SHOPIFY_CSV);

    // The preview names what it found: a Shopify file, two importable
    // products, and the row it cannot use.
    const summary = page.locator("[data-import-summary]");
    await expect(summary).toContainText("Shopify export");
    await expect(summary).toContainText("2 products ready");
    await expect(summary).toContainText("1 skipped");
    // The second variant row is folded into the lamp, not imported as a blank.
    await expect(page.getByText(/1 variant row folded/i)).toBeVisible();
    // And it says plainly what it will not do.
    await expect(page.getByText(/photos are not imported/i)).toBeVisible();

    // The rows themselves, with the European decimal read correctly.
    const preview = page.locator("[data-import-preview]");
    await expect(preview.getByText("Oak lamp")).toBeVisible();
    await expect(preview.getByText("€129.00")).toBeVisible();
    await expect(preview.getByText("Wall hook")).toBeVisible();
    await expect(preview.getByText("€19.50")).toBeVisible();

    // The unusable row is named with its line and its reason, not swallowed.
    const skipped = page.locator("[data-import-skipped]");
    await expect(skipped).toContainText("Line 5");
    await expect(skipped).toContainText("Missing price");
    await expect(skipped).toContainText(/no price/i);

    await page.getByRole("button", { name: /^import 2 products$/i }).click();
    await expect(page).toHaveURL(/\/products$/);

    // What actually landed. Drafts by default, so nothing an import got wrong
    // is visible to a buyer before the seller has looked at it.
    const rows = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&select=title,price_cents,currency,status,description,track_stock,stock_quantity&order=title`,
    )) as {
      title: string;
      price_cents: number;
      currency: string;
      status: string;
      description: string | null;
      track_stock: boolean;
      stock_quantity: number | null;
    }[];
    expect(rows).toHaveLength(2);

    const lamp = rows.find((row) => row.title === "Oak lamp")!;
    expect(lamp.price_cents).toBe(12900);
    expect(lamp.currency).toBe("EUR");
    // The file says "active", but the import ran as drafts: the one "Import
    // as" control governs every row, so a catalogue that was live elsewhere
    // cannot arrive live here by surprise.
    expect(lamp.status).toBe("draft");
    // The HTML came across as plain text, tags and all removed.
    expect(lamp.description).toBe("Warm light, hand finished.");
    expect(lamp.track_stock).toBe(true);
    expect(lamp.stock_quantity).toBe(4);

    const hook = rows.find((row) => row.title === "Wall hook")!;
    expect(hook.price_cents).toBe(1950);
  });

  test("a file with unhelpful headers is rescued by the column mapping", async ({ page }) => {
    const user = freshUser("import-map");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await gotoApp(page, "/products/import");
    await upload(page, ["col a,col b", "Brass hook,19.50", "Oak shelf,49"].join("\n"));

    // Nothing maps on its own, and the preview says so rather than importing
    // two nameless products.
    await expect(page.locator("[data-import-summary]")).toContainText("0 products ready");
    await expect(page.getByRole("button", { name: /^import/i })).toBeDisabled();

    // The seller points Title and Price at the right columns.
    await page.getByRole("combobox", { name: /^Title/ }).click();
    await page.getByRole("option", { name: "col a" }).click();
    await page.getByRole("combobox", { name: /^Price/ }).click();
    await page.getByRole("option", { name: "col b" }).click();

    await expect(page.locator("[data-import-summary]")).toContainText("2 products ready");
    await page.getByRole("button", { name: /^import 2 products$/i }).click();
    await expect(page).toHaveURL(/\/products$/);

    const rows = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&select=title,price_cents&order=title`,
    )) as { title: string; price_cents: number }[];
    expect(rows.map((row) => [row.title, row.price_cents])).toEqual([
      ["Brass hook", 1950],
      ["Oak shelf", 4900],
    ]);
  });

  test("refuses a file that carries no products, without writing anything", async ({ page }) => {
    const user = freshUser("import-empty");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await gotoApp(page, "/products/import");
    // A file with a header and nothing usable under it. The button never
    // becomes pressable, so there is no way to reach the action with it.
    await upload(page, ["Title,Price", ",", "Nameless,"].join("\n"));
    await expect(page.locator("[data-import-summary]")).toContainText("0 products ready");
    await expect(page.getByRole("button", { name: /^import/i })).toBeDisabled();

    const rows = (await serviceRest(
      `/products?owner_id=eq.${sellerId}&select=id`,
    )) as { id: string }[];
    expect(rows).toHaveLength(0);
  });
});
