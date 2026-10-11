import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import pg from "pg";
import {
  freshUser,
  gotoApp,
  PUBLISHABLE_SELLER,
  seedProducts,
  seedSellerIdentity,
  seedStorefronts,
  serviceRest,
  signUp,
  userIdByEmail,
} from "./helpers";
import { enableTwoFactor } from "./two-factor";

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
 *   2. Start SQ-admin against it (its .env.e2e plus the four below; the
 *      empty mail key keeps its .env.local one from sending real email):
 *        NOTIFY_SCAN_SECRET=e2e-scan STORE_APP_URL=http://localhost:3100 \
 *          NEXT_PUBLIC_APP_URL=http://localhost:3201 RESEND_API_KEY= \
 *          next dev -p 3201
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
    // The directory view too: the replica carries SQ-store's definition of
    // admin_user_directory, and the admin panel reads two columns (the avatar,
    // the last sign-in) that only its own 0005 adds. Without them every seller
    // lookup fails and the seller card comes up empty.
    const directory = await client.query(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'admin_user_directory'
          and column_name = 'last_sign_in_at'`,
    );
    if (directory.rows[0].n === 0) {
      // Two pieces of the real auth schema the mock GoTrue never needed (it
      // keeps sessions in memory); the migration only has to find them there.
      await client.query(
        `alter table auth.users add column if not exists last_sign_in_at timestamptz;
         create table if not exists auth.sessions (
           id uuid primary key default gen_random_uuid(),
           user_id uuid,
           updated_at timestamptz not null default now()
         );`,
      );
      await client.query(
        readFileSync(
          join(ADMIN_REPO, "supabase", "migrations", "0005_admin_directory_activity.sql"),
          "utf8",
        ).replace(/[^ -]/g, ""),
      );
      await client.query(`notify pgrst, 'reload schema'`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }

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

/**
 * A member of staff, signed in the way one really is.
 *
 * The admin panel lets staff in only on a session that has passed two-factor,
 * and takes no second factor itself: the dashboard does, on the session
 * cookie the two apps share (a cookie belongs to a host, not a port, so
 * localhost:3100 and :3201 share one here as .squareshare.eu does live). So
 * staff are a dashboard account with two-factor turned on through its real
 * settings screen, which leaves this very session at the higher level.
 */
async function staffWithTwoFactor(browser: Browser, tag: string) {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  const user = freshUser(tag);
  await signUp(page, user);
  await enableTwoFactor(page, user.password);
  return { context, page, userId: await userIdByEmail(user.email) };
}

async function adminNotify() {
  const res = await fetch(`${ADMIN_URL}/api/moderation/notify`, {
    method: "POST",
    headers: { "x-scan-secret": SCAN_SECRET },
  });
  expect(res.status, "admin notify endpoint").toBe(200);
  return (await res.json()) as { events: number; sent: number; initialised: string[] };
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
  const staffSession = await staffWithTwoFactor(browser, "xapp-staff");
  const staffUserId = staffSession.userId;
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
    const staffContext = staffSession.context;
    const staff = staffSession.page;

    await staff.goto(`${ADMIN_URL}/moderation`);
    await expect(staff.locator("[data-nav-count]").first()).toHaveAttribute("data-nav-count", /[1-9]/);
    // By id, not by name: earlier runs leave their own "Suspicious sneakers".
    await staff.locator(`a[href="/moderation/product/${productId}"]`).first().click();
    await staff.waitForURL(new RegExp(`/moderation/product/${productId}`));

    // Everything needed to decide, on one page.
    await expect(staff.getByRole("heading", { level: 1 })).toHaveText("Suspicious sneakers");
    // Twice on the page since the seller's catalogue joined it: the facts,
    // and this item's own row in that list.
    await expect(staff.getByText("€45.00").first()).toBeVisible();
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
    // A pause has to point at the parts: the button stays off until it does.
    await expect(staff.getByRole("button", { name: "Pause this product…" })).toBeDisabled();
    await staff.locator('[data-fix-field="photos"]').click();
    await staff.locator('[data-fix-field="description"]').click();
    const preview = staff.locator("[data-seller-preview]");
    await expect(preview).toContainText('Action needed: your product "Suspicious sneakers" is paused');
    await expect(preview).toContainText("Remove the brand logo from the photos");
    await expect(preview).toContainText("What to change: Description, Photos.");

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
    const row = seller.getByRole("link", { name: /Action needed/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Remove the brand logo from the photos");
    await row.click();
    await seller.waitForURL(new RegExp(`/products/${productId}/edit`));
    const notice = seller.locator('[data-takedown="paused"]');
    await expect(notice).toContainText("Remove the brand logo from the photos");
    // The parts staff picked are what the seller's form lights up.
    await expect(notice.locator("[data-fix-field]")).toHaveText(["Description", "Photos"]);
    await expect(seller.locator('[data-product-section="photos"]')).toHaveAttribute(
      "data-fix-flag",
      "needs",
    );
    await expect(seller.locator('[data-fix-mark="description"]')).toBeVisible();
    // And the decision behind it can be kept.
    const statement = await seller.request.get(
      (await notice.locator("[data-statement-download]").getAttribute("href"))!,
    );
    expect(statement.status()).toBe(200);
    expect(statement.headers()["content-type"]).toBe("application/pdf");
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
    )) as {
      title: string;
      data: { kind: string; href?: string; fields?: string[]; decisionId?: string };
    }[];
    expect(notices.map((n) => n.data.kind)).toEqual(["content_paused", "content_approved"]);
    expect(notices[1]!.title).toBe('Your product "Suspicious sneakers" is live again');
    expect(notices[0]!.data.href).toBe(`/products/${productId}/edit`);
    expect(notices[0]!.data.fields).toEqual(["description", "photos"]);

    // The decision is on record, with the facts the statement is built from.
    const decisions = (await serviceRest(
      `/moderation_decisions?target_id=eq.${productId}&select=id,action,fields,report_count,report_reasons`,
    )) as { id: string; action: string; fields: string[]; report_count: number; report_reasons: string[] }[];
    expect(decisions).toEqual([
      {
        id: notices[0]!.data.decisionId,
        action: "paused",
        fields: ["description", "photos"],
        report_count: 1,
        report_reasons: ["counterfeit"],
      },
    ]);

    // The history says who did what.
    await expect(staff.getByText("Changes approved")).toBeVisible();
    await expect(staff.getByText("Paused", { exact: true }).first()).toBeVisible();

    await staffContext.close();
  } finally {
    await sink.close();
    await sellerContext.close();
  }
});

// ── Appeals ───────────────────────────────────────────────────────────────

/**
 * THE APPEAL LOOP, across both apps, both ways:
 *
 *   staff remove a product
 *     -> the seller appeals from the banner
 *     -> staff get a push, and the appeal heads the queue
 *   staff turn it down, with a reason
 *     -> the seller reads the answer on the banner
 *   staff soften it to a pause (a NEW decision, so it can be appealed again)
 *     -> the seller appeals again
 *   staff accept it
 *     -> the product is live, and the seller is told the appeal succeeded
 */
test("remove, appeal, turn down, pause, appeal, accept", async ({ browser }: { browser: Browser }) => {
  await ensureAdminNotificationTables();

  const sellerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const seller = await sellerContext.newPage();
  const sellerUser = freshUser("xapp-appeal");
  await signUp(seller, sellerUser);
  const sellerId = await userIdByEmail(sellerUser.email);
  await seedStorefronts(sellerId, [{ name: "Appeal studio" }]);
  const storefrontId = ((await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[])[0]!.id;
  await seedProducts(sellerId, [
    { title: "Disputed print", price_cents: 3000, description: "An original print." },
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
  const productPage = `/s/${storefrontId}/p/${productId}`;

  const staffSession = await staffWithTwoFactor(browser, "xapp-appeal-staff");
  const staffUserId = staffSession.userId;
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
  // Plants the new appeal source's watermark, like every other source's.
  await adminNotify();

  const appealsFor = (push: Push) => push.title === "Decision appealed" && push.url === `/moderation/product/${productId}`;

  try {
    const staffContext = staffSession.context;
    const staff = staffSession.page;

    // --- Staff remove it --------------------------------------------------------
    await staff.goto(`${ADMIN_URL}/moderation/product/${productId}`);
    await staff.locator('[data-mode-option="remove"]').click();
    await staff.getByLabel("Reason").selectOption("counterfeit");
    // Optional for a removal: what it concerned, for the statement.
    await staff.locator('[data-fix-field="photos"]').click();
    await staff.getByRole("button", { name: "Remove this product…" }).click();
    await staff.getByRole("button", { name: "Remove and notify" }).click();
    await expect(staff.locator("[data-action-result]")).toContainText("Product removed.");
    expect((await seller.request.get(productPage)).status()).toBe(404);

    // --- The seller appeals -----------------------------------------------------
    await seller.goto(`/products/${productId}/edit`);
    const removed = seller.locator('[data-takedown="removed"]');
    await expect(removed.locator("[data-fix-field]")).toHaveText(["Photos"]);
    await removed.getByRole("button", { name: "Appeal this decision" }).click();
    const first = seller.getByRole("dialog", { name: "Appeal this decision" });
    await first
      .getByLabel("Why do you think this decision is wrong?")
      .fill("This is my own artwork. The original sketches are on my portfolio from 2024.");
    await first.getByRole("button", { name: "Send appeal" }).click();
    await expect(removed.locator('[data-appeal-status="open"]')).toBeVisible();

    const firstPush = await waitForPush(sink.received, appealsFor, "push for the first appeal");
    expect(firstPush.body).toContain('"Disputed print"');
    expect(firstPush.body).toContain("appealed the removal");

    // --- It heads the queue; staff turn it down, with a reason --------------------
    await staff.goto(`${ADMIN_URL}/moderation`);
    await expect(staff.getByRole("heading", { name: /Appeals waiting on you \(\d+\)/ })).toBeVisible();
    await staff
      .locator("[data-appeal-list]")
      .locator(`a[href="/moderation/product/${productId}"]`)
      .click();
    await staff.waitForURL(new RegExp(`/moderation/product/${productId}`));
    const panel = staff.locator("[data-appeal-panel]");
    await expect(panel.locator("[data-appeal-message]")).toContainText("The original sketches");
    await expect(panel.getByRole("button", { name: "Turn it down…" })).toBeDisabled();
    await panel
      .getByLabel("Your answer to the seller")
      .fill("The same image is sold by the original artist's own shop.");
    await panel.getByRole("button", { name: "Turn it down…" }).click();
    await expect(staff.getByRole("dialog").locator("[data-seller-preview]")).toContainText(
      "We looked at your appeal again and the decision stands.",
    );
    await staff.getByRole("button", { name: "Turn down and notify" }).click();
    await expect(staff.locator("[data-appeal-panel]")).toContainText("Appeal turned down");

    await seller.reload();
    await expect(seller.locator('[data-appeal-status="upheld"]')).toContainText(
      "Our answer: The same image is sold by the original artist's own shop.",
    );
    await expect(seller.getByRole("button", { name: "Appeal this decision" })).toHaveCount(0);

    // --- Staff soften it to a pause: a new decision ------------------------------
    await staff.goto(`${ADMIN_URL}/moderation/product/${productId}`);
    await staff.getByText("Change to a pause, so the seller can fix it").click();
    await staff.locator('[data-fix-field="photos"]').last().click();
    await staff
      .getByLabel("What should the seller change?")
      .fill("Show a photo of your own original, not the reseller's image.");
    await staff.getByRole("button", { name: "Pause this product…" }).click();
    await staff.getByRole("button", { name: "Pause and notify" }).click();
    await expect(staff.locator("[data-action-result]")).toContainText("Product paused.");

    // --- The seller appeals the new decision --------------------------------------
    await seller.reload();
    const paused = seller.locator('[data-takedown="paused"]');
    await expect(paused.locator("[data-fix-field]")).toHaveText(["Photos"]);
    await paused.getByRole("button", { name: "Appeal this decision" }).click();
    const second = seller.getByRole("dialog", { name: "Appeal this decision" });
    await second
      .getByLabel("Why do you think this decision is wrong?")
      .fill("The photo already shows my own original, signed in the corner.");
    await second.getByRole("button", { name: "Send appeal" }).click();
    await expect(paused.locator('[data-appeal-status="open"]')).toBeVisible();
    await expect
      .poll(() => sink.received.filter(appealsFor).length, { timeout: 30_000 })
      .toBe(2);

    // --- Staff accept it -------------------------------------------------------------
    await staff.goto(`${ADMIN_URL}/moderation/product/${productId}`);
    await staff
      .locator("[data-appeal-panel]")
      .getByRole("button", { name: /Accept: put the product back live/ })
      .click();
    await expect(staff.getByRole("dialog").locator("[data-seller-preview]")).toContainText(
      "We looked at your appeal and reversed our decision.",
    );
    await staff.getByRole("button", { name: "Accept and notify" }).click();
    await expect(staff.getByText("Live", { exact: true }).first()).toBeVisible();
    expect((await seller.request.get(productPage)).status()).toBe(200);

    // --- The record ---------------------------------------------------------------
    const notices = (await serviceRest(
      `/notifications?user_id=eq.${sellerId}&type=eq.policy&select=data&order=created_at.asc`,
    )) as { data: { kind: string } }[];
    expect(notices.map((n) => n.data.kind)).toEqual([
      "content_removed",
      "content_appeal_upheld",
      "content_paused",
      "content_appeal_overturned",
    ]);
    const decisions = (await serviceRest(
      `/moderation_decisions?target_id=eq.${productId}&select=action,fields&order=decided_at.asc`,
    )) as { action: string; fields: string[] }[];
    expect(decisions).toEqual([
      { action: "removed", fields: ["photos"] },
      { action: "paused", fields: ["photos"] },
    ]);
    const appeals = (await serviceRest(
      `/moderation_appeals?target_id=eq.${productId}&select=status,decision_note&order=created_at.asc`,
    )) as { status: string; decision_note: string | null }[];
    expect(appeals).toEqual([
      { status: "upheld", decision_note: "The same image is sold by the original artist's own shop." },
      { status: "overturned", decision_note: null },
    ]);

    await seller.goto(`/products/${productId}/edit`);
    await expect(seller.locator("[data-removal-notice]")).toHaveCount(0);

    await expect(staff.getByText("Appeal turned down")).toBeVisible();
    await expect(staff.getByText("Appeal accepted, put back live")).toBeVisible();
    await staffContext.close();
  } finally {
    await sink.close();
    await sellerContext.close();
  }
});

// ── The automatic check's hold ────────────────────────────────────────────

/**
 * WHAT THE AUTOMATIC CHECK COULD NOT DECIDE, A PERSON DOES:
 *
 *   a seller saves words the check is not sure about
 *     -> the product is hidden, and nothing has been decided against them
 *     -> staff get a push, and it heads the queue under its own heading
 *   staff open it, see WHICH words were held, and approve
 *     -> it is live, the seller is told, and those words are never held again
 *
 * The check itself is the development stand-in the stack runs with
 * (lib/moderation/auto/test-provider.ts): "[[unsure]]" is its marker.
 */
test("held by the automatic check, approved by a person", async ({ browser }: { browser: Browser }) => {
  await ensureAdminNotificationTables();

  const sellerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const seller = await sellerContext.newPage();
  const sellerUser = freshUser("xapp-held");
  await signUp(seller, sellerUser);
  const sellerId = await userIdByEmail(sellerUser.email);
  await seedStorefronts(sellerId, [{ name: "Held studio" }]);
  const storefrontId = ((await serviceRest(
    `/storefronts?owner_id=eq.${sellerId}&select=id`,
  )) as { id: string }[])[0]!.id;
  await seedProducts(sellerId, [
    { title: "Borderline lamp", price_cents: 9900, description: "A lamp for a wall." },
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
  const productPage = `/s/${storefrontId}/p/${productId}`;
  const status = async () =>
    ((await serviceRest(`/products?id=eq.${productId}&select=moderation_status`)) as {
      moderation_status: string;
    }[])[0]!.moderation_status;

  const staffSession = await staffWithTwoFactor(browser, "xapp-held-staff");
  const staffUserId = staffSession.userId;
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
  await adminNotify();

  try {
    // --- The seller saves something the check cannot call -------------------
    const held = "A lamp. [[unsure]] Something borderline.";
    await gotoApp(seller, `/products/${productId}/edit`);
    await seller.locator('[data-product-field="description"]').fill(held);
    await seller.getByRole("button", { name: "Save changes" }).click();
    await seller.waitForURL(/\/products$/, { timeout: 90_000 });

    expect(await status()).toBe("review");
    expect((await seller.request.get(productPage)).status()).toBe(404);

    // Staff hear about it: nothing else would tell anyone it is waiting.
    const push = await waitForPush(
      sink.received,
      (candidate) => candidate.title === "Held for review" && candidate.body.includes("Borderline lamp"),
      "push for the held product",
    );
    expect(push.url).toBe(`/moderation/product/${productId}`);

    // --- Staff open it ---------------------------------------------------------
    const staffContext = staffSession.context;
    const staff = staffSession.page;
    await staff.goto(`${ADMIN_URL}/moderation`);
    await expect(
      staff.getByRole("heading", { name: /Held by the automatic check \(\d+\)/ }),
    ).toBeVisible();
    await staff
      .locator("[data-held-list]")
      .locator(`a[href="/moderation/product/${productId}"]`)
      .click();
    await staff.waitForURL(new RegExp(`/moderation/product/${productId}`));

    // What was held, in the seller's own words, so the decision is about the
    // part and not a guess at it.
    await expect(staff.locator("[data-held]")).toContainText("Nothing has been decided");
    const reasons = staff.locator("[data-held-reasons]");
    await expect(reasons.locator('[data-held-part="text"]')).toContainText(held);
    // The seller's catalogue says the same thing about it: held, not live,
    // and not a takedown on their record.
    await expect(staff.locator("tr", { hasText: "this one" })).toContainText("Held for review");
    await expect(staff.getByRole("region", { name: "The seller" })).toContainText(
      "1 held for review",
    );
    await expect(staff.getByRole("region", { name: "The seller" })).not.toContainText("taken down");
    await staff.screenshot({ path: test.info().outputPath("admin-held.png"), fullPage: true });

    // --- And approve ------------------------------------------------------------
    await staff.getByRole("button", { name: "Approve it and put it live" }).click();
    await expect(staff.locator("[data-action-result]")).toContainText("Product is live again.");
    await expect(staff.getByText("Live", { exact: true }).first()).toBeVisible();

    expect(await status()).toBe("ok");
    expect((await seller.request.get(productPage)).status()).toBe(200);

    const notices = (await serviceRest(
      `/notifications?user_id=eq.${sellerId}&type=eq.policy&select=title,body&order=created_at.asc`,
    )) as { title: string; body: string }[];
    expect(notices.at(-1)!.title).toBe('Your product "Borderline lamp" is live');
    expect(notices.at(-1)!.body).toContain("Our automatic check held this product");

    // Remembered: saving those exact words again is not held a second time.
    await gotoApp(seller, `/products/${productId}/edit`);
    await seller.getByLabel(/price/i).fill("101.00");
    await seller.getByRole("button", { name: "Save changes" }).click();
    await seller.waitForURL(/\/products$/, { timeout: 90_000 });
    expect(await status()).toBe("ok");

    await staffContext.close();
  } finally {
    await sink.close();
    await sellerContext.close();
  }
});
