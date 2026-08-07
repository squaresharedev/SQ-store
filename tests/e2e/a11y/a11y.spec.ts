import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createProductViaUI,
  freshUser,
  gotoApp,
  seedOrders,
  signUp,
  userIdByEmail,
} from "../helpers";

/**
 * Axe checks on the main pages. Serious + critical violations fail the build;
 * we scope out the Next.js dev-tools overlay (dev-only chrome, not our UI).
 */
async function expectNoSeriousViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = serious
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} -> ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
    )
    .join("\n");
  expect(serious, `${context}:\n${summary}`).toEqual([]);
}

test.describe("accessibility", () => {
  test("login page", async ({ page }) => {
    await gotoApp(page, "/login");
    await expectNoSeriousViolations(page, "/login");
  });

  test("signed-in core pages", async ({ page }) => {
    const user = freshUser("a11y");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [
      { amount_cents: 1200, product_title: "A11y order" },
      { amount_cents: 900, product_title: "A11y refunded", status: "refunded" },
      { amount_cents: 700, product_title: "A11y disputed", status: "disputed" },
      { amount_cents: 500, product_title: "A11y pending", status: "pending" },
    ]);
    await createProductViaUI(page, { title: "A11y product", price: "10.00" });

    for (const path of [
      "/dashboard",
      "/products",
      "/products/new",
      "/orders",
      "/analytics",
      "/payments",
      "/notifications",
      "/settings/account",
      "/settings/team",
      "/settings/notifications",
      "/settings/tax",
      "/settings/danger",
      "/storefront",
    ]) {
      await gotoApp(page, path);
      await expectNoSeriousViolations(page, path);
    }
  });

  test("universal search palette", async ({ page }) => {
    // A combobox is the pattern axe has the most to say about: a dangling
    // aria-activedescendant, an aria-controls pointing nowhere, or options
    // outside their listbox are all serious violations, and all are easy to
    // reintroduce while editing the results markup.
    await signUp(page, freshUser("a11y-search"));
    await gotoApp(page, "/dashboard");

    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();
    await expectNoSeriousViolations(page, "search palette (suggestions)");

    await input.fill("settings");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectNoSeriousViolations(page, "search palette (results)");

    // ...and with the highlight moved, which is when activedescendant is live.
    await page.keyboard.press("ArrowDown");
    await expectNoSeriousViolations(page, "search palette (active option)");

    await input.fill("zzzzqqqqnothing");
    await expect(page.getByText(/Nothing matches/i)).toBeVisible();
    await expectNoSeriousViolations(page, "search palette (empty)");
  });

  test("storefront designer incl. pickers", async ({ page }) => {
    const user = freshUser("a11y-designer");
    await signUp(page, user);
    await gotoApp(page, "/storefront");
    await page
      .getByRole("button", { name: /new storefront|create storefront/i })
      .first()
      .click();
    await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoSeriousViolations(page, "designer");
  });

  test("order detail dialog + date picker", async ({ page }) => {
    const user = freshUser("a11y-orders");
    await signUp(page, user);
    const sellerId = await userIdByEmail(user.email);
    await seedOrders(sellerId, [{ amount_cents: 3300, product_title: "Dialog order" }]);

    await gotoApp(page, "/orders");
    await page.getByText("Dialog order").click();
    await expect(page.getByRole("dialog", { name: /order details/i })).toBeVisible();
    await expectNoSeriousViolations(page, "order detail dialog");
  });
});
