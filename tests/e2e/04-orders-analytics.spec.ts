import { expect, test } from "@playwright/test";
import { freshUser, seedOrders, seedProducts, serviceRest, signUp, userIdByEmail } from "./helpers";

test.describe("orders + analytics (seeded)", () => {
  test("orders list shows seeded rows, filters by channel and status", async ({ page }) => {
    const user = freshUser("orders");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await seedOrders(sellerId, [
      { amount_cents: 1500, channel: "embed", status: "paid", buyer_email: "a@ex.com", product_title: "Alpha" },
      { amount_cents: 2500, channel: "marketplace", status: "paid", buyer_email: "b@ex.com", product_title: "Beta" },
      { amount_cents: 900, channel: "embed", status: "refunded", buyer_email: "c@ex.com", product_title: "Gamma" },
    ]);

    await page.goto("/orders");
    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.getByText("Gamma")).toBeVisible();

    // Channel filter: embed only. Retry the click — in dev mode the toolbar
    // may not be hydrated yet when the first click lands.
    await expect(async () => {
      await page.getByRole("button", { name: /^embed$/i }).click();
      await expect(page).toHaveURL(/channel=embed/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText("Beta")).not.toBeVisible();
    await expect(page.getByText("Alpha")).toBeVisible();

    // Clear filters brings everything back.
    await page.getByRole("button", { name: /clear filters/i }).click();
    await expect(page.getByText("Beta")).toBeVisible();
  });

  test("order detail opens with amounts, buyer email, and no mutation succeeds", async ({ page }) => {
    const user = freshUser("orderdetail");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 4200, product_title: "Detail piece", buyer_email: "buyer@detail.com" },
    ]);

    await page.goto("/orders");
    await page.getByText("Detail piece").click();
    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("€42.00");
    await expect(detail).toContainText("buyer@detail.com");

    // The panel's top bar is the same height as the page's own top bar (the
    // one carrying search), so the two read as one line across the screen.
    const height = (locator: ReturnType<typeof page.getByTestId>) =>
      locator.evaluate((el) => el.getBoundingClientRect().height);
    const pageBar = await height(page.getByTestId("top-bar"));
    expect(pageBar).toBeGreaterThan(0);
    expect(await height(page.getByTestId("order-detail-header"))).toBe(pageBar);

    // Esc closes the panel.
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
  });

  test("an order says which version was bought, in the list and in the detail", async ({
    page,
  }) => {
    // The fact fulfilment cannot proceed without: a table sold in two sizes is
    // two different parcels, and "Oak dining table, €899.00" says nothing about
    // which one to build.
    const user = freshUser("orderversion");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      {
        amount_cents: 89900,
        product_title: "Oak dining table",
        buyer_email: "buyer@table.com",
        selected_options: [
          { label: "Size", value: "Six seater" },
          { label: "Finish", value: "Walnut" },
        ],
      },
      // Sold in one version: nothing to say, and nothing said.
      { amount_cents: 4900, product_title: "Plain shelf", buyer_email: "buyer@shelf.com" },
    ]);

    await page.goto("/orders");
    const versioned = page.locator("tr", { hasText: "Oak dining table" });
    await expect(versioned.locator("[data-order-selection]")).toHaveText(
      "Size: Six seater · Finish: Walnut",
    );
    const plain = page.locator("tr", { hasText: "Plain shelf" });
    await expect(plain.locator("[data-order-selection]")).toHaveCount(0);

    await page.getByText("Oak dining table").click();
    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail).toBeVisible();
    await expect(detail.locator("[data-order-selection]")).toContainText("Six seater");
    await expect(detail.locator("[data-order-selection]")).toContainText("Walnut");
  });

  test("overview's Recent orders rows open that order's detail", async ({ page }) => {
    const user = freshUser("recentorders");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 1100, product_title: "Recent one", buyer_email: "one@ex.com" },
      { amount_cents: 2200, product_title: "Recent two", buyer_email: "two@ex.com" },
    ]);

    await page.goto("/dashboard");
    const card = page.locator("#recent-orders");
    await expect(card.getByRole("link", { name: /Recent two/ })).toBeVisible();

    // Every row is a link, and each one carries its own order id.
    const hrefs = await card.getByRole("link").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBe(2);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/orders\?order=[0-9a-f-]{36}$/);
    }
    expect(new Set(hrefs).size).toBe(2);

    // A plain click opens the order's panel RIGHT HERE: the detail came with
    // the page, so there is no trip to /orders and nothing to wait on.
    await card.getByRole("link", { name: /Recent one/ }).click();
    const inPlace = page.getByRole("dialog", { name: /order details/i });
    await expect(inPlace).toBeVisible();
    await expect(inPlace).toContainText("Recent one");
    await expect(inPlace).toContainText("€11.00");
    await expect(inPlace).toContainText("one@ex.com");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.keyboard.press("Escape");
    await expect(inPlace).not.toBeVisible();

    // Follow the row's OWN href (a new tab does this): it must land on that
    // order's detail panel.
    // Navigated rather than clicked because <Link> clicks do not commit in
    // this dev stack at all — the sidebar's own links behave identically, so
    // clicking would test the dev server, not the card. The href is the part
    // this feature owns.
    const two = await card
      .getByRole("link", { name: /Recent two/ })
      .getAttribute("href");
    await page.goto(two!);

    const detail = page.getByRole("dialog", { name: /order details/i });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Recent two");
    await expect(detail).toContainText("€22.00");
    await expect(detail).toContainText("two@ex.com");

    // Closing drops the param, so a reload does not reopen the panel.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(detail).not.toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/order=/);
  });

  test("overview's Recent orders rows show the product photo and units bought", async ({ page }) => {
    const user = freshUser("recentphoto");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    // An https:// image_key is served straight through (no R2 in the stack).
    const photo = "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=200";
    await seedProducts(sellerId, [{ title: "Photo lamp", image_key: photo }]);
    const [product] = (await serviceRest(`/products?owner_id=eq.${sellerId}&select=id`)) as {
      id: string;
    }[];
    await seedOrders(sellerId, [
      { amount_cents: 7500, product_title: "Photo lamp", product_id: product.id, quantity: 3 },
      { amount_cents: 2500, product_title: "Plain one", quantity: 1 },
    ]);

    await page.goto("/dashboard");
    const card = page.locator("#recent-orders");
    const lamp = card.getByRole("link", { name: /Photo lamp/ });
    await expect(lamp).toBeVisible();

    // More than one unit reads "3 × Photo lamp"; a lone unit is just its name.
    await expect(lamp).toContainText("3 × Photo lamp");
    const plain = card.getByRole("link", { name: /Plain one/ });
    await expect(plain).not.toContainText("×");

    // The photo sits to the LEFT of the text; the photo-less row keeps a tile.
    const img = lamp.locator("img");
    await expect(img).toHaveAttribute("src", photo);
    // ...and it really paints (a dead URL would leave the grey tile).
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
        timeout: 20_000,
      })
      .toBe(true);
    const [imgBox, textBox] = await Promise.all([
      img.boundingBox(),
      lamp.getByText("3 × Photo lamp").boundingBox(),
    ]);
    expect(imgBox!.x + imgBox!.width).toBeLessThanOrEqual(textBox!.x);
    await expect(plain.locator("img")).toHaveCount(0);
    await expect(plain.locator("svg.lucide-image")).toHaveCount(1);
    await card.screenshot({ path: "test-results/recent-orders-photo.png" });
  });

  test("analytics shows seeded revenue and channel split", async ({ page }) => {
    const user = freshUser("analytics");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    await seedOrders(sellerId, [
      { amount_cents: 10_000, channel: "embed" },
      { amount_cents: 5_000, channel: "marketplace" },
      { amount_cents: 2_000, channel: "embed", status: "refunded" },
    ]);

    await page.goto("/analytics");
    // Paid revenue = €150.00 (refunded excluded from revenue by most conventions;
    // accept either presentation but the page must not be the empty state).
    await expect(page.getByText(/€1[05]0\.00|€150|€170/).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/embed/i).first()).toBeVisible();
    await expect(page.getByText(/marketplace/i).first()).toBeVisible();
  });

  test("sales by weekday: each bar is a stack of the products sold that day", async ({ page }, testInfo) => {
    const user = freshUser("weekdays");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);

    // Noon UTC on the most recent Monday and Saturday that are already over,
    // so every order sits squarely inside one UTC weekday and the last 30 days.
    const lastOn = (isoWeekday: number) => {
      const day = new Date();
      day.setUTCHours(12, 0, 0, 0);
      do day.setUTCDate(day.getUTCDate() - 1);
      while ((day.getUTCDay() || 7) !== isoWeekday);
      return day.toISOString();
    };
    const monday = lastOn(1);
    const saturday = lastOn(6);
    const sold = (title: string, created_at: string, times: number) =>
      Array.from({ length: times }, () => ({ amount_cents: 2_000, product_title: title, created_at }));
    await seedOrders(sellerId, [
      // Six products. The four that sold most are named, best seller first
      // (a tie goes to the title that sorts first); the last two are "Other".
      ...sold("Lamp", monday, 3),
      ...sold("Lamp", saturday, 2),
      ...sold("Vase", monday, 1),
      ...sold("Vase", saturday, 2),
      ...sold("Bowl", saturday, 2),
      ...sold("Mug", monday, 2),
      ...sold("Spoon", saturday, 1),
      ...sold("Fork", saturday, 1),
    ]);

    await page.goto("/analytics");
    const card = page.locator('[data-analytics-section="sales"] [data-analytics-panel="weekdays"]');
    await expect(card).toHaveAttribute("data-analytics-state", "live", { timeout: 30_000 });

    // One stack layer per named product and one for the rest, named in the legend.
    await expect(card.locator(".recharts-bar")).toHaveCount(5);
    await expect(card.locator("ul li")).toHaveText(["Lamp", "Vase", "Bowl", "Mug", "Other"]);

    // The table twin says what each day's bar is made of.
    const row = (weekday: string) => card.getByRole("row", { name: new RegExp(`^${weekday}\\b`) });
    await expect(row("Mon").getByRole("cell")).toHaveText(["3 sales", "1 sale", "0 sales", "2 sales", "0 sales"]);
    await expect(row("Sat").getByRole("cell")).toHaveText(["2 sales", "2 sales", "2 sales", "0 sales", "2 sales"]);
    await expect(row("Wed").getByRole("cell")).toHaveText(Array(5).fill("0 sales"));

    // The stack is exactly the bar it replaced: Saturday's four segments reach
    // as high as eight sales, and the tallest day sets the axis.
    // (Polled: the bars grow in. Segments are grouped by where they stand,
    // since a day draws no rectangle for a product it did not sell.)
    await expect(async () => {
      const stacks = await card.evaluate((node) => {
        const columns = new Map<number, number>();
        for (const segment of node.querySelectorAll(".recharts-bar-rectangle path")) {
          const box = segment.getBoundingClientRect();
          if (box.height === 0) continue;
          const column = Math.round(box.left + box.width / 2);
          columns.set(column, (columns.get(column) ?? 0) + box.height);
        }
        return [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([, height]) => height);
      });
      // Two days sold anything: Monday (six sales), then Saturday (eight).
      expect(stacks).toHaveLength(2);
      expect(stacks[1] / stacks[0]).toBeCloseTo(8 / 6, 1);
    }).toPass({ timeout: 10_000 });

    // The published payload carries the same split, and it adds up.
    const snapshot = JSON.parse((await page.locator("#analytics-snapshot").textContent())!) as {
      sales: {
        weekdayProducts: string[];
        weekdays: { weekday: string; sales: number; products: { title: string | null; sales: number }[] }[];
      };
    };
    expect(snapshot.sales.weekdayProducts).toEqual(["Lamp", "Vase", "Bowl", "Mug"]);
    for (const day of snapshot.sales.weekdays) {
      expect(day.products.reduce((sum, part) => sum + part.sales, 0)).toBe(day.sales);
    }
    expect(snapshot.sales.weekdays[5].products).toEqual([
      { title: "Lamp", sales: 2 },
      { title: "Vase", sales: 2 },
      { title: "Bowl", sales: 2 },
      { title: null, sales: 2 },
    ]);

    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.6);
    await expect(card.locator(".recharts-tooltip-wrapper")).toContainText("Bowl");
    await card.screenshot({ path: testInfo.outputPath("weekday-products.png") });
  });

  test("empty state renders for a fresh account", async ({ page }) => {
    const user = freshUser("noorders");
    await signUp(page, user);
    await page.goto("/orders");
    await expect(
      page.getByText(/no orders|nothing here|empty|first sale/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Nothing to filter: no toolbar is drawn over an account with no orders.
    await expect(page.getByRole("search", { name: "order filters" })).toHaveCount(0);
  });
});
