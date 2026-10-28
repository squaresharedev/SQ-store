import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { clearAuthRateLimits, freshUser, signUp } from "./helpers";
import {
  accessToken,
  claimsOf,
  continuePastPasskeyOffer,
  enableTwoFactor,
  enterChallengeCode,
  nextCode,
  signInToChallenge,
  type Authenticator,
} from "./two-factor";

/**
 * Signing in while Cloudflare keeps stopping the Worker.
 *
 * Production, 2026-10-28: on the Workers Free plan, a phone approving a
 * sign-in had about sixty of its requests stopped in four minutes (Error
 * 1102: Cloudflare's own 503 page instead of the app's answer). Each stopped
 * server action threw on the client and replaced the sign-in screen with the
 * error page, and each stopped page load showed Cloudflare's.
 *
 * Here the browser gets that same page for the first requests of each step
 * (page.route answers before the request reaches the app, which is what a
 * stop at start-up does), and every way in must still get through: by asking
 * again (lib/resilient-action.ts, public/sw.js), or by saying so in place and
 * letting the person try again. Never by losing the screen.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

/** Cloudflare's page for a Worker stopped at its CPU limit. */
const STOPPED_PAGE =
  "<!DOCTYPE html><title>Worker exceeded resource limits | localhost | Cloudflare</title>" +
  '<span class="inline-block">Error</span><span class="code-label">Error code 1102</span>';

/** The error boundary's heading: never acceptable on these screens. */
const CRASHED = "Something went wrong";

/**
 * Answer the next `count` server actions posted to `path` with Cloudflare's
 * stopped-Worker page. Returns how many it stopped so far.
 */
async function stopActions(page: Page, path: string, count: number) {
  const stopped = { count: 0 };
  await page.route(
    (url) => url.pathname === path,
    async (route: Route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] && stopped.count < count) {
        stopped.count += 1;
        return route.fulfill({ status: 503, contentType: "text/html", body: STOPPED_PAGE });
      }
      return route.fallback();
    },
  );
  return stopped;
}

const user = freshUser("stopped");
let app: Authenticator;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signUp(page, user);
  ({ app } = await enableTwoFactor(page, user.password));
});

test.afterAll(async () => {
  await context.close();
});

test.beforeEach(async () => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.clearCookies();
  await clearAuthRateLimits();
});

test("the password and the code both get through a Worker stopped twice each", async () => {
  const atLogin = await stopActions(page, "/login", 2);
  await signInToChallenge(page, user);
  expect(atLogin.count).toBe(2);

  const atChallenge = await stopActions(page, "/login/two-factor", 2);
  await enterChallengeCode(page, await nextCode(app));
  await continuePastPasskeyOffer(page);
  expect(atChallenge.count).toBe(2);
  expect(claimsOf(await accessToken(context)).aal).toBe("aal2");
  await expect(page.getByRole("heading", { name: CRASHED })).toHaveCount(0);
});

test("a code check that never comes back says so in place, and the next code signs in", async () => {
  await signInToChallenge(page, user);
  const stopped = await stopActions(page, "/login/two-factor", Number.POSITIVE_INFINITY);
  await enterChallengeCode(page, await nextCode(app));

  // Asked again for about fifteen seconds, then said where the code goes.
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toHaveText(
    "We couldn't reach the sign-in service. Check your connection and try again.",
    { timeout: 30_000 },
  );
  expect(stopped.count).toBe(7);
  await expect(page.getByRole("heading", { name: CRASHED })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
  expect(claimsOf(await accessToken(context)).aal).toBe("aal1");

  // The Worker is back: the same screen takes the next code.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await enterChallengeCode(page, await nextCode(app));
  await continuePastPasskeyOffer(page);
  expect(claimsOf(await accessToken(context)).aal).toBe("aal2");
});

test("approving from the phone gets through stopped requests on both devices", async ({ browser }) => {
  // This page is the phone: fully signed in, two-factor fresh.
  await signInToChallenge(page, user);
  await enterChallengeCode(page, await nextCode(app));
  await continuePastPasskeyOffer(page);
  await page.goto("/settings/security");
  await expect(page.locator('[data-sign-in-approval="on"]')).toBeVisible({ timeout: 20_000 });

  const computer = await browser.newContext();
  const desk = await computer.newPage();
  try {
    await signInToChallenge(desk, user);
    // Showing the QR code is stopped twice before it comes through.
    const atDesk = await stopActions(desk, "/login/two-factor", 2);
    await desk.getByRole("button", { name: "Approve from your phone instead" }).click();
    const waiting = desk.locator("[data-approval-url]");
    await expect(waiting).toBeVisible({ timeout: 30_000 });
    expect(atDesk.count).toBe(2);
    const link = new URL((await waiting.getAttribute("data-approval-url"))!).pathname;
    const number = await desk.locator("[data-approval-number]").getAttribute("data-approval-number");

    // On the phone, the tap is stopped twice before it lands.
    const atPhone = await stopActions(page, link, 2);
    await page.goto(link);
    await page.getByRole("button", { name: `Approve with ${number}` }).click();
    await expect(page.getByRole("heading", { name: "Sign-in approved" })).toBeVisible({ timeout: 30_000 });
    expect(atPhone.count).toBe(2);
    await expect(page.getByRole("heading", { name: CRASHED })).toHaveCount(0);

    // And the computer is in, by itself.
    await desk.waitForURL(/\/dashboard/, { timeout: 30_000 });
    expect(claimsOf(await accessToken(computer)).aal).toBe("aal2");
    await expect(desk.getByRole("heading", { name: CRASHED })).toHaveCount(0);
  } finally {
    await computer.close();
  }
});

test.describe("with the service worker running", () => {
  test.use({ serviceWorkers: "allow" });

  test("a page load Cloudflare stops is asked for again until it comes", async ({ page: tab, context: jar }) => {
    await tab.goto("/login");
    // Controlling the page once it is installed and active.
    await tab.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
        );
      }
      // The browser's own preload of a page bypasses Playwright's routing, so
      // the worker's first try is its own fetch here. It checks a preloaded
      // answer exactly the same way (pwa.test.ts pins that).
      await registration.navigationPreload?.disable();
    });

    // The next four loads of the sign-in page are stopped: the first try and
    // three of the worker's, longer than the old three-second schedule lasted.
    let stopped = 0;
    await jar.route(
      (url) => url.pathname === "/login",
      async (route) => {
        if (route.request().method() === "GET" && stopped < 4) {
          stopped += 1;
          return route.fulfill({ status: 503, contentType: "text/html", body: STOPPED_PAGE });
        }
        return route.fallback();
      },
    );
    await tab.reload();
    await expect(tab.locator('input[name="identifier"]')).toBeVisible({ timeout: 30_000 });
    expect(stopped).toBe(4);
    await expect(tab.getByText("Error code 1102")).toHaveCount(0);
  });
});
