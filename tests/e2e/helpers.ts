import { expect, type Page } from "@playwright/test";
import { ANON_KEY, GATEWAY_URL, SERVICE_KEY } from "./stack/keys.mjs";

let counter = 0;

/**
 * Navigate and wait until the page is idle (dev-mode compiles + hydration).
 * Filling a controlled React input before hydration gets silently reverted,
 * so specs should use this instead of bare page.goto for form pages.
 */
export async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Fill an input and verify the value stuck (guards against hydration wipes). */
export async function fillStable(page: Page, label: string | RegExp, value: string) {
  await expect(async () => {
    const field = page.getByLabel(label);
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Create a product through the UI (assumes signed-in session). */
export async function createProductViaUI(
  page: Page,
  { title, price }: { title: string; price: string },
) {
  await gotoApp(page, "/products/new");
  await fillStable(page, "Title", title);
  await fillStable(page, /price/i, price);
  await page.getByRole("button", { name: /save product/i }).click();
  await page.waitForURL(/\/products$/, { timeout: 30_000 });
}

/** Unique-per-run credentials so specs never collide on the shared DB. */
export function freshUser(tag: string) {
  counter += 1;
  return {
    email: `${tag}-${Date.now()}-${counter}@e2e.squareshare.to`,
    password: "e2e-password-123",
  };
}

/** Sign up through the real UI; lands on the dashboard. */
export async function signUp(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('input[name="confirm_password"]').fill(user.password);
  await page.locator('button[name="intent"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Sign in through the real UI. */
export async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[name="intent"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Service-role REST call against the local stack (seeding/verification). */
export async function serviceRest(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(`${GATEWAY_URL}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  expect(res.ok, `service REST ${path} -> ${res.status}: ${text}`).toBe(true);
  return json;
}

/** Anon-key REST call — what a public/embed consumer could do. */
export async function anonRest(path: string) {
  const res = await fetch(`${GATEWAY_URL}/rest/v1${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

/** Resolve a user id by email via service role (test-only convenience). */
export async function userIdByEmail(email: string): Promise<string> {
  const rows = (await serviceRest(
    `/rpc/user_id_by_email`,
    { method: "POST", body: { p_email: email } },
  )) as string | null;
  expect(rows, `no user for ${email}`).toBeTruthy();
  return rows as string;
}

/** Seed a batch of orders for a seller (service-written, like the real webhook). */
export async function seedOrders(
  sellerId: string,
  orders: Array<{
    amount_cents: number;
    channel?: "embed" | "marketplace";
    status?: "paid" | "refunded" | "disputed" | "pending";
    buyer_email?: string;
    product_title?: string;
    created_at?: string;
  }>,
) {
  await serviceRest(`/orders`, {
    method: "POST",
    body: orders.map((o) => ({
      seller_id: sellerId,
      channel: o.channel ?? "embed",
      status: o.status ?? "paid",
      amount_cents: o.amount_cents,
      platform_fee_cents: Math.round(o.amount_cents * 0.05),
      currency: "EUR",
      buyer_email: o.buyer_email ?? "buyer@example.com",
      product_title: o.product_title ?? "Seeded product",
      product_price_cents: o.amount_cents,
      ...(o.created_at ? { created_at: o.created_at } : {}),
    })),
  });
}
