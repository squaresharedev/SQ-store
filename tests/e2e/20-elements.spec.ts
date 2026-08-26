import { expect, test, type Page } from "@playwright/test";
import {
  createStorefrontViaUI,
  freshUser,
  gotoApp,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * The Element tool: the seller's own artwork as a grid block, and the shape
 * library's move out of the toolbar into the left panel.
 *
 * WHAT IS NOT HERE, AND WHY. A real upload cannot run in this stack — the e2e
 * environment has no R2 credentials, so /api/uploads/element returns 503 long
 * before it reaches the sniffer. That gate is where the security actually
 * lives, and it is covered exhaustively (every script, handler, external
 * reference and entity trick) in tests/unit/upload-svg-sniff.test.ts.
 *
 * What can ONLY be proven here is the wiring around it: that the toolbar
 * offers the tool, that the library is reachable and inserts, and that an
 * image block survives a reload and reaches a buyer as a signed URL rather
 * than the object key the config actually stores.
 */

/**
 * The menu is opened by CLICK here, not hover, even though hover is the
 * pointer affordance. Hover reveal is a CSS transition with no state change to
 * wait on, so an assertion can land in the fade and see nothing; the click
 * path sets the same `shapeMenuOpen` state the touch fallback uses, and lands
 * deterministically. (Hover itself is a pure Tailwind concern, asserted at a
 * real viewport in the mobile spec rather than raced against here.)
 */
const OBJ_UUID = "66666666-7777-4888-8999-aaaaaaaaaaaa";

/** A well-formed element key for the owner. Never resolves to a picture in
 *  this stack (no R2), which is itself worth covering: the block must render
 *  its placeholder rather than a broken image. */
const elementKey = (ownerId: string) =>
  `elements/${ownerId}/${OBJ_UUID}-logo.svg`;

async function setUp(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  const ownerId = await userIdByEmail(user.email);
  await gotoApp(page, "/storefront");
  await createStorefrontViaUI(page);
  const storefrontId = page.url().match(/\/storefront\/([0-9a-f-]{36})/)![1];
  return { ownerId, storefrontId };
}

/** Put an image block straight into the stored config, the way the framing
 *  spec seeds a product photo: the upload is unreachable here, the block is
 *  what is under test. */
async function seedImageBlock(
  storefrontId: string,
  ownerId: string,
  overrides: Record<string, unknown> = {},
) {
  const stored = (await serviceRest(
    `/storefronts?id=eq.${storefrontId}&select=config`,
  )) as Array<{ config: Record<string, unknown> }>;
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        ...stored[0].config,
        blocks: [
          {
            type: "image",
            id: "11111111-2222-4333-8444-555555555555",
            key: elementKey(ownerId),
            alt: "Our logo",
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            ...overrides,
          },
        ],
      },
    },
  });
}

test.describe("the Element tool", () => {
  test("replaces the Shape tool in the toolbar", async ({ page }) => {
    await setUp(page, "el-tool");
    await expect(page.getByRole("button", { name: "Add element" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add shape" })).toHaveCount(0);
  });

  test("its menu is one row: upload, the library, and two shapes", async ({
    page,
  }) => {
    await setUp(page, "el-menu");
    await page.getByRole("button", { name: "Add element" }).click();
    const menu = page.getByRole("menu", { name: "Elements" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(4);
    await expect(menu.getByRole("menuitem", { name: "Upload" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "All shapes" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Add square" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Add circle" })).toBeVisible();
    // The library moved out; a kind outside the quick list is not in here.
    await expect(menu.getByRole("menuitem", { name: "Add hexagon" })).toHaveCount(0);

    // GEOMETRY, not just membership. The menu is absolutely positioned, so its
    // shrink-to-fit width is capped by the containing block — the Element
    // button's wrapper, about 100px wide — and without `w-max` the row is
    // silently squeezed and the last shape hangs past the border. Counting the
    // items cannot see that; only measuring can.
    const box = (await menu.boundingBox())!;
    expect(box.height).toBeLessThan(80); // one row, not two
    for (const item of await menu.getByRole("menuitem").all()) {
      const b = (await item.boundingBox())!;
      const label = await item.getAttribute("aria-label");
      expect(b.x, `${label} starts inside the menu`).toBeGreaterThanOrEqual(box.x);
      expect(
        b.x + b.width,
        `${label} ends inside the menu`,
      ).toBeLessThanOrEqual(box.x + box.width);
    }
  });

  test("a quick shape lands on the canvas", async ({ page }) => {
    await setUp(page, "el-quick");
    await page.getByRole("button", { name: "Add element" }).click();
    await expect(page.getByRole("menu", { name: "Elements" })).toBeVisible();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "Add circle" })
      .click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
  });
});

test.describe("the shape library in the left panel", () => {
  test("opens from the menu and holds the kinds the toolbar gave up", async ({
    page,
  }) => {
    await setUp(page, "el-panel");
    await page.getByRole("button", { name: "Add element" }).click();
    await expect(page.getByRole("menu", { name: "Elements" })).toBeVisible();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "All shapes" })
      .click();

    // Hexagon is the proof: absent from the toolbar, present here.
    const hexagon = page.getByRole("button", { name: "Add hexagon" });
    await expect(hexagon).toBeVisible();
    await expect(page.getByRole("button", { name: "Add parallelogram" })).toBeVisible();

    await hexagon.click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(1);
    // It stays open, so a second shape is a second click and not a re-open.
    await expect(hexagon).toBeVisible();
    await page.getByRole("button", { name: "Add star" }).click();
    await expect(page.locator("li[data-grid-cell]")).toHaveCount(2);
  });

  test("closes on its own control", async ({ page }) => {
    await setUp(page, "el-panel-close");
    await page.getByRole("button", { name: "Add element" }).click();
    await expect(page.getByRole("menu", { name: "Elements" })).toBeVisible();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "All shapes" })
      .click();
    await page.getByRole("button", { name: "Close library panel" }).click();
    await expect(page.getByRole("button", { name: "Add hexagon" })).toHaveCount(0);
  });

  test("sits beside an Uploads tab, and flips to it without reopening", async ({
    page,
  }) => {
    await setUp(page, "el-tabs");
    await page.getByRole("button", { name: "Add element" }).click();
    await expect(page.getByRole("menu", { name: "Elements" })).toBeVisible();
    await page
      .getByRole("menu", { name: "Elements" })
      .getByRole("menuitem", { name: "All shapes" })
      .click();

    await expect(page.getByRole("tab", { name: "Shapes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Uploads" }).click();
    await expect(page.getByRole("button", { name: /Upload image/ })).toBeVisible();
    // Nothing uploaded yet, so the empty state explains what will land here.
    await expect(page.getByText(/place the same one/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add hexagon" })).toHaveCount(0);
  });
});

test.describe("an image block on the canvas", () => {
  test("renders, is selectable, and carries its own inspector", async ({ page }) => {
    const { ownerId, storefrontId } = await setUp(page, "el-block");
    await seedImageBlock(storefrontId, ownerId);
    await page.reload();

    const tile = page.locator("li[data-grid-cell]").first();
    await expect(tile).toBeVisible();
    // No R2 in this stack, so the artwork cannot resolve — the block must say
    // so quietly rather than showing a broken image.
    await expect(tile.getByText("Image unavailable")).toBeVisible();

    await tile.click();
    await expect(page.getByRole("button", { name: "Fill" })).toBeVisible();
    await expect(page.getByLabel("Description")).toHaveValue("Our logo");
  });

  test("hides repositioning under Fit, where nothing is cropped", async ({
    page,
  }) => {
    const { ownerId, storefrontId } = await setUp(page, "el-fit");
    await seedImageBlock(storefrontId, ownerId, { fit: "contain" });
    await page.reload();

    await page.locator("li[data-grid-cell]").first().click();
    await expect(page.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Reposition image" })).toHaveCount(0);
  });

  test("edits survive a save and a reload", async ({ page }) => {
    const { ownerId, storefrontId } = await setUp(page, "el-save");
    await seedImageBlock(storefrontId, ownerId);
    await page.reload();

    await page.locator("li[data-grid-cell]").first().click();
    await page.getByRole("button", { name: "Fit" }).click();
    await page.getByLabel("Description").fill("Company mark");
    await page.getByRole("button", { name: "Save" }).click();
    await page.reload();

    await page.locator("li[data-grid-cell]").first().click();
    await expect(page.getByLabel("Description")).toHaveValue("Company mark");
    await expect(page.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // And the stored config still holds the object KEY, never a URL.
    const stored = (await serviceRest(
      `/storefronts?id=eq.${storefrontId}&select=config`,
    )) as Array<{ config: { blocks: Array<Record<string, unknown>> } }>;
    const block = stored[0].config.blocks.find((b) => b.type === "image");
    expect(block?.key).toBe(elementKey(ownerId));
    expect(block?.fit).toBe("contain");
  });

  test("reaches a buyer WITHOUT the object key", async ({ page }) => {
    const { ownerId, storefrontId } = await setUp(page, "el-embed");
    await seedImageBlock(storefrontId, ownerId);

    const stored = (await serviceRest(
      `/storefronts?id=eq.${storefrontId}&select=embed_key,config`,
    )) as Array<{ embed_key: string; config: Record<string, unknown> }>;
    await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
      method: "PATCH",
      body: {
        config: {
          ...stored[0].config,
          embed: { enabled: true, domains: ["example.com"] },
        },
      },
    });

    const response = await page.request.get(`/api/embed/${stored[0].embed_key}`, {
      headers: { origin: "https://example.com" },
    });
    expect(response.ok()).toBe(true);
    const body = await response.text();
    const payload = JSON.parse(body) as { blocks: Array<Record<string, unknown>> };

    const image = payload.blocks.find((b) => b.type === "image");
    expect(image).toBeDefined();
    expect(image?.alt).toBe("Our logo");

    // THE ASSERTION THAT MATTERS. The payload is a hand-built allowlist, and
    // the R2 object key is exactly the kind of thing it exists to keep out: a
    // buyer gets a signed, expiring URL or nothing at all, never the key.
    expect(image).not.toHaveProperty("key");
    expect(body).not.toContain(elementKey(ownerId));
    expect(body).not.toContain("elements/");
  });
});
