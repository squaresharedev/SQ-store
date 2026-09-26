import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectToast, freshUser, gotoApp, serviceRest, signUp, userIdByEmail } from "./helpers";

/**
 * THE NOTIFICATION HISTORY: filtering, and acting on a notification.
 *
 *   FILTERS. All / Unread plus a category, in the URL and applied by the
 *   server. The sharp case is a match that sits BEYOND the first page: a
 *   client-side filter over the rows already loaded would call that view
 *   empty.
 *
 *   ACTIONS, level 1. Every row opens the page its subject lives on.
 *
 *   ACTIONS, level 2. A team invite is accepted from the row itself, in the
 *   page and in the bell's dropdown, through the same checks as the Team &
 *   access page, and the result is the real membership.
 */

type SeedRow = {
  type: string;
  title: string;
  body?: string;
  read?: boolean;
  created_at?: string;
  data?: Record<string, unknown>;
};

async function seedNotifications(userId: string, rows: SeedRow[]) {
  // A bulk insert needs every object to carry the same keys, so each row is
  // spelled out in full rather than spread over defaults.
  await serviceRest("/notifications", {
    method: "POST",
    body: rows.map((row) => ({
      user_id: userId,
      type: row.type,
      title: row.title,
      body: row.body ?? null,
      read: row.read ?? false,
      created_at: row.created_at ?? new Date().toISOString(),
      data: row.data ?? {},
    })),
  });
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** The rows of the page's own list: the list after the filter bar (the
 *  bell's dropdown, when open, is a separate dialog). */
const rows = (page: Page) =>
  page.locator('[role="search"] ~ div [data-notification-id]');

async function invite(ownerPage: Page, email: string, role: "editor" | "viewer") {
  await gotoApp(ownerPage, "/settings/team");
  await ownerPage.getByRole("button", { name: /invite member/i }).click();
  await ownerPage.getByLabel(/email address/i).fill(email);
  await ownerPage.getByRole("combobox").click();
  await ownerPage.getByRole("option", { name: new RegExp(`^${role}`, "i") }).click();
  await ownerPage.getByRole("button", { name: /send invite/i }).click();
  await expect(ownerPage.getByText(email).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("notification history: filters", () => {
  test("filters by category and unread in the URL, and every row opens its page", async ({ page }) => {
    const user = freshUser("notif-filter");
    await signUp(page, user);
    const id = await userIdByEmail(user.email);

    await seedNotifications(id, [
      {
        type: "security",
        title: "Your password was changed",
        created_at: ago(1_000),
        data: { href: "/settings/account#password" },
      },
      // No href of its own: opens its category's page.
      { type: "security", title: "Two-factor authentication is on", read: true, created_at: ago(2_000) },
      { type: "team", title: "Alex joined your team", created_at: ago(3_000), data: { href: "/settings/team" } },
      { type: "system", title: "Scheduled maintenance tonight", read: true, created_at: ago(4_000) },
    ]);

    await gotoApp(page, "/notifications");
    await expect(rows(page)).toHaveCount(4);

    // Only the categories this reader actually has are offered.
    const filterBar = page.getByRole("search", { name: "Filter notifications" });
    await filterBar.getByRole("button", { name: "All categories" }).click();
    const menu = page.getByRole("listbox", { name: "Category" });
    await expect(menu.getByRole("option")).toHaveText(["All categories", "Team", "System", "Security"]);

    await menu.getByRole("option", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/notifications\?type=security$/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toHaveAttribute("data-notification-type", "security");

    // The Unread count is the one for THIS category.
    const unread = filterBar.getByRole("button", { name: /^Unread/ });
    await expect(unread).toHaveText("Unread1");
    await unread.click();
    await expect(page).toHaveURL(/type=security&status=unread/);
    await expect(rows(page)).toHaveCount(1);
    await expect(unread).toHaveAttribute("aria-pressed", "true");

    // A reload keeps the view: it lives in the URL. (Settled before the click
    // below: a click that lands mid-hydration is swallowed on every page.)
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(rows(page)).toHaveCount(1);

    // Level 1: the row opens where its subject lives, and is read from then on.
    await rows(page).getByRole("link", { name: /password was changed/i }).click();
    await expect(page).toHaveURL(/\/settings\/account#password$/);
    await expect
      .poll(async () => {
        const [row] = (await serviceRest(
          `/notifications?user_id=eq.${id}&title=eq.Your%20password%20was%20changed&select=read`,
        )) as { read: boolean }[];
        return row?.read;
      })
      .toBe(true);

    // A row without a link of its own opens its category's page.
    await gotoApp(page, "/notifications?type=security");
    await expect(
      rows(page).getByRole("link", { name: /two-factor authentication is on/i }),
    ).toHaveAttribute("href", "/settings/security");

    // A view with nothing in it says so, and offers the way back.
    await gotoApp(page, "/notifications?type=system&status=unread");
    await expect(page.getByText("No notifications match")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(rows(page)).toHaveCount(4);
  });

  test("a filtered view finds a match that sits beyond the first page", async ({ page }) => {
    const user = freshUser("notif-page");
    await signUp(page, user);
    const id = await userIdByEmail(user.email);

    // One policy notice, OLDER than a full page and more of team activity.
    await seedNotifications(id, [
      {
        type: "policy",
        title: 'Your product "Old lamp" was removed',
        created_at: ago(60 * 60 * 1000),
        data: { href: "/products" },
      },
      ...Array.from({ length: 24 }, (_, i) => ({
        type: "team",
        title: `Teammate ${i} joined your team`,
        read: true,
        created_at: ago(1_000 + i * 1_000),
      })),
    ]);

    await gotoApp(page, "/notifications");
    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByText(/Old lamp/)).toHaveCount(0);

    await gotoApp(page, "/notifications?type=policy");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Old lamp");

    // And "load more" keeps to the filter.
    await gotoApp(page, "/notifications?type=team");
    await expect(rows(page)).toHaveCount(20);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(rows(page)).toHaveCount(24);
    await expect(page.getByText(/Old lamp/)).toHaveCount(0);
  });
});

test.describe("notification actions: accept a team invite in place", () => {
  test("invite, then Accept on the notification: the membership is real", async ({ browser }) => {
    test.setTimeout(150_000);
    const owner = freshUser("nf-owner");
    const member = freshUser("nf-member");

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signUp(ownerPage, owner);
    const ownerId = await userIdByEmail(owner.email);

    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signUp(memberPage, member);
    const memberId = await userIdByEmail(member.email);

    await invite(ownerPage, member.email, "viewer");

    // The notification carries its invite, so it can be acted on in place.
    const [stored] = (await serviceRest(
      `/notifications?user_id=eq.${memberId}&type=eq.team&select=data`,
    )) as { data: { action?: { kind: string; accountOwnerId: string } } }[];
    expect(stored.data.action).toMatchObject({ kind: "team.acceptInvite", accountOwnerId: ownerId });

    await gotoApp(memberPage, "/notifications");
    const row = rows(memberPage).filter({ hasText: "You have a team invite" });
    await expect(row).toContainText(owner.username);

    // No serious a11y violations with the filter bar and an action on screen.
    const axe = await new AxeBuilder({ page: memberPage }).exclude("nextjs-portal").analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

    await row.getByRole("button", { name: "Accept" }).click();
    await expectToast(memberPage, "Welcome to the team.");
    await expect(row.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Accept" })).toHaveCount(0);
    // Accepting did not also open the row.
    await expect(memberPage).toHaveURL(/\/notifications$/);
    // The bell caught up at once: the invite was its only unread row.
    await expect(
      memberPage.getByRole("button", { name: "Notifications", exact: true }).first(),
    ).toBeVisible();

    // The real thing happened: an active membership, and the owner was told.
    const [membershipRow] = (await serviceRest(
      `/team_members?account_owner_id=eq.${ownerId}&member_user_id=eq.${memberId}&select=status,role`,
    )) as { status: string; role: string }[];
    expect(membershipRow).toEqual({ status: "active", role: "viewer" });
    await expect
      .poll(async () =>
        ((await serviceRest(
          `/notifications?user_id=eq.${ownerId}&type=eq.team&select=title`,
        )) as { title: string }[]).map((n) => n.title),
      )
      .toContain(`${member.username} joined your team`);
    // ...and the invite row is read, since it was acted on.
    const [readBack] = (await serviceRest(
      `/notifications?user_id=eq.${memberId}&type=eq.team&select=read`,
    )) as { read: boolean }[];
    expect(readBack.read).toBe(true);

    // The next step, straight from the row: open the store just joined.
    await row.getByRole("button", { name: "Open store" }).click();
    await expect(memberPage).toHaveURL(/\/dashboard/);
    await expect(memberPage.getByRole("button", { name: /back to your store/i })).toBeVisible({
      timeout: 20_000,
    });

    // After a fresh load the row remembers, from live state, that it is done.
    await gotoApp(memberPage, "/notifications");
    await expect(row.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Accept" })).toHaveCount(0);

    await ownerCtx.close();
    await memberCtx.close();
  });

  test("from the bell: an older invite notification is still acceptable, a gone one says so", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    // The inviting store only has to exist; it never has to act.
    const owner = freshUser("nf-legacy");
    const ownerCtx = await browser.newContext();
    await signUp(await ownerCtx.newPage(), owner);
    const ownerId = await userIdByEmail(owner.email);
    await ownerCtx.close();

    const member = freshUser("nf-bell");
    const memberCtx = await browser.newContext();
    const page = await memberCtx.newPage();
    await signUp(page, member);
    const memberId = await userIdByEmail(member.email);

    await serviceRest("/team_members", {
      method: "POST",
      body: { account_owner_id: ownerId, invited_email: member.email, role: "editor", status: "invited" },
    });
    await seedNotifications(memberId, [
      // Written before invites carried their id: only the keys and values.
      {
        type: "team",
        title: "You have a team invite",
        created_at: ago(1_000),
        data: {
          href: "/settings/team",
          message: {
            title: { key: "Notifications.messages.teamInvite.title" },
            body: {
              key: "Notifications.messages.teamInvite.body",
              values: { store: owner.username, role: "editor" },
            },
          },
        },
      },
      // An invite that no longer exists (revoked and gone).
      {
        type: "team",
        title: "You have a team invite",
        body: "gonestore invited you to join as Viewer.",
        created_at: ago(2_000),
        data: {
          href: "/settings/team",
          action: {
            kind: "team.acceptInvite",
            inviteId: "60000000-0000-4000-8000-000000000006",
            accountOwnerId: "60000000-0000-4000-8000-000000000066",
          },
        },
      },
    ]);

    await gotoApp(page, "/dashboard");
    await page.getByRole("button", { name: /notifications, 2 unread/i }).first().click();
    const dropdown = page.getByRole("dialog", { name: "Notifications" });
    const legacy = dropdown.locator("[data-notification-id]").filter({ hasText: owner.username });
    const gone = dropdown.locator("[data-notification-id]").filter({ hasText: "gonestore" });

    await expect(gone).toContainText("This invite is no longer available.");
    await expect(gone.getByRole("button", { name: "Accept" })).toHaveCount(0);

    await legacy.getByRole("button", { name: "Accept" }).click();
    await expectToast(page, "Welcome to the team.");
    await expect(legacy.getByText("Accepted", { exact: true })).toBeVisible();
    // The dropdown stays open on an in-place action: nothing navigated.
    await expect(dropdown).toBeVisible();

    const [membershipRow] = (await serviceRest(
      `/team_members?account_owner_id=eq.${ownerId}&member_user_id=eq.${memberId}&select=status,role`,
    )) as { status: string; role: string }[];
    expect(membershipRow).toEqual({ status: "active", role: "editor" });

    // Level 1 from the dropdown too: the row itself opens Team & access.
    await legacy.getByRole("link").click();
    await expect(page).toHaveURL(/\/settings\/team$/);

    await memberCtx.close();
  });
});
