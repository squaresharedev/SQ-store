import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  agreeToTerms,
  openTermsStep,
  createProductViaUI,
  createStorefrontViaUI,
  expectTourStep,
  freshUser,
  gotoApp,
  seedOrders,
  signUp,
  TOUR_LAYER,
  tourButton,
  userIdByEmail,
  WELCOME_DIALOG,
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
    // Thirteen pages, each compiled on demand by the dev server and then
    // scanned by axe, in ONE test. That is deliberate (they share a signed-in
    // account and a seeded catalogue, and re-doing that setup per page would
    // cost far more than it saves), but it also means the wall clock is a
    // function of how much the app renders rather than of anything under test.
    // /analytics alone now draws five sections of charts. The suite's 60s
    // default was landing right on the boundary, so a slow compile failed a
    // test that had found no violations at all.
    test.setTimeout(180_000);

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

  test("storefront setup flow", async ({ page }) => {
    const user = freshUser("a11y-setup");
    await signUp(page, user);
    await gotoApp(page, "/storefront");
    await page
      .getByRole("button", { name: /new storefront|create storefront/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    /**
     * Wait out a step's entrance fade before scanning. axe measures what is on
     * screen at that instant, and a label caught mid-fade reports a contrast
     * ratio the settled control never has (muted text at 6% opacity reads as
     * #f0f0f0 on white). The step container is the one focusable-by-script
     * element in the dialog, which is what makes it findable here.
     */
    async function settled() {
      const step = dialog.locator('[tabindex="-1"]');
      await expect
        .poll(() => step.evaluate((el) => getComputedStyle(el).opacity))
        .toBe("1");
    }

    // The tile grid: 13 toggle buttons, each an icon over a label.
    await settled();
    await expectNoSeriousViolations(page, "setup flow (categories)");

    // And the swatch step, where the only thing separating the tiles is
    // colour, so the text label has to carry the meaning.
    await dialog.getByRole("button", { name: "Art & prints" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: /I ship it/ }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog).toContainText("Step 3 of 4");
    await settled();
    await expectNoSeriousViolations(page, "setup flow (looks)");
  });

  test("welcome flow and guided tour", async ({ page }) => {
    // The first thing a new seller meets, so each part is scanned: the welcome
    // (icon tiles), the Terms (a scroll region, a gated button), the seller
    // details form, then the tour it hands over to at
    // an anchored stop, a stop on another page, and a fallback stop.
    test.setTimeout(180_000);
    await signUp(page, freshUser("a11y-welcome"), { welcome: "keep" });
    await expect(page.getByRole("dialog", { name: WELCOME_DIALOG })).toBeVisible({
      timeout: 20_000,
    });
    const dialog = page.getByRole("dialog");

    /** Same reason as the setup flow's settle: axe reads text at whatever
     *  opacity it has reached. The slides' pictures animate in after the slide
     *  itself, so wait until every piece of text INSIDE THE SLIDE, and
     *  everything around it, is fully opaque.
     *
     * Scoped to `[data-welcome-step]`, not the whole dialog: the footer's
     * "Save and continue" is legitimately `opacity-50` while the form is
     * empty (disabled:opacity-50, control-styles.ts), which is a real state
     * to scan, not an animation to wait out. Walking the dialog's full text
     * would wait on that forever. */
    async function settled() {
      const step = dialog.locator("[data-welcome-step]");
      await expect
        .poll(() =>
          step.evaluate((root) => {
            const texts = [...root.querySelectorAll("*")].filter((el) =>
              [...el.childNodes].some(
                (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              ),
            );
            return [root, ...texts].every((el) => {
              for (let node: Element | null = el; node; node = node.parentElement) {
                if (getComputedStyle(node).opacity !== "1") return false;
                if (node === root) break;
              }
              return true;
            });
          }),
        )
        .toBe(true);
    }

    await settled();
    await expectNoSeriousViolations(page, "welcome flow (welcome picture)");

    // The Terms, with the agree button still shut (a real state to scan), then
    // read and agreed to.
    await openTermsStep(page);
    await settled();
    await expectNoSeriousViolations(page, "welcome flow (terms of service)");
    await agreeToTerms(page);

    const pathSlide = page.getByRole("dialog", { name: "Four steps to your first page" });
    await settled();
    await expectNoSeriousViolations(page, "welcome flow (four-step timeline)");

    await pathSlide.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("dialog", { name: "Add your seller details" })).toBeVisible();
    await settled();
    await expectNoSeriousViolations(page, "welcome flow (seller details)");

    await dialog.getByRole("button", { name: "Skip for now" }).click();

    /** The tour's card fades in once placed; scan it at full opacity. */
    async function tourSettled() {
      const card = page.locator(TOUR_LAYER).getByRole("dialog");
      await expect
        .poll(() =>
          card.evaluate((el) => {
            const inner = el.firstElementChild;
            return `${getComputedStyle(el).opacity}/${inner ? getComputedStyle(inner).opacity : "1"}`;
          }),
        )
        .toBe("1/1");
    }

    await expectTourStep(page, "overview-nav");
    await tourSettled();
    await expectNoSeriousViolations(page, "guided tour (first stop)");

    await tourButton(page, "Next");
    await expectTourStep(page, "search");
    await tourButton(page, "Next");
    await expectTourStep(page, "products-add");
    await tourSettled();
    await expectNoSeriousViolations(page, "guided tour (a stop on another page)");

    await tourButton(page, "Next");
    await expectTourStep(page, "products-import");
    await tourButton(page, "Next");
    await expectTourStep(page, "storefront-create");
    await tourButton(page, "Next");
    await expectTourStep(page, "storefront-sample");
    await tourSettled();
    await expectNoSeriousViolations(page, "guided tour (the sample storefront's link)");
    await tourButton(page, "Next");
    // A new seller has no card of their own, so the embed stop falls back,
    // snippet and all.
    await expectTourStep(page, "storefront-embed", "fallback");
    await tourSettled();
    await expectNoSeriousViolations(page, "guided tour (embed fallback, with snippet)");
  });

  test("sample storefront and its designer tour", async ({ page }) => {
    test.setTimeout(150_000);
    await signUp(page, freshUser("a11y-sample"));
    await gotoApp(page, "/storefront/sample");
    await expectTourStep(page, "editor-add");
    const card = page.locator(TOUR_LAYER).getByRole("dialog");
    await expect
      .poll(() =>
        card.evaluate((el) => {
          const inner = el.firstElementChild;
          return `${getComputedStyle(el).opacity}/${inner ? getComputedStyle(inner).opacity : "1"}`;
        }),
      )
      .toBe("1/1");
    await expectNoSeriousViolations(page, "sample storefront designer (tour first stop)");

    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR_LAYER)).toHaveCount(0);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expectNoSeriousViolations(page, "sample storefront designer");
  });

  test("storefront designer incl. pickers", async ({ page }) => {
    const user = freshUser("a11y-designer");
    await signUp(page, user);
    await gotoApp(page, "/storefront");
    await createStorefrontViaUI(page);
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
