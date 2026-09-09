import { expect, test } from "@playwright/test";
import {
  expectToast,
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedSellerIdentity,
  signUp,
  userIdByEmail,
} from "./helpers";

test.describe("products CRUD", () => {
  test("add → list → edit → delete a product", async ({ page }) => {
    const user = freshUser("products");
    await signUp(page, user);

    // --- create ---
    // gotoApp, not a bare goto: a click that lands before hydration is
    // swallowed by React's event replay rather than following the href, so the
    // navigation simply never happens and the failure looks like a broken
    // link. Same reason every form page in this suite uses it.
    await gotoApp(page, "/products");
    await page.getByRole("link", { name: /add product/i }).first().click();
    await page.waitForURL(/\/products\/new/);

    await page.getByLabel("Title").fill("E2E Print");
    await page.getByLabel(/price/i).fill("14.00");
    await page.getByRole("button", { name: /save product/i }).click();

    await page.waitForURL(/\/products$/, { timeout: 20_000 });
    // The CARD, by its heading. Bare text would also match the "saved" toast
    // riding along from the form, which quotes the title back at you.
    await expect(page.getByRole("heading", { name: "E2E Print" })).toBeVisible();
    await expect(page.getByText("€14.00")).toBeVisible();
    await expectToast(page, /e2e print/i);

    // --- edit ---
    await page.getByRole("link", { name: "Edit E2E Print" }).click();
    await page.waitForURL(/\/edit/);
    await page.getByLabel("Title").fill("E2E Print v2");
    await page.getByLabel(/price/i).fill("21.50");
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForURL(/\/products$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "E2E Print v2" })).toBeVisible();
    await expect(page.getByText("€21.50")).toBeVisible();

    // --- delete ---
    await page.getByRole("button", { name: "Delete E2E Print v2" }).click();
    // The confirm step is REQUIRED, not "take it if it happens to be there".
    // The optional version silently passed while never confirming anything,
    // because its /^delete$/ never matched the real button ("Delete product").
    await page.getByRole("button", { name: "Delete product" }).click();
    // The CARD has to go. Matching on bare text would also match the confirm
    // dialog's copy, which quotes the title back at you.
    await expect(page.getByRole("heading", { name: "E2E Print v2" })).toBeHidden({
      timeout: 15_000,
    });
  });

  test("client validation blocks an empty title and bad price", async ({ page }) => {
    const user = freshUser("prodval");
    await signUp(page, user);
    await page.goto("/products/new");

    await page.getByRole("button", { name: /save product/i }).click();
    await expect(page.getByText(/give your product a title|title/i).first()).toBeVisible();

    await page.getByLabel("Title").fill("Priced wrong");
    await page.getByLabel(/price/i).fill("0");
    await page.getByRole("button", { name: /save product/i }).click();

    // A blocked save is still said in BOTH places, and that is still the
    // point: the field says which one is wrong, and the action bar says how
    // many there are. What changed is WHERE the second half lives. It used to
    // be a toast, which on this form rendered on top of the Save button the
    // seller had just pressed; it is now the summary inside the sticky action
    // bar, which is next to Save rather than over it and cannot be dismissed
    // by accident. `role="alert"` keeps it announced, which is what the toast's
    // live region used to do.
    await expect(
      page.locator("form").getByText(/price must be a number greater than zero/i),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").getByText(/thing(s)? to fix before saving/i),
    ).toBeVisible();
    // Still on the form: nothing was saved.
    await expect(page).toHaveURL(/\/products\/new/);
  });

  test("required fields carry a red star, and the blocked-save summary jumps to the first one", async ({
    page,
  }) => {
    const user = freshUser("reqstar");
    await signUp(page, user);
    await page.goto("/products/new");

    // Title and Price are the two fields a product can never be saved
    // without, and the star sits on each of them, not on the section they
    // share — nothing else on a fresh form is required yet.
    const stars = page.locator('form span[aria-hidden="true"]').filter({ hasText: /^\*$/ });
    await expect(stars).toHaveCount(2);
    // The label itself must stay exactly "Title" — the star lives beside it,
    // not inside it, so the field's accessible name is unaffected.
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();

    // Leave everything empty and try to save: both fields are wrong, so the
    // summary should count both and offer a route to whichever comes first.
    await page.getByRole("button", { name: /save product/i }).click();

    const summary = page.getByRole("alert");
    await expect(summary.getByText(/2 things to fix before saving/i)).toBeVisible();
    await summary.getByRole("button", { name: /jump to first/i }).click();

    // The jump scrolls first and focuses a beat later, so the field is
    // deliberately not focused on the same tick as the click.
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused({
      timeout: 5_000,
    });
  });

  test("only draft status shows an indicator on the product card", async ({ page }) => {
    const user = freshUser("prodstatus");
    await signUp(page, user);
    // This test is about the BADGE, so the seller has to be one who may
    // publish: without the trader details the publish gate defaults a new
    // product to draft and bars Active outright, and every card would carry
    // the dot. (The gate itself is 50-publish-gate.spec.ts.)
    await seedSellerIdentity(await userIdByEmail(user.email), PUBLISHABLE_SELLER);

    // Active is the default and expected state, so it gets no badge at all.
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Active thing");
    await page.getByLabel(/price/i).fill("5");
    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/);
    await expect(page.getByRole("heading", { name: "Active thing" })).toBeVisible();
    // The badge is the WORD, not a dot with a title attribute (StatusBadge.tsx
    // stopped being a hollow circle: a grey dot needed prior knowledge, the
    // word does not). Exact text, so the card's own heading "Draft thing" and
    // the toast quoting it are not mistaken for the badge.
    await expect(page.getByText("Active", { exact: true })).toHaveCount(0);

    // Draft is the exception worth flagging, so it alone gets the dot.
    await gotoApp(page, "/products/new");
    await page.getByLabel("Title").fill("Draft thing");
    await page.getByLabel(/price/i).fill("5");
    await page.getByRole("button", { name: "Draft" }).click();
    await page.getByRole("button", { name: /save product/i }).click();
    await page.waitForURL(/\/products$/);
    await expect(page.getByRole("heading", { name: "Draft thing" })).toBeVisible();
    // Exactly one badge: the draft card's. The active card still has none.
    await expect(page.getByText("Draft", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  });
});
