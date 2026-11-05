import { expect, test, type Page } from "@playwright/test";
import { devEmails, freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import { LATEST_TERMS_VERSION, TERMS_VERSIONS } from "../../src/lib/legal/terms-versions";

/**
 * New Terms, from the job to the dashboard: everyone is emailed, the 30 days
 * start from the last email, the dashboard says so, and agreeing clears it.
 *
 * The stack sets a fixed CRON_SECRET (tests/e2e/stack/server.mjs). Once a stack
 * has run this, the version has its date, so the job's own run is asserted only
 * by what it leaves behind; nothing here depends on being the first spec to run.
 */

const CRON_SECRET = "e2e-cron-secret-not-a-real-one-0123456789";
const OLD_VERSION = TERMS_VERSIONS[0].version;
const DAY_MS = 24 * 60 * 60 * 1000;

async function runJob(page: Page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await page.request.post("/api/cron/terms-notices", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { more: boolean };
    if (!body.more) return body;
  }
  throw new Error("the job never finished");
}

test("a new Terms version: notice, 30 days, banner, agreement", async ({ page }) => {
  test.setTimeout(240_000);
  const user = freshUser("terms-notice");
  await signUp(page, user);
  const id = await userIdByEmail(user.email);
  // Someone who agreed to the Terms before this version existed.
  await serviceRest(`/profiles?id=eq.${id}`, {
    method: "PATCH",
    body: { legal_accepted_version: OLD_VERSION, legal_accepted_at: new Date().toISOString() },
  });

  const before = Date.now();
  await runJob(page);

  const rows = (await serviceRest(`/terms_versions?version=eq.${LATEST_TERMS_VERSION}&select=*`)) as {
    notice_completed_at: string;
    effective_at: string;
  }[];
  expect(rows).toHaveLength(1);
  expect(
    new Date(rows[0].effective_at).getTime() - new Date(rows[0].notice_completed_at).getTime(),
  ).toBeGreaterThanOrEqual(30 * DAY_MS);
  expect(new Date(rows[0].effective_at).getTime()).toBeGreaterThan(before + 29 * DAY_MS);

  // Nobody can be told twice by a second run.
  const notices = async () =>
    (await devEmails(user.email)).filter((mail) => mail.subject === "We're updating our Terms of Service");
  const mails = await notices();
  await runJob(page);
  expect(await notices()).toHaveLength(mails.length);

  // The dashboard says so, on every page.
  await page.goto("/orders");
  const banner = page.locator("[data-terms-notice-banner]");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Our Terms change on");

  // Settings says what is changing, with both versions a click apart.
  // A click that lands before hydration is lost, so retry until it navigates.
  await expect(async () => {
    await banner.getByRole("link").click({ timeout: 2_000 });
    await expect(page).toHaveURL(/\/settings\/legal/, { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  const notice = page.locator("[data-terms-change-notice]");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "new Terms" })).toHaveAttribute(
    "href",
    `https://squareshare.eu/terms/v/${LATEST_TERMS_VERSION}/`,
  );

  // Agreeing early clears it, and records the new version.
  await page.getByRole("button", { name: /agree/i }).click();
  await expect(page.locator("[data-terms-agreed]")).toBeVisible();
  const saved = (await serviceRest(`/profiles?id=eq.${id}&select=legal_accepted_version`)) as {
    legal_accepted_version: string;
  }[];
  expect(saved[0].legal_accepted_version).toBe(LATEST_TERMS_VERSION);
  await page.goto("/orders");
  await expect(page.locator("[data-terms-notice-banner]")).toHaveCount(0);
});

test("the job answers nobody without the scheduler's secret", async ({ page }) => {
  const response = await page.request.post("/api/cron/terms-notices");
  expect(response.status()).toBe(404);
});
