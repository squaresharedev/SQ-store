import { expect, test } from "@playwright/test";
import { freshUser, serviceRest, signUp, userIdByEmail } from "./helpers";
import { ANON_KEY, GATEWAY_URL, signJwt } from "./stack/keys.mjs";

/**
 * Raw REST-layer probes: what an attacker with the anon key (it ships to every
 * browser) or a stolen session JWT can do by talking DIRECTLY to the
 * PostgREST API, bypassing the app entirely. This is the "even if a test
 * bypasses client validation" case from the brief, executed against the same
 * engine hosted Supabase runs.
 */

function userJwt(id: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: id,
    email,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
  });
}

async function rest(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(`${GATEWAY_URL}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
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
    /* ignore */
  }
  return { status: res.status, json };
}

test.describe("direct REST security probes", () => {
  test("cross-tenant reads/writes are blocked at the API layer", async ({ page }) => {
    const alice = freshUser("rest-alice");
    const bob = freshUser("rest-bob");
    await signUp(page, alice);
    await page.context().clearCookies();
    await signUp(page, bob);

    const aliceId = await userIdByEmail(alice.email);
    const bobId = await userIdByEmail(bob.email);
    const aliceToken = userJwt(aliceId, alice.email);
    const bobToken = userJwt(bobId, bob.email);

    // Alice creates a product via REST (allowed for herself).
    const created = await rest(`/products`, aliceToken, {
      method: "POST",
      body: { owner_id: aliceId, title: "Alice REST product", price_cents: 700 },
    });
    expect(created.status).toBe(201);
    const productId = (created.json as Array<{ id: string }>)[0].id;

    // Bob cannot read it...
    const read = await rest(`/products?id=eq.${productId}`, bobToken);
    expect(read.status).toBe(200);
    expect(read.json).toEqual([]);

    // ...cannot update it (0 rows matched)...
    const upd = await rest(`/products?id=eq.${productId}`, bobToken, {
      method: "PATCH",
      body: { title: "hax" },
    });
    expect([200, 204]).toContain(upd.status);
    expect(upd.json ?? []).toEqual([]);

    // ...cannot insert a product owned by Alice (RLS violation)...
    const spoof = await rest(`/products`, bobToken, {
      method: "POST",
      body: { owner_id: aliceId, title: "spoof", price_cents: 1 },
    });
    expect(spoof.status).toBe(403);

    // ...and anon can see nothing at all.
    const anonRead = await rest(`/products`, ANON_KEY);
    expect(anonRead.json).toEqual([]);
  });

  test("orders are read-only and invisible cross-tenant at the API layer", async ({
    page,
  }) => {
    const seller = freshUser("rest-seller");
    const rival = freshUser("rest-rival");
    await signUp(page, seller);
    await page.context().clearCookies();
    await signUp(page, rival);
    const sellerId = await userIdByEmail(seller.email);
    const rivalId = await userIdByEmail(rival.email);

    await serviceRest(`/orders`, {
      method: "POST",
      body: [
        {
          seller_id: sellerId,
          channel: "embed",
          amount_cents: 5000,
          product_title: "REST order",
          product_price_cents: 5000,
          buyer_email: "secret-buyer@example.com",
        },
      ],
    });

    const rivalToken = userJwt(rivalId, rival.email);
    const sellerToken = userJwt(sellerId, seller.email);

    // Rival sees zero orders (buyer PII protected).
    const rivalRead = await rest(`/orders`, rivalToken);
    expect(rivalRead.json).toEqual([]);

    // The seller cannot forge/alter orders even for themselves.
    const insert = await rest(`/orders`, sellerToken, {
      method: "POST",
      body: {
        seller_id: sellerId,
        channel: "embed",
        amount_cents: 1,
        product_title: "forged",
        product_price_cents: 1,
      },
    });
    expect(insert.status).toBe(403);

    const refund = await rest(`/orders?seller_id=eq.${sellerId}`, sellerToken, {
      method: "PATCH",
      body: { status: "refunded" },
    });
    expect(refund.json ?? []).toEqual([]);
  });

  test("privileged RPCs are locked at the API layer", async ({ page }) => {
    const user = freshUser("rest-rpc");
    await signUp(page, user);
    const userId = await userIdByEmail(user.email);
    const token = userJwt(userId, user.email);

    // decrement_stock: authenticated users are denied outright.
    const decrement = await rest(`/rpc/decrement_stock`, token, {
      method: "POST",
      body: { p_product_id: "00000000-0000-4000-8000-000000000000", p_quantity: 1 },
    });
    expect([401, 403, 404]).toContain(decrement.status);

    // user_id_by_email: no email->id oracle for clients.
    const oracle = await rest(`/rpc/user_id_by_email`, token, {
      method: "POST",
      body: { p_email: user.email },
    });
    expect([401, 403, 404]).toContain(oracle.status);

    // username_taken: blocked for anon AND for a signed-in caller. The handle
    // is half a credential now, so "does this one exist?" is service_role-only.
    const anonCheck = await rest(`/rpc/username_taken`, ANON_KEY, {
      method: "POST",
      body: { p_username: "whatever" },
    });
    expect([401, 403, 404]).toContain(anonCheck.status);

    const authedCheck = await rest(`/rpc/username_taken`, token, {
      method: "POST",
      body: { p_username: "whatever" },
    });
    expect([401, 403, 404]).toContain(authedCheck.status);

    // email_by_username: the sign-in resolver is never on the client surface.
    const resolver = await rest(`/rpc/email_by_username`, token, {
      method: "POST",
      body: { p_username: "whatever" },
    });
    expect([401, 403, 404]).toContain(resolver.status);

    // notifications: no client insert path even self-addressed.
    const notif = await rest(`/notifications`, token, {
      method: "POST",
      body: { user_id: userId, type: "system", title: "spoof" },
    });
    expect([401, 403, 404]).toContain(notif.status);
  });

  test("a member cannot self-escalate via raw PATCH on team_members", async ({
    page,
  }) => {
    const owner = freshUser("rest-owner");
    const member = freshUser("rest-member");
    await signUp(page, owner);
    await page.context().clearCookies();
    await signUp(page, member);
    const ownerId = await userIdByEmail(owner.email);
    const memberId = await userIdByEmail(member.email);

    // Wire an active viewer membership directly (service).
    const rows = (await serviceRest(`/team_members`, {
      method: "POST",
      body: {
        account_owner_id: ownerId,
        member_user_id: memberId,
        invited_email: member.email,
        role: "viewer",
        status: "active",
        accepted_at: new Date().toISOString(),
      },
    })) as Array<{ id: string }>;
    const rowId = rows[0].id;

    const memberToken = userJwt(memberId, member.email);

    // Viewer PATCHes their own row to editor -> RLS matches zero rows.
    const escalate = await rest(`/team_members?id=eq.${rowId}`, memberToken, {
      method: "PATCH",
      body: { role: "editor" },
    });
    expect(escalate.json ?? []).toEqual([]);

    // Still a viewer.
    const check = (await serviceRest(`/team_members?id=eq.${rowId}&select=role`)) as Array<{
      role: string;
    }>;
    expect(check[0].role).toBe("viewer");
  });
});
