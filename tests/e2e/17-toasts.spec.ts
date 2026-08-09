import { expect, test, type Page } from "@playwright/test";
import { expectToast, fillStable, freshUser, gotoApp, signUp, toast } from "./helpers";

/**
 * The confirmation channel, end to end.
 *
 * Component tests pin the toast's own mechanics; what only a real browser can
 * show is that a server action's result actually reaches it — through a form
 * submission, a revalidation and, in one case, a navigation to another page.
 *
 * One account, shared across the file: sign-ups are rate limited per client,
 * so a fresh user per test would fail for reasons unrelated to toasts.
 */

test.describe.configure({ mode: "serial" });

let page: Page;
let handle: string;

const notifications = () => page.getByRole("region", { name: "Notifications" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  const user = freshUser("toasts");
  handle = user.username;
  await signUp(page, user);
  await page.waitForLoadState("networkidle").catch(() => {});
});

test.afterAll(async () => {
  await page?.close();
});

test.describe("toasts", () => {
  test("a settings save is confirmed, and confirmed only once", async () => {
    await gotoApp(page, "/settings/account");
    const next = `${handle}x`.slice(-20);
    await fillStable(page, /username/i, next);
    await page.getByRole("button", { name: /^save$/i }).first().click();

    await expectToast(page, /username saved/i);
    // Exactly one. The button's own green state is the local confirmation and
    // the toast carries the words; a third inline "saved" line was the
    // duplication this replaced.
    await expect(notifications().getByRole("status")).toHaveCount(1);
    handle = next;
  });

  test("it goes on its own, without being dismissed", async () => {
    // Success lasts 4s. Waiting well past that proves the stack empties itself
    // rather than piling up behind the user.
    await expect(notifications().getByRole("status")).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test("hovering it stops the clock", async () => {
    await gotoApp(page, "/settings/notifications");
    await page.getByRole("button", { name: /^save$/i }).first().click();
    const row = notifications().getByRole("status").first();
    await expect(row).toBeVisible();

    await row.hover();
    // Twice its lifetime with the pointer on it. A message being read must not
    // expire mid-sentence.
    await page.waitForTimeout(8_000);
    await expect(row).toBeVisible();
  });

  test("the dismiss button closes it immediately", async () => {
    const row = notifications().getByRole("status").first();
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(notifications().getByRole("status")).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test("a refusal arrives as an error, not a success", async () => {
    await gotoApp(page, "/settings/account");
    // Moving the account's email is takeover-grade, so it re-authenticates.
    // A wrong password is a server-side refusal — the one failure this suite
    // can provoke without breaking the account it is running on.
    await fillStable(page, /new email/i, `moved-${Date.now()}@e2e.squareshare.to`);
    await page.getByLabel(/current password/i).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /send confirmation link/i }).click();

    await expectToast(page, /current password is incorrect/i);
    // role=alert, not role=status: a failed action interrupts rather than
    // queueing politely behind whatever the screen reader is already saying.
    await expect(notifications().getByRole("alert")).toBeVisible();
  });

  test("a client-side rejection reports through the same channel", async () => {
    await gotoApp(page, "/settings/account");
    // 3 MB of bytes against a 2 MB cap: refused in the browser, before any
    // request. It used to print beside a visually hidden file input.
    await page.setInputFiles('input[type="file"]', {
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(3 * 1024 * 1024, 1),
    });
    await expectToast(page, /too large/i);
    await expect(notifications().getByRole("alert")).toBeVisible();
  });

  test("it survives the navigation it is confirming", async () => {
    await gotoApp(page, "/products/new");
    await fillStable(page, "Title", "Toasted Print");
    await fillStable(page, /price/i, "11.00");
    await page.getByRole("button", { name: /save product/i }).click();

    // The form redirects to /products on success. The provider lives at the
    // root layout precisely so the confirmation lands on the page the seller
    // ends up on, rather than dying with the form that raised it.
    await page.waitForURL(/\/products$/, { timeout: 30_000 });
    await expect(toast(page, /toasted print/i)).toBeVisible({ timeout: 10_000 });
  });

  test("a delete says what went, since the card is the only other evidence", async () => {
    await page.getByRole("button", { name: "Delete Toasted Print" }).click();
    await page.getByRole("button", { name: "Delete product" }).click();

    await expectToast(page, /toasted print.*deleted/i);
    await expect(
      page.getByRole("heading", { name: "Toasted Print" }),
    ).toBeHidden({ timeout: 15_000 });
  });
});
