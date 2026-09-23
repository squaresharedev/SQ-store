import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import {
  freshUser,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { ANON_KEY, GATEWAY_URL } from "./stack/keys.mjs";

/**
 * THE WHOLE MODERATION LOOP, ACROSS BOTH APPS.
 *
 *   buyer reports a product on SQ-store
 *     -> SQ-store pings the admin panel (lib/moderation/admin-ping.ts)
 *     -> staff get a push notification (decrypted and read here)
 *   staff open it in the admin panel, see the product, pause it with a note
 *     -> the seller gets a policy notification, and the note on the edit page
 *   the seller fixes it and presses "I've made the changes"
 *     -> staff get a second push notification, and it heads the queue
 *   staff approve it
 *     -> it is live again and the seller is told
 *
 * OPT-IN, because it needs the ADMIN PANEL running too, which this repo's
 * Playwright config does not start. To run it:
 *
 *   1. Start the stack with the ping configured:
 *        ADMIN_NOTIFY_URL=http://localhost:3201 ADMIN_NOTIFY_SECRET=e2e-scan \
 *          node tests/e2e/stack/server.mjs
 *   2. Start SQ-admin against it (its .env.e2e plus the three below):
 *        NOTIFY_SCAN_SECRET=e2e-scan STORE_APP_URL=http://localhost:3100 \
 *          NEXT_PUBLIC_APP_URL=http://localhost:3201 next dev -p 3201
 *   3. E2E_ADMIN_URL=http://localhost:3201 E2E_ADMIN_SCAN_SECRET=e2e-scan \
 *        npx playwright test 72-admin-moderation
 *
 * PUSH IS REAL except for the last hop: the spec registers a subscription
 * whose endpoint is a local HTTP server holding the private key, so the admin
 * panel encrypts and POSTs exactly what it would send Google or Apple, and
 * the spec decrypts it (RFC 8291) to read what staff would see.
 */

const ADMIN_URL = process.env.E2E_ADMIN_URL;
const SCAN_SECRET = process.env.E2E_ADMIN_SCAN_SECRET ?? "";
const DB_URL = "postgres://postgres:postgres@localhost:54322/sqstore_e2e";
const ADMIN_REPO = join(process.cwd(), "..", "Admin");

test.skip(!ADMIN_URL, "set E2E_ADMIN_URL to run the cross-app moderation spec");
test.describe.configure({ mode: "serial", timeout: 180_000 });

const THEME = {
  background: { kind: "solid", color: "#ffffff" },
  accent: "#171717",
  font: "sans",
  columns: 6,
  rows: 6,
  cornerRadius: 0,
  titleStyle: "bar",
  titleDisplay: "always",
  priceDisplay: "always",
  priceTagPosition: "below",
  showTitle: true,
  gridGap: 8,
  soldOutBadge: true,
  hideSoldOut: false,
};

const PRODUCT_PAGE = {
  enabled: true,
  layout: "gallery-left",
  gallery: "thumbnails",
  imageFit: "contain",
  ctaLabel: "Buy now",
  ctaStyle: "accent",
  priceNote: "incl-vat",
  shippingNote: "plus-shipping",
  showStock: true,
  showSeller: true,
  allowIndexing: false,
  sections: ["description", "specs", "documents", "shipping", "returns", "safety", "seller"].map(
    (id) => ({ id, show: true }),
  ),
};

// ── A push service that is really a decrypting sink ──────────────────────

type Push = { title: string; body: string; url: string; tag?: string };

const subtle = globalThis.crypto.subtle;
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      key,
      bytes * 8,
    ),
  );
}

async function pushSink() {
  const keys = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const received: Push[] = [];

  async function decrypt(body: Uint8Array): Promise<Push> {
    const salt = body.slice(0, 16);
    const idLength = body[20]!;
    const serverPublic = body.slice(21, 21 + idLength);
    const ciphertext = body.slice(21 + idLength);
    const shared = new Uint8Array(
      await subtle.deriveBits(
        {
          name: "ECDH",
          public: await subtle.importKey(
            "raw",
            serverPublic,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            [],
          ),
        },
        keys.privateKey,
        256,
      ),
    );
    const ikm = await hkdf(
      auth,
      shared,
      concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, serverPublic),
      32,
    );
    const cek = await hkdf(salt, ikm, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
    const nonce = await hkdf(salt, ikm, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);
    const plain = new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource },
        await subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]),
        ciphertext,
      ),
    );
    // Strip RFC 8188 padding: trailing zeros, then the 0x02 delimiter.
    let end = plain.length - 1;
    while (end > 0 && plain[end] === 0) end -= 1;
    return JSON.parse(new TextDecoder().decode(plain.slice(0, end))) as Push;
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        received.push(await decrypt(new Uint8Array(Buffer.concat(chunks))));
        res.writeHead(201);
      } catch (error) {
        console.error("push sink could not decrypt", error);
        res.writeHead(400);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    endpoint: `http://127.0.0.1:${port}/push/${Date.now()}`,
    p256dh: b64url(uaPublic),
    auth: b64url(auth),
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── Setup helpers ─────────────────────────────────────────────────────────

/**
 * The admin panel's notification tables. Deliberately NOT in the replayed
 * schema (check-prod-migrations.ts excludes 0006: it reads Vault), so this
 * spec, the one thing that needs them, applies SQ-admin's own migration.
 */
async function ensureAdminNotificationTables() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select to_regclass('public.admin_notification_cursor') is not null as present`,
    );
    if (!rows[0].present) {
      // ASCII only: the embedded server runs in the machine's code page on
      // Windows (WIN1252), and the migration's box-drawing comment rules have
      // no equivalent there. Only comments carry them.
      const sql = readFileSync(
        join(ADMIN_REPO, "supabase", "migrations", "0006_admin_notifications.sql"),
        "utf8",
      ).replace(/[^\x00-\x7F]/g, "");
      await client.query(sql);
      await client.query(`notify pgrst, 'reload schema'`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  } finally {
    await client.end();
  }
}

async function signUpViaGateway(email: string, password: string): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `gateway signup ${res.status}`).toBe(true);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

async function adminNotify() {
  const res = await fetch(`${ADMIN_URL}/api/moderation/notify`, {
    method: "POST",
    headers: { "x-scan-secret": SCAN_SECRET },
  });
  expect(res.status, "admin notify endpoint").toBe(200);
  return (await res.json()) as { events: number; sent: number; initialised: string[] };
}

async function signInToAdmin(page: Page, email: string, password: string) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="intent"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

async function waitForPush(received: Push[], match: (push: Push) => boolean, what: string) {
  await expect
    .poll(() => received.find(match) ?? null, { timeout: 30_000, message: what })
    .not.toBeNull();
  return received.find(match)!;
}

// ── The loop ──────────────────────────────────────────────────────────────

test("report, push, pause, fix, push, approve", async ({ browser }: { browser: Browser }) => {
  await ensureAdminNotificationTables();

  // --- The seller, their shop, and a product that will be reported ---------
  const sellerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const seller = await sellerContext.newPage();
  const sellerUser = freshUser("xapp-seller");
  await signUp(seller, sellerUser);
  const sellerId = await userIdByEmail(sellerUser.email);
  await seedStorefronts(sellerId, [{ name: "Cross-app studio" }]);
  const storefrontId = ((await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[])[0]!.id;
  await seedProducts(sellerId, [
    {
      title: "Suspicious sneakers",
      price_cents: 4500,
      description: "Brand new, 100% authentic.",
      image_key: "https://images.example/sneakers.jpg",
      purchase_url: "https://totally-legit.example/pay",
      option_groups: [
        {
          id: "7d0f5e0a-1111-4a8b-9c2d-000000000001",
          name: "Size",
          display: "chip",
          options: [
            { id: "7d0f5e0a-1111-4a8b-9c2d-000000000002", name: "42", available: true },
            { id: "7d0f5e0a-1111-4a8b-9c2d-000000000003", name: "43", available: false },
          ],
        },
      ],
    },
  ]);
  const productId = ((await serviceRest(
    `/products?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[])[0]!.id;
  await seedSellerIdentity(sellerId, PUBLISHABLE_SELLER);
  await serviceRest(`/storefronts?id=eq.${storefrontId}`, {
    method: "PATCH",
    body: {
      config: {
        theme: THEME,
        productPage: PRODUCT_PAGE,
        embed: { enabled: false, domains: [] },
        blocks: [{ type: "product", productId, x: 0, y: 0, w: 2, h: 2 }],
      },
    },
  });

  // --- Staff, with a device that "receives" push -----------------------------
  const staffEmail = `xapp-staff-${Date.now()}@e2e.squareshare.to`;
  const staffPassword = "e2e-password-123";
  const staffUserId = await signUpViaGateway(staffEmail, staffPassword);
  const [adminRow] = (await serviceRest(`/admin_users`, {
    method: "POST",
    body: [{ user_id: staffUserId, role: "staff" }],
  })) as { id: string }[];
  const sink = await pushSink();
  await serviceRest(`/admin_push_subscriptions`, {
    method: "POST",
    body: [
      {
        admin_user_id: adminRow!.id,
        endpoint: sink.endpoint,
        p256dh: sink.p256dh,
        auth: sink.auth,
        device_label: "e2e sink",
      },
    ],
  });
  // Plant the scan's watermarks first: a source's first run announces nothing
  // (otherwise turning notifications on would replay history).
  await adminNotify();

  try {
    // --- A buyer reports it ---------------------------------------------------
    const buyerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
    const buyer = await buyerContext.newPage();
    await buyer.goto(`/s/${storefrontId}/p/${productId}`);
    await expect(buyer.getByRole("heading", { name: "Suspicious sneakers" })).toBeVisible();
    await buyer.getByRole("button", { name: /report this product/i }).click();
    const dialog = buyer.getByRole("dialog");
    await dialog.getByRole("radio", { name: /counterfeit or stolen/i }).check();
    await dialog.getByLabel(/anything else/i).fill("The swoosh is upside down.");
    await dialog.getByRole("button", { name: /send report/i }).click();
    await expect(dialog.getByText(/a person will review this/i)).toBeVisible();
    await buyerContext.close();

    // Staff hear about it without anyone running a scan by hand: SQ-store's
    // ping did it.
    const reported = await waitForPush(
      sink.received,
      (push) => push.title === "Content reported",
      "push for the new report",
    );
    expect(reported.body).toContain('"Suspicious sneakers"');
    expect(reported.body).toContain("counterfeit");
    expect(reported.url).toBe(`/moderation/product/${productId}`);

    // --- Staff open it -------------------------------------------------------
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await signInToAdmin(staff, staffEmail, staffPassword);

    await staff.goto(`${ADMIN_URL}/moderation`);
    await expect(staff.locator("[data-nav-count]").first()).toHaveAttribute("data-nav-count", /[1-9]/);
    // By id, not by name: earlier runs leave their own "Suspicious sneakers".
    await staff.locator(`a[href="/moderation/product/${productId}"]`).first().click();
    await staff.waitForURL(new RegExp(`/moderation/product/${productId}`));

    // Everything needed to decide, on one page.
    await expect(staff.getByRole("heading", { level: 1 })).toHaveText("Suspicious sneakers");
    await expect(staff.getByText("€45.00")).toBeVisible();
    await expect(staff.getByText("Brand new, 100% authentic.")).toBeVisible();
    await expect(staff.getByText("https://totally-legit.example/pay")).toBeVisible();
    await expect(staff.locator("li", { hasText: "Size:" })).toContainText("43 (unavailable)");
    await expect(staff.locator("[data-product-photos] img").first()).toHaveAttribute(
      "src",
      "https://images.example/sneakers.jpg",
    );
    await expect(staff.getByText("The swoosh is upside down.")).toBeVisible();
    const sellerCard = staff.getByRole("region", { name: "The seller" });
    await expect(sellerCard).toContainText(PUBLISHABLE_SELLER.businessName);
    await expect(sellerCard).toContainText("12 Market Street");
    await expect(sellerCard).toContainText(sellerUser.email);
    await expect(staff.getByRole("link", { name: "Open the live page" })).toHaveAttribute(
      "href",
      `http://localhost:3100/s/${storefrontId}/p/${productId}`,
    );

    // --- Pause it, with a note ------------------------------------------------
    await staff.locator('[data-mode-option="pause"]').click();
    await staff.getByLabel("Reason").selectOption("counterfeit");
    await staff
      .getByLabel("What should the seller change?")
      .fill("Remove the brand logo from the photos and the word authentic.");
    const preview = staff.locator("[data-seller-preview]");
    await expect(preview).toContainText('Action needed: your product "Suspicious sneakers" is paused');
    await expect(preview).toContainText("Remove the brand logo from the photos");

    await staff.getByRole("button", { name: "Pause this product…" }).click();
    await staff.getByRole("button", { name: "Pause and notify" }).click();
    const outcome = staff.locator("[data-action-result]");
    await expect(outcome).toContainText("Product paused.");
    await expect(outcome).toContainText("The seller was told in their dashboard");
    await expect(staff.getByRole("heading", { name: /^Paused since/ })).toBeVisible();

    // The takedown is real: the buyer page is gone.
    const hidden = await seller.request.get(`/s/${storefrontId}/p/${productId}`);
    expect(hidden.status()).toBe(404);
    const reports = (await serviceRest(
      `/reports?target_id=eq.${productId}&select=status`,
    )) as { status: string }[];
    expect(reports.map((r) => r.status)).toEqual(["actioned"]);

    // --- The seller is told, and fixes it -------------------------------------
    await seller.goto("/notifications");
    const row = seller.getByRole("button", { name: /Action needed/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Remove the brand logo from the photos");
    await row.click();
    await seller.waitForURL(new RegExp(`/products/${productId}/edit`));
    const notice = seller.locator('[data-takedown="paused"]');
    await expect(notice).toContainText("Remove the brand logo from the photos");
    await notice.getByRole("button", { name: /I've made the changes, review it/i }).click();
    await expect(notice.locator("[data-review-requested]")).toBeVisible();

    const review = await waitForPush(
      sink.received,
      (push) => push.title === "Ready for another look",
      "push for the review request",
    );
    expect(review.body).toContain('"Suspicious sneakers"');
    expect(review.url).toBe(`/moderation/product/${productId}`);

    // --- Staff approve ----------------------------------------------------------
    await staff.goto(`${ADMIN_URL}/moderation`);
    // At least ours: the stack's DB is shared by every spec in the run.
    await expect(staff.getByRole("heading", { name: /Sellers waiting on you \(\d+\)/ })).toBeVisible();
    await staff
      .locator("[data-paused-list]")
      .first()
      .locator(`a[href="/moderation/product/${productId}"]`)
      .click();
    await expect(staff.locator("[data-review-requested]")).toContainText("The seller says it is fixed.");
    await staff.getByRole("button", { name: "Approve the changes and put it back" }).click();
    await expect(staff.locator("[data-action-result]")).toContainText("Product is live again.");
    await expect(staff.getByText("Live", { exact: true }).first()).toBeVisible();

    const live = await seller.request.get(`/s/${storefrontId}/p/${productId}`);
    expect(live.status()).toBe(200);

    const notices = (await serviceRest(
      `/notifications?user_id=eq.${sellerId}&type=eq.policy&select=title,data&order=created_at.asc`,
    )) as { title: string; data: { kind: string; href?: string } }[];
    expect(notices.map((n) => n.data.kind)).toEqual(["content_paused", "content_approved"]);
    expect(notices[1]!.title).toBe('Your product "Suspicious sneakers" is live again');
    expect(notices[0]!.data.href).toBe(`/products/${productId}/edit`);

    // The history says who did what.
    await expect(staff.getByText("Changes approved")).toBeVisible();
    await expect(staff.getByText("Paused", { exact: true }).first()).toBeVisible();

    await staffContext.close();
  } finally {
    await sink.close();
    await sellerContext.close();
  }
});
