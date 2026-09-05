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

/**
 * The toast a completed action raises. Every save, upload, invite and delete
 * in the dashboard reports through this one channel, so specs assert on it
 * rather than hunting for a per-screen status line.
 *
 * `toBeVisible` on purpose: a confirmation that exists in the DOM but is
 * hidden at the current viewport is not a confirmation. The storefront header
 * used to hide its "Saved." at phone widths, which is the regression this
 * shape guards against.
 */
export function toast(page: Page, text: RegExp | string) {
  return page
    .getByRole("region", { name: "Notifications" })
    .getByText(text)
    .first();
}

/** Wait for a confirmation toast carrying `text`. */
export async function expectToast(
  page: Page,
  text: RegExp | string,
  timeout = 20_000,
) {
  await expect(toast(page, text)).toBeVisible({ timeout });
}

/**
 * Wait until the designer's board has stopped moving.
 *
 * The canvas EASES into place when a panel opens over it (see useCanvasAnchor:
 * a floating panel that lands on the board makes the board step out from under
 * it), so a spec that measures a tile and then presses on it has to let that
 * finish, or the press lands where the tile used to be. A person opening a
 * panel and then reaching for the canvas takes far longer than this; a spec
 * does it in tens of milliseconds.
 */
export async function canvasStill(page: Page, timeout = 3_000) {
  const read = () =>
    page.evaluate(
      () =>
        (document.querySelector("[data-canvas-stage]") as HTMLElement | null)
          ?.style.transform ?? "",
    );
  const deadline = Date.now() + timeout;
  let last = await read();
  while (Date.now() < deadline) {
    await page.waitForTimeout(80);
    const now = await read();
    if (now === last) return;
    last = now;
  }
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

/**
 * Create a storefront through the UI and land in its designer.
 *
 * "New storefront" opens the setup flow rather than inserting a row, so every
 * spec that just needs A storefront takes the skip path. The flow itself is
 * covered by 09-storefront-setup.spec.ts; repeating it here would only make
 * unrelated specs fail when the questions change.
 */
export async function createStorefrontViaUI(page: Page) {
  await page
    .getByRole("button", { name: /new storefront|create storefront/i })
    .first()
    .click();
  await page.getByRole("button", { name: /skip setup/i }).click();
  await page.waitForURL(/\/storefront\/[0-9a-f-]{36}/, { timeout: 30_000 });
}

/** Unique-per-run credentials so specs never collide on the shared DB. */
export function freshUser(tag: string) {
  counter += 1;
  return {
    email: `${tag}-${Date.now()}-${counter}@e2e.squareshare.to`,
    password: "e2e-password-123",
    // Sign-up also claims a handle: letters/numbers/underscores, 3-30 chars,
    // and never one of the reserved words (several spec tags — "orders",
    // "products", "team" — are reserved, hence the prefix).
    username: `e2e_${tag.replace(/[^a-z0-9]/gi, "").slice(0, 8)}_${
      Date.now() % 1_000_000_000
    }${counter}`.toLowerCase(),
  };
}

type TestUser = { email: string; password: string; username?: string };

/**
 * Fill the login form's identity field.
 *
 * The field is `identifier` (it takes an email OR a username on sign-in); the
 * `email` fallback keeps this working against older builds of the form.
 */
async function fillIdentifier(page: Page, value: string) {
  await page
    .locator('input[name="identifier"], input[name="email"]')
    .first()
    .fill(value);
}

/**
 * Forget the per-client auth budgets before an auth step.
 *
 * Sign-up and sign-in are rate limited PER CLIENT, and every spec in this
 * suite is the same client (127.0.0.1) creating yet another fresh user. A run
 * of 40+ specs therefore spends a production HOUR's budget in a few minutes,
 * after which every remaining spec sits on the login form until it times out —
 * a failure that says nothing about the code under test.
 *
 * The limits themselves are deliberately left at their production values; only
 * the ledger is cleared, and only between specs. The limiter's own behaviour is
 * covered by unit tests, which can drive it directly rather than through 40
 * unrelated user journeys.
 */
export async function clearAuthRateLimits() {
  await serviceRest("/rate_limit_keys?key=not.is.null", { method: "DELETE" });
}

/** Sign up through the real UI; lands on the dashboard. */
export async function signUp(page: Page, user: TestUser) {
  await clearAuthRateLimits();
  await page.goto("/login");
  // The mode tabs are client state: a click that lands before hydration leaves
  // the form in sign-in mode, where the sign-up-only fields never exist. Retry
  // the tab until they do.
  await expect(async () => {
    await page.getByRole("button", { name: /^sign up$/i }).first().click();
    await expect(page.locator('input[name="confirm_password"]')).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
  await fillIdentifier(page, user.email);
  // Sign-up claims a handle too; older builds of the form have no such field.
  const username = page.locator('input[name="username"]');
  if (await username.count()) {
    await username.fill(user.username ?? `e2e_${Date.now() % 1_000_000_000}`);
  }
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('input[name="confirm_password"]').fill(user.password);
  await page.locator('button[name="intent"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Sign in through the real UI. */
export async function signIn(page: Page, user: TestUser) {
  await clearAuthRateLimits();
  await page.goto("/login");
  await fillIdentifier(page, user.email);
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

/**
 * Seed products straight into the database for an owner.
 *
 * Use this when a spec needs a product to EXIST but is not testing the product
 * form — `createProductViaUI` drives a multi-field form and, on a mobile
 * viewport especially, makes an unrelated spec fail for reasons that say
 * nothing about what it was checking.
 */
export async function seedProducts(
  ownerId: string,
  products: Array<{
    title: string;
    price_cents?: number;
    status?: "active" | "draft";
    /**
     * An https:// URL here is served straight through by presignGetUrl (the
     * path dev seed data uses), which is the only way to give a product a
     * picture without R2 credentials — the e2e stack deliberately has none.
     * Only service_role writes can put a URL in this column; every app write
     * validates it against OBJECT_KEY_PATTERN.
     */
    image_key?: string;
    description?: string;
    /** Product page facts. Same https:// passthrough applies to gallery keys. */
    gallery?: Array<{ key: string; alt: string; optionId?: string }>;
    option_groups?: Array<{
      id: string;
      name: string;
      display: "swatch" | "chip" | "select";
      options: Array<{ id: string; name: string; swatch?: string; available: boolean }>;
    }>;
    details?: Record<string, unknown>;
    documents?: Array<{ key: string; label: string }>;
    purchase_url?: string;
    digital_file_key?: string;
    /** Which of the storefront config's shippingProfiles this ships under.
     *  Absent = the store's default terms, which is the common case. */
    shipping_profile_id?: string;
  }>,
) {
  // Every row carries the SAME keys: PostgREST refuses a bulk insert whose
  // objects differ ("All object keys must match"), so optional columns are
  // written as their defaults rather than left out.
  await serviceRest(`/products`, {
    method: "POST",
    body: products.map((p) => ({
      owner_id: ownerId,
      title: p.title,
      price_cents: p.price_cents ?? 1000,
      currency: "EUR",
      status: p.status ?? "active",
      image_key: p.image_key ?? null,
      description: p.description ?? null,
      gallery: p.gallery ?? [],
      option_groups: p.option_groups ?? [],
      details: p.details ?? {},
      documents: p.documents ?? [],
      purchase_url: p.purchase_url ?? null,
      digital_file_key: p.digital_file_key ?? null,
      shipping_profile_id: p.shipping_profile_id ?? null,
    })),
  });
}

/** Seed storefronts straight into the database for an owner. Same reasoning
 *  as seedProducts: specs that need one to EXIST shouldn't drive the UI. */
export async function seedStorefronts(
  ownerId: string,
  storefronts: Array<{ name: string }>,
) {
  await serviceRest(`/storefronts`, {
    method: "POST",
    body: storefronts.map((s) => ({ owner_id: ownerId, name: s.name })),
  });
}

/**
 * Seed an account's trader identity straight onto its profile row — the
 * account-level fields the hosted product page's Seller section (and every
 * storefront's product pages) now read (lib/settings/seller-identity.ts).
 * The signup trigger already created the row; this only patches it.
 */
export async function seedSellerIdentity(
  ownerId: string,
  seller: {
    businessName?: string;
    address?: string;
    email?: string;
    vatId?: string;
    country?: string;
    phone?: string;
  },
) {
  await serviceRest(`/profiles?id=eq.${ownerId}`, {
    method: "PATCH",
    body: {
      tax_business_name: seller.businessName ?? null,
      seller_address: seller.address ?? null,
      seller_email: seller.email ?? null,
      tax_vat_id: seller.vatId ?? null,
      tax_country: seller.country ?? null,
      seller_phone: seller.phone ?? null,
    },
  });
}

/**
 * Seed analytics signals for a seller (service-written, like the ingest route).
 *
 * `daysAgo` places a row in the past so a spec can exercise the 30-day window
 * and the trend series rather than a single spike on today. Everything else
 * mirrors what recordSignal writes.
 */
export async function seedSignals(
  accountId: string,
  signals: Array<{
    kind: "storefront_view" | "product_click" | "email_signup" | "booking";
    storefrontId?: string;
    channel?: "embed" | "marketplace" | "direct";
    visitorHash?: string;
    valueCents?: number;
    daysAgo?: number;
  }>,
) {
  const dayMs = 24 * 60 * 60 * 1000;
  await serviceRest(`/storefront_signals`, {
    method: "POST",
    body: signals.map((signal, index) => ({
      account_id: accountId,
      kind: signal.kind,
      channel: signal.channel ?? "embed",
      ...(signal.storefrontId ? { storefront_id: signal.storefrontId } : {}),
      // 64 hex chars, matching the column's CHECK on a real digest.
      visitor_hash:
        signal.visitorHash ?? String(index % 5).repeat(64).slice(0, 64),
      ...(signal.valueCents !== undefined
        ? { value_cents: signal.valueCents, currency: "EUR" }
        : {}),
      occurred_at: new Date(
        Date.now() - (signal.daysAgo ?? 1) * dayMs,
      ).toISOString(),
    })),
  });
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
    /** Which version was bought, snapshotted in words the way the real column
     *  stores it: [{ label: "Size", value: "Six seater" }]. */
    selected_options?: { label: string; value: string }[];
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
      // Always present, never conditional: PostgREST refuses a bulk insert
      // whose objects do not share their keys.
      selected_options: o.selected_options ?? [],
      ...(o.created_at ? { created_at: o.created_at } : {}),
    })),
  });
}
