import { expect, test, type Page } from "@playwright/test";
import {
  PUBLISHABLE_SELLER,
  devEmails,
  expectToast,
  freshUser,
  gotoApp,
  seedOrders,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";

/**
 * ACCOUNT DELETION, end to end: the request a seller makes in Settings, and
 * the scheduled job that carries it out (src/lib/account-deletion).
 *
 *   - Asking records a request, says when it will happen (on the page and in
 *     the account's own inbox), and can be undone until the job begins.
 *   - The job is started only by the holder of the scheduler's secret.
 *   - A due account is deleted whole: store, orders and sign-in. An account
 *     that is not due, or was never asked about, is untouched.
 *   - An account that still owes a buyer something is kept, and its owner is
 *     told what the deletion is waiting for.
 *   - A big account goes a bounded piece at a time, and once that has begun
 *     there is no changing one's mind.
 *
 * The stack sets a fixed CRON_SECRET (tests/e2e/stack/server.mjs), so a spec
 * starts a run the way the scheduler does.
 */

const CRON_SECRET = "e2e-cron-secret-not-a-real-one-0123456789";
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

type RunResult = { deleted: number; inProgress: number; held: number; failed: number; more: boolean };

/** One run of the job, as the scheduler starts it. */
async function runOnce(page: Page, secret = CRON_SECRET) {
  return page.request.post("/api/cron/account-deletions", { headers: { authorization: `Bearer ${secret}` } });
}

/** Run until the job says there is nothing more to do right now, as the
 *  scheduler does. Answers with every run's result. */
async function runToTheEnd(page: Page): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await runOnce(page);
    expect(response.status()).toBe(200);
    const result = (await response.json()) as RunResult;
    runs.push(result);
    if (!result.more) return runs;
  }
  throw new Error("the deletion job never said it was done");
}

type Seller = { id: string; email: string };

async function newSeller(page: Page, tag: string): Promise<Seller> {
  const user = freshUser(tag);
  await signUp(page, user);
  return { id: await userIdByEmail(user.email), email: user.email };
}

/** Record a request the way the server action does, dated as given. */
async function requestDeletion(seller: Seller, requestedAt: string) {
  await serviceRest("/account_deletion_requests", {
    method: "POST",
    body: { user_id: seller.id, requested_at: requestedAt },
  });
}

const rowsOf = async (table: string, column: string, id: string) =>
  ((await serviceRest(`/${table}?${column}=eq.${id}&select=${column}`)) as unknown[]).length;

const requestOf = async (seller: Seller) =>
  ((await serviceRest(`/account_deletion_requests?user_id=eq.${seller.id}&select=requested_at,started_at`)) as {
    requested_at: string;
    started_at: string | null;
  }[])[0] ?? null;

test.describe("account deletion", () => {
  test("asking says when, in the page and the inbox, and can be undone", async ({ page }) => {
    test.setTimeout(180_000);
    const seller = await newSeller(page, "del-ask");

    await gotoApp(page, "/settings/danger");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByLabel(/to confirm/i).fill("delete my account");
    await page.getByRole("button", { name: "Permanently delete" }).click();
    await expectToast(page, /Deletion requested\./);

    // The request the job acts on exists, dated by the server.
    const request = await requestOf(seller);
    expect(request).not.toBeNull();
    expect(request!.started_at).toBeNull();
    const deleteOn = new Date(new Date(request!.requested_at).getTime() + 14 * DAY_MS);
    // As the app writes a long date in English: "24 October 2026".
    const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(deleteOn);

    // The page says the day, and the account's own inbox hears it too.
    await expect(page.getByText("Deletion requested").first()).toBeVisible();
    await expect(page.getByText(new RegExp(`permanently deleted on ${longDate}`))).toBeVisible();
    await expect
      .poll(async () => (await devEmails(seller.email)).find((mail) => mail.subject.includes("scheduled for deletion"))?.text ?? "")
      .toContain(`permanently deleted on ${longDate}`);

    // Not due: a run leaves it exactly where it is.
    await runToTheEnd(page);
    expect(await rowsOf("profiles", "id", seller.id)).toBe(1);

    // And the seller can change their mind.
    await page.getByRole("button", { name: "Keep my account" }).click();
    await expectToast(page, /Deletion request cancelled/);
    expect(await requestOf(seller)).toBeNull();
    await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible();
  });

  test("only the scheduler can start a run", async ({ page }) => {
    expect((await runOnce(page, "not-the-secret-not-the-secret-not-the-secret")).status()).toBe(404);
    expect((await page.request.post("/api/cron/account-deletions")).status()).toBe(404);
    // Not a page either: nothing to find by browsing to it.
    expect((await page.request.get("/api/cron/account-deletions")).status()).toBeGreaterThanOrEqual(400);
    expect((await runOnce(page)).status()).toBe(200);
  });

  test("a due account is deleted whole; one that is not due is untouched", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const leaving = await newSeller(page, "del-due");
    await seedSellerIdentity(leaving.id, { ...PUBLISHABLE_SELLER, businessName: "Leaving Pottery" });
    await seedStorefronts(leaving.id, [{ name: "Leaving" }]);
    await seedProducts(leaving.id, [{ title: "Last vase", price_cents: 2400 }]);
    // An old, finished sale: nothing is owed on it any more.
    await seedOrders(leaving.id, [{ amount_cents: 2400, created_at: daysAgo(90), fulfilment_status: "shipped" }]);

    const context = await browser.newContext();
    const staying = await newSeller(await context.newPage(), "del-stay");
    await seedProducts(staying.id, [{ title: "Kept bowl", price_cents: 1800 }]);
    await context.close();

    await requestDeletion(leaving, daysAgo(15));
    await requestDeletion(staying, daysAgo(1));

    const runs = await runToTheEnd(page);
    expect(runs.reduce((sum, run) => sum + run.deleted, 0)).toBe(1);
    expect(runs.every((run) => run.failed === 0)).toBe(true);

    // Gone, all of it.
    for (const [table, column] of [
      ["profiles", "id"],
      ["products", "owner_id"],
      ["storefronts", "owner_id"],
      ["orders", "seller_id"],
      ["account_deletion_requests", "user_id"],
    ] as const) {
      expect(await rowsOf(table, column, leaving.id), table).toBe(0);
    }
    // The session that asked is a session for nobody now.
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    // And they are told it is done.
    await expect
      .poll(async () => (await devEmails(leaving.email)).some((mail) => mail.subject.includes("has been deleted")))
      .toBe(true);

    // The other account: asked a day ago, so not yet. Everything of theirs stands.
    expect(await rowsOf("profiles", "id", staying.id)).toBe(1);
    expect(await rowsOf("products", "owner_id", staying.id)).toBe(1);
    expect(await requestOf(staying)).not.toBeNull();
  });

  test("an account that still owes a buyer is kept, and its owner is told why", async ({ page }) => {
    test.setTimeout(240_000);
    const seller = await newSeller(page, "del-held");
    await seedOrders(seller.id, [{ amount_cents: 2400, created_at: daysAgo(40), fulfilment_status: "unfulfilled" }]);
    await requestDeletion(seller, daysAgo(20));

    const held = await runToTheEnd(page);
    expect(held.reduce((sum, run) => sum + run.deleted, 0)).toBe(0);
    expect(held[0].held).toBeGreaterThanOrEqual(1);
    expect(await rowsOf("profiles", "id", seller.id)).toBe(1);
    expect((await requestOf(seller))!.started_at).toBeNull();

    await gotoApp(page, "/settings/danger");
    await expect(page.locator("[data-deletion-holds~='toShip']")).toContainText("You still have orders to ship.");

    // The parcel goes out. Nothing is owed, and the sale is long past.
    await serviceRest(`/orders?seller_id=eq.${seller.id}`, {
      method: "PATCH",
      body: { fulfilment_status: "shipped", shipped_at: daysAgo(35) },
    });
    const done = await runToTheEnd(page);
    expect(done.reduce((sum, run) => sum + run.deleted, 0)).toBe(1);
    expect(await rowsOf("profiles", "id", seller.id)).toBe(0);
  });

  test("a big account goes a piece at a time, and cannot be kept once that has begun", async ({ page }) => {
    test.setTimeout(240_000);
    const seller = await newSeller(page, "del-big");
    // Thirty products, each pointing at a stored photo: more than one run's worth.
    const photo = (index: number) =>
      `images/${seller.id}/00000000-0000-4000-8000-${String(index).padStart(12, "0")}-photo.png`;
    await seedProducts(
      seller.id,
      Array.from({ length: 30 }, (_, index) => ({
        title: `Piece ${index + 1}`,
        price_cents: 1000,
        image_key: photo(index),
      })),
    );
    await requestDeletion(seller, daysAgo(15));

    const first = (await (await runOnce(page)).json()) as RunResult;
    expect(first).toMatchObject({ deleted: 0, inProgress: 1, more: true });
    const left = await rowsOf("products", "owner_id", seller.id);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(30);
    expect((await requestOf(seller))!.started_at).not.toBeNull();

    // Half a shop is not something to keep: the page offers no way back.
    await gotoApp(page, "/settings/danger");
    await expect(page.getByText("This account is being deleted now.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep my account" })).toHaveCount(0);

    const rest = await runToTheEnd(page);
    expect(rest.reduce((sum, run) => sum + run.deleted, 0)).toBe(1);
    expect(await rowsOf("products", "owner_id", seller.id)).toBe(0);
    expect(await rowsOf("profiles", "id", seller.id)).toBe(0);
  });
});
