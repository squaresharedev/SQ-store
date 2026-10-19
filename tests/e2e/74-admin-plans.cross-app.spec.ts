import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { serviceRest, signUp, userIdByEmail } from "./helpers";
import { enableTwoFactor } from "./two-factor";

/**
 * PLANS STAFF GIVE, ACROSS BOTH APPS.
 *
 *   staff tick two sellers in the admin panel's /plans and give them Pro
 *     -> both are on Pro (plan_grants), and each is told in their dashboard
 *   staff extend one seller's plan by a month, then change it to Starter with
 *   no end date; they end the other seller's
 *     -> the audit log is each account's plan history, and the export says it
 *   the first seller opens Plan & billing and the plans page
 *     -> "On us", no end date, nothing to buy that the plan already covers
 *   the second seller is back on Free
 *
 * OPT-IN, because it needs the ADMIN PANEL running too, which this repo's
 * Playwright config does not start. To run it:
 *
 *   1. Start the stack: node tests/e2e/stack/server.mjs
 *   2. Start SQ-admin against it (its .env.e2e, plus an empty mail key so its
 *      .env.local one never sends real email):
 *        STORE_APP_URL=http://localhost:3100 NEXT_PUBLIC_APP_URL=http://localhost:3201 \
 *          RESEND_API_KEY= next dev -p 3201
 *   3. E2E_ADMIN_URL=http://localhost:3201 npx playwright test 74-admin-plans
 *      (E2E_ADMIN_REPO points at SQ-admin when this checkout is not beside it.)
 *
 * Staff are a dashboard account with two-factor turned on through its real
 * settings screen: the admin panel only opens on a session that passed it,
 * and the two apps share the session cookie (one host, two ports, as
 * .squareshare.eu is live).
 */

const ADMIN_URL = process.env.E2E_ADMIN_URL;
const ADMIN_REPO = process.env.E2E_ADMIN_REPO ?? join(process.cwd(), "..", "Admin");
const DB_URL = "postgres://postgres:postgres@localhost:54322/sqstore_e2e";

test.skip(!ADMIN_URL, "set E2E_ADMIN_URL to run the cross-app plans spec");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const DAY = 86_400_000;

type GrantRow = { owner_id: string; plan: string; reason: string; starts_at: string; ends_at: string | null };

async function grantOf(ownerId: string): Promise<GrantRow | null> {
  const rows = (await serviceRest(`/plan_grants?owner_id=eq.${ownerId}&select=*`)) as GrantRow[];
  return rows[0] ?? null;
}

async function billingNotices(ownerId: string): Promise<{ title: string }[]> {
  return (await serviceRest(
    `/notifications?user_id=eq.${ownerId}&type=eq.billing&select=title,data&order=created_at.asc`,
  )) as { title: string }[];
}

/**
 * The admin panel's own user tables. Its user page reads the ban record
 * (admin_user_moderation, its 0003), which the replayed schema does not carry,
 * so this spec applies that migration itself, as spec 72 does for 0006.
 * ASCII only: the embedded server runs in WIN1252 on Windows.
 */
async function ensureAdminUserTables() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select to_regclass('public.admin_user_moderation') is not null as present`,
    );
    if (!rows[0].present) {
      const sql = [...readFileSync(join(ADMIN_REPO, "supabase", "migrations", "0003_admin_moderation.sql"), "utf8")]
        .filter((char) => char.charCodeAt(0) < 128)
        .join("");
      await client.query(sql);
      await client.query(`notify pgrst, 'reload schema'`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  } finally {
    await client.end();
  }
}

/** A seller with a store, signed in on their own browser context. */
async function seller(browser: Browser, run: string, letter: string) {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  const user = {
    email: `plans-${run}-${letter}@e2e.squareshare.to`,
    password: "e2e-password-123",
    username: `e2e_plans${run}${letter}`,
  };
  await signUp(page, user);
  return { context, page, user, id: await userIdByEmail(user.email) };
}

/** Tick one account's row in the admin's plan list. */
async function tick(admin: Page, ownerId: string) {
  await admin.locator(`[data-plan-row="${ownerId}"] input[type="checkbox"]`).check();
}

test("give, extend, change and end plans; the sellers see it", async ({ browser }) => {
  await ensureAdminUserTables();
  const run = String(Date.now() % 1_000_000_000);
  const a = await seller(browser, run, "a");
  const b = await seller(browser, run, "b");

  // --- Staff --------------------------------------------------------------
  const staffContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const admin = await staffContext.newPage();
  const staffUser = {
    email: `plans-${run}-staff@e2e.squareshare.to`,
    password: "e2e-password-123",
    username: `e2e_staff${run}`,
  };
  await signUp(admin, staffUser);
  await enableTwoFactor(admin, staffUser.password);
  await serviceRest(`/admin_users`, {
    method: "POST",
    body: [{ user_id: await userIdByEmail(staffUser.email), role: "staff" }],
  });

  // --- The list: both on Free ------------------------------------------------
  await admin.goto(`${ADMIN_URL}/plans?q=plans-${run}`);
  await expect(admin.getByRole("heading", { name: "Plans", level: 1 })).toBeVisible({ timeout: 60_000 });
  for (const who of [a, b]) {
    await expect(admin.locator(`[data-plan-row="${who.id}"] [data-plan]`)).toHaveAttribute("data-plan", "free");
  }

  // --- Give both Pro, for 3 months, in one go ---------------------------------
  await tick(admin, a.id);
  await tick(admin, b.id);
  const bulk = admin.getByRole("region", { name: "Selected accounts" });
  await expect(bulk).toContainText("2 selected");
  await bulk.getByRole("button", { name: "Give a plan" }).click();
  const giveDialog = admin.getByRole("dialog", { name: "Give a plan" });
  await giveDialog.locator('[data-choice="pro"]').click();
  await giveDialog.locator('[data-choice="3m"]').click();
  await giveDialog.locator('[data-choice="beta_tester"]').click();
  await giveDialog.getByLabel("Note (optional, staff only)").fill("Spring beta cohort");
  await expect(giveDialog.locator("[data-grant-summary]")).toContainText("Pro for 2 accounts, until");
  await giveDialog.getByRole("button", { name: "Give Pro to 2 accounts" }).click();
  await expect(giveDialog.getByRole("status")).toContainText("Pro given to 2 accounts until", { timeout: 30_000 });
  await expect(giveDialog.getByRole("status")).toContainText("Told in their dashboard.");
  await giveDialog.getByRole("button", { name: "Done" }).click();

  for (const who of [a, b]) {
    await expect(admin.locator(`[data-plan-row="${who.id}"] [data-plan]`)).toHaveAttribute("data-plan", "pro");
    await expect(admin.locator(`[data-plan-row="${who.id}"]`)).toHaveAttribute("data-plan-source", "granted");
    const grant = await grantOf(who.id);
    expect(grant).toMatchObject({ plan: "pro", reason: "beta_tester" });
    const days = (Date.parse(grant!.ends_at!) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(85);
    expect(days).toBeLessThan(95);
  }
  expect((await billingNotices(a.id)).map((n) => n.title)).toEqual(["Square Share gave your store Pro"]);

  // --- Extend the first seller's plan by a month ------------------------------
  const before = (await grantOf(a.id))!;
  await admin.goto(`${ADMIN_URL}/users/${a.id}#plan`);
  const panel = admin.locator("[data-plan-panel]");
  await expect(panel).toHaveAttribute("data-plan", "pro");
  await expect(panel).toContainText("Spring beta cohort");
  await panel.getByRole("button", { name: "+1 month" }).click();
  await expect(panel.getByRole("status")).toContainText("Pro extended until", { timeout: 30_000 });
  const extended = (await grantOf(a.id))!;
  const addedDays = (Date.parse(extended.ends_at!) - Date.parse(before.ends_at!)) / DAY;
  expect(addedDays).toBeGreaterThanOrEqual(28);
  expect(addedDays).toBeLessThanOrEqual(31);
  expect(extended.starts_at).toBe(before.starts_at);

  // --- Change it to Starter, with no end date ---------------------------------
  await panel.getByRole("button", { name: "Change the given plan" }).click();
  const changeDialog = admin.getByRole("dialog", { name: "Change the given plan" });
  await changeDialog.locator('[data-choice="starter"]').click();
  await changeDialog.locator('[data-choice="none"]').click();
  await changeDialog.locator('[data-choice="founding_seller"]').click();
  await changeDialog.getByRole("button", { name: "Give Starter" }).click();
  await expect(changeDialog.getByRole("status")).toContainText("Starter given to the account with no end date", {
    timeout: 30_000,
  });
  await changeDialog.getByRole("button", { name: "Done" }).click();
  await expect(panel).toHaveAttribute("data-plan", "starter");
  expect(await grantOf(a.id)).toMatchObject({ plan: "starter", reason: "founding_seller", ends_at: null, starts_at: before.starts_at });

  const history = admin.locator("[data-plan-history] li");
  await expect(history).toHaveCount(3);
  await expect(history.first()).toContainText("Changed the given plan to Starter with no end date (Founding seller)");

  // --- End the second seller's ------------------------------------------------
  await admin.goto(`${ADMIN_URL}/users/${b.id}#plan`);
  const panelB = admin.locator("[data-plan-panel]");
  await panelB.getByRole("button", { name: "End the given plan" }).click();
  const endDialog = admin.getByRole("dialog", { name: "End the given plan?" });
  await endDialog.getByRole("button", { name: "End the plan" }).click();
  await expect(endDialog.getByRole("status")).toContainText("Given plan ended.", { timeout: 30_000 });
  await endDialog.getByRole("button", { name: "Done" }).click();
  await expect(panelB).toHaveAttribute("data-plan", "free");
  expect(Date.parse((await grantOf(b.id))!.ends_at!)).toBeLessThanOrEqual(Date.now());
  expect((await billingNotices(b.id)).map((n) => n.title)).toEqual([
    "Square Share gave your store Pro",
    "Your Pro plan from Square Share has ended",
  ]);

  // --- The filters and the export ------------------------------------------------
  await admin.goto(`${ADMIN_URL}/plans?source=granted&q=plans-${run}`);
  await expect(admin.locator("[data-plan-row]")).toHaveCount(1);
  const csv = await (await staffContext.request.get(`${ADMIN_URL}/plans/export?q=plans-${run}`)).text();
  expect(csv.split("\r\n")[0]).toContain("email,username,plan,source,until");
  expect(csv).toContain(`"${a.user.email}"`);
  expect(csv).toContain(`"${b.user.email}"`);
  expect(csv).toContain('"Starter","granted"');

  // --- What the first seller sees -----------------------------------------------
  await a.page.goto("/settings/billing");
  await expect(a.page.locator("[data-billing-plan]")).toHaveAttribute("data-billing-plan", "starter", { timeout: 30_000 });
  await expect(a.page.getByText("On us: Square Share gave your store this plan.")).toBeVisible();
  await expect(a.page.getByText("No end date.")).toBeVisible();
  await a.page.goto("/plans");
  await expect(a.page.getByRole("status").filter({ hasText: "Your Starter plan is on us, with no end date." })).toBeVisible();
  await expect(a.page.getByRole("button", { name: /Upgrade to Starter/ })).toHaveCount(0);
  await a.page.goto("/notifications");
  await expect(a.page.getByText("Square Share gave your store Pro").first()).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText("Your Starter plan from Square Share was updated").first()).toBeVisible();

  // --- And the second, back on Free --------------------------------------------------
  await b.page.goto("/settings/billing");
  await expect(b.page.locator("[data-billing-plan]")).toHaveAttribute("data-billing-plan", "free", { timeout: 30_000 });

  await Promise.all([a.context.close(), b.context.close(), staffContext.close()]);
});
