import { devices, expect, test, type Page } from "@playwright/test";
import {
  freshUser,
  gotoApp,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * SETTINGS ON A PHONE.
 *
 * Two things break settings on a narrow screen and neither shows up on a
 * desktop run, so both are asserted rather than eyeballed:
 *
 *  1. The page itself must never scroll sideways. The settings sub-nav is a
 *     swipe strip that scrolls INSIDE itself; if that overflow escapes to the
 *     document, every page in settings gains a horizontal scrollbar and the
 *     content drifts under the viewport edge.
 *  2. Pop-up panels (the role picker on Team & access, the country picker on
 *     Tax) are absolutely positioned off a narrow trigger. Anchored naively
 *     they hang off the screen edge and the options can't be read or tapped.
 *
 * Its own file because Playwright refuses a device fixture inside a describe
 * block — the same reason 08-storefront-mobile.spec.ts is separate.
 */

test.use({ ...devices["iPhone 13"] });

const SETTINGS_PAGES = [
  "/settings/account",
  "/settings/notifications",
  "/settings/team",
  "/settings/tax",
  "/settings/legal",
  "/settings/danger",
];

/** signUp resolves while the /dashboard navigation is still in flight. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** How far the document can scroll sideways, in CSS pixels. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(
      doc.scrollWidth - doc.clientWidth,
      document.body.scrollWidth - doc.clientWidth,
    );
  });
}

test.describe("settings — phone", () => {
  let user: ReturnType<typeof freshUser>;

  test.beforeEach(async ({ page }) => {
    user = freshUser("setm");
    await signUp(page, user);
    await settle(page);
  });

  test("no settings page scrolls sideways", async ({ page }) => {
    for (const path of SETTINGS_PAGES) {
      await gotoApp(page, path);
      await expect(
        page.getByRole("navigation", { name: "Settings sections" }),
      ).toBeVisible();
      expect(await horizontalOverflow(page), `${path} overflows`).toBeLessThanOrEqual(1);
    }
  });

  test("the rail heading is announced but takes no space, and the tagline is gone", async ({
    page,
  }) => {
    await gotoApp(page, "/settings/account");
    const heading = page.getByRole("heading", { name: "Settings", level: 1 });
    // Still in the document — the cards' h2s need an h1 above them.
    await expect(heading).toHaveCount(1);
    // But drawn nowhere: the mobile top bar already says "Settings".
    const box = (await heading.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(1);
    await expect(page.getByText("Your account, your rules.")).toHaveCount(0);
  });

  test("the section strip swipes horizontally without showing a scrollbar", async ({
    page,
  }) => {
    await gotoApp(page, "/settings/account");
    const nav = page.getByRole("navigation", { name: "Settings sections" });

    // It really is a scroller: the tabs are wider than the strip.
    const metrics = await nav.evaluate((el: HTMLElement) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      // The gutter a classic scrollbar would occupy. Overlay scrollbars and
      // `scrollbar-width: none` both leave this at 0.
      gutter: el.offsetHeight - el.clientHeight,
      scrollbarWidth: getComputedStyle(el).scrollbarWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.gutter).toBe(0);
    expect(metrics.scrollbarWidth).toBe("none");

    // And it scrolls: a swipe moves it and the far tab comes into reach.
    await nav.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(page.getByRole("link", { name: /danger/i })).toBeInViewport();
  });

  test("a fade marks each end of the strip that still has tabs behind it", async ({
    page,
  }) => {
    await gotoApp(page, "/settings/account");
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    // The two decorative fades are the scroller's siblings.
    const leading = page.locator('nav[aria-label="Settings sections"] ~ div').first();
    const trailing = page.locator('nav[aria-label="Settings sections"] ~ div').last();

    // Parked at the start: nothing hidden to the left, plenty to the right.
    await expect(leading).toHaveCSS("opacity", "0");
    await expect(trailing).toHaveCSS("opacity", "1");

    await nav.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(leading).toHaveCSS("opacity", "1");
    await expect(trailing).toHaveCSS("opacity", "0");
  });

  test("the role picker opens fully on screen", async ({ page }) => {
    const ownerId = await userIdByEmail(user.email);
    // An INVITED row is enough: it renders the same MemberRow (and the same
    // role picker) without needing a second signed-up user, and `active` with
    // a null member_user_id is rejected by team_members_status_link.
    await serviceRest(`/team_members`, {
      method: "POST",
      body: {
        account_owner_id: ownerId,
        invited_email: freshUser("setmate").email,
        role: "viewer",
        status: "invited",
      },
    });

    await gotoApp(page, "/settings/team");
    const trigger = page
      .getByTestId("member-controls")
      .getByRole("combobox")
      .first();
    await expect(trigger).toBeVisible();
    await trigger.tap();

    const panel = page.getByRole("listbox");
    await expect(panel).toBeVisible();

    const box = (await panel.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x, "panel runs off the left edge").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "panel runs off the right edge").toBeLessThanOrEqual(width);

    // Opening it must not give the document something to scroll sideways.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Both options are readable and tappable where they landed.
    for (const name of [/editor/i, /viewer/i]) {
      const option = page.getByRole("option").filter({ hasText: name }).first();
      await expect(option).toBeInViewport();
      const optionBox = (await option.boundingBox())!;
      expect(optionBox.height).toBeGreaterThanOrEqual(40);
    }
  });

  test("the country picker opens fully on screen", async ({ page }) => {
    await gotoApp(page, "/settings/tax");
    const trigger = page.getByRole("combobox").first();
    await trigger.tap();

    const panel = page.getByRole("listbox");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
