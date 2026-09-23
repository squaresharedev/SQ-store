/**
 * Two-factor authentication, enforced by the DATABASE.
 *
 * The app refuses an aal1 session for an account with 2FA on, but the anon key
 * ships to every browser: someone holding a phished password can ask GoTrue
 * for an aal1 token and talk to PostgREST directly, never touching the app.
 * The restrictive "Require two-factor when enrolled" policies are what stop
 * that token reading or writing anything. These tests run the real policies
 * against the replayed production schema, with the JWT claims PostgREST would
 * set.
 *
 * Also covered: the recovery-code table and functions, which must be
 * unreachable for every client role.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  asUserWithClaims,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

/** Every table the migration puts behind the two-factor check. */
const ENFORCED_TABLES = [
  "profiles",
  "products",
  "storefronts",
  "orders",
  "team_members",
  "notifications",
  "security_events",
  "storefront_signals",
  "collections",
  "artifacts",
  "follows",
  "artifact_likes",
  "reports",
];

let alice: TestUser; // turns 2FA on
let bob: TestUser; // never does

const AAL1 = { aal: "aal1", amr: [{ method: "password", timestamp: 1 }] };
const AAL2 = { aal: "aal2", amr: [{ method: "totp", timestamp: 2 }, { method: "password", timestamp: 1 }] };

async function enrol(user: TestUser, status: "verified" | "unverified" = "verified") {
  await asSuper((q) =>
    q.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, $3, 'totp', $4, 'JBSWY3DPEHPK3PXP')`,
      [randomUUID(), user.id, `phone-${randomUUID().slice(0, 6)}`, status],
    ),
  );
}

async function seed(user: TestUser) {
  await asService(async (q) => {
    await q.query(
      `insert into public.products (owner_id, title, price_cents, currency, status)
       values ($1, 'Lamp', 1200, 'EUR', 'draft')`,
      [user.id],
    );
    await q.query(
      `insert into public.orders (seller_id, channel, status, amount_cents, platform_fee_cents,
                                  currency, buyer_email, product_title, product_price_cents)
       values ($1, 'embed', 'paid', 1200, 60, 'EUR', 'buyer@example.com', 'Lamp', 1200)`,
      [user.id],
    );
    await q.query(
      `insert into public.notifications (user_id, type, title) values ($1, 'system', 'Hello')`,
      [user.id],
    );
    await q.query(
      `insert into public.security_events (user_id, event) values ($1, 'password.changed')`,
      [user.id],
    );
    await q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Shop')`, [user.id]);
  });
}

/** How many of this user's own rows each private table shows them. */
async function visible(user: TestUser, claims: Record<string, unknown>) {
  return asUserWithClaims(user, claims, async (q) => {
    const count = async (sql: string) => Number((await q.query(sql, [user.id])).rows[0].n);
    return {
      profiles: await count(`select count(*) n from public.profiles where id = $1`),
      products: await count(`select count(*) n from public.products where owner_id = $1`),
      orders: await count(`select count(*) n from public.orders where seller_id = $1`),
      notifications: await count(`select count(*) n from public.notifications where user_id = $1`),
      security_events: await count(`select count(*) n from public.security_events where user_id = $1`),
      storefronts: await count(`select count(*) n from public.storefronts where owner_id = $1`),
      team_members: await count(`select count(*) n from public.team_members where account_owner_id = $1`),
    };
  });
}

beforeAll(async () => {
  alice = await createUser(`alice-2fa-${randomUUID().slice(0, 6)}@test.squareshare.to`, {
    username: `alice2fa_${randomUUID().slice(0, 6)}`,
  });
  bob = await createUser(`bob-2fa-${randomUUID().slice(0, 6)}@test.squareshare.to`, {
    username: `bob2fa_${randomUUID().slice(0, 6)}`,
  });
  await seed(alice);
  await seed(bob);
});

afterAll(closePool);

describe("mfa_session_ok()", () => {
  const ok = (user: TestUser, claims: Record<string, unknown>) =>
    asUserWithClaims(user, claims, async (q) => (await q.query(`select public.mfa_session_ok() ok`)).rows[0].ok);

  it("is true for an account without 2FA at aal1 (2FA is optional)", async () => {
    expect(await ok(bob, AAL1)).toBe(true);
    // No aal claim at all reads as aal1, and is still fine without 2FA.
    expect(await asUser(bob, async (q) => (await q.query(`select public.mfa_session_ok() ok`)).rows[0].ok)).toBe(true);
  });

  it("an abandoned, unverified factor does not switch 2FA on", async () => {
    const carol = await createUser();
    await enrol(carol, "unverified");
    expect(await ok(carol, AAL1)).toBe(true);
  });

  it("is false at aal1 and true at aal2 once the account has a verified factor", async () => {
    await enrol(alice);
    expect(await ok(alice, AAL1)).toBe(false);
    expect(await ok(alice, {})).toBe(false); // no claim = aal1
    expect(await ok(alice, AAL2)).toBe(true);
  });

  it("only ever answers about the CALLER: another user's factors change nothing", async () => {
    expect(await ok(bob, AAL1)).toBe(true);
  });

  it("is SECURITY DEFINER with an empty search_path, and not callable by anon", async () => {
    const fn = await asSuper(async (q) =>
      (
        await q.query(
          `select prosecdef, proconfig from pg_proc where proname = 'mfa_session_ok'
             and pronamespace = 'public'::regnamespace`,
        )
      ).rows[0],
    );
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig).toContain('search_path=""');
    const message = await expectDbError(asAnon((q) => q.query(`select public.mfa_session_ok()`)));
    expect(message).toMatch(/permission denied/i);
  });

  it("the factor table itself stays out of reach for clients", async () => {
    const message = await expectDbError(
      asUserWithClaims(alice, AAL2, (q) => q.query(`select * from auth.mfa_factors`)),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe("restrictive policies (alice has 2FA on from here)", () => {
  it("a restrictive policy exists on every enforced table", async () => {
    const rows = await asSuper(async (q) =>
      (
        await q.query(
          `select tablename, permissive, roles, cmd from pg_policies
            where schemaname = 'public' and policyname = 'Require two-factor when enrolled'`,
        )
      ).rows,
    );
    const byTable = new Map(rows.map((r) => [r.tablename, r]));
    for (const table of ENFORCED_TABLES) {
      const policy = byTable.get(table);
      expect(policy, table).toBeDefined();
      expect(policy.permissive, table).toBe("RESTRICTIVE");
      expect(String(policy.roles), table).toContain("authenticated");
      expect(policy.cmd, table).toBe("ALL");
    }
  });

  it("an aal1 token for a 2FA account sees NONE of its own private data", async () => {
    expect(await visible(alice, AAL1)).toEqual({
      profiles: 0,
      products: 0,
      orders: 0,
      notifications: 0,
      security_events: 0,
      storefronts: 0,
      team_members: 0,
    });
  });

  it("the same account at aal2 sees all of it", async () => {
    const seen = await visible(alice, AAL2);
    expect(seen.profiles).toBe(1);
    expect(seen.products).toBe(1);
    expect(seen.orders).toBe(1);
    expect(seen.notifications).toBe(1);
    expect(seen.security_events).toBe(1);
    expect(seen.storefronts).toBe(1);
    expect(seen.team_members).toBeGreaterThanOrEqual(1);
  });

  it("an account WITHOUT 2FA is unaffected at aal1 (no regression)", async () => {
    const seen = await visible(bob, AAL1);
    expect(seen.profiles).toBe(1);
    expect(seen.products).toBe(1);
    expect(seen.orders).toBe(1);
  });

  it("an aal1 token cannot UPDATE the account's own rows", async () => {
    const res = await asUserWithClaims(alice, AAL1, (q) =>
      q.query(`update public.profiles set seller_bio = 'pwned' where id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(0);
    const products = await asUserWithClaims(alice, AAL1, (q) =>
      q.query(`update public.products set title = 'pwned' where owner_id = $1`, [alice.id]),
    );
    expect(products.rowCount).toBe(0);
    const bio = await asSuper(async (q) =>
      (await q.query(`select seller_bio from public.profiles where id = $1`, [alice.id])).rows[0].seller_bio,
    );
    expect(bio).not.toBe("pwned");
  });

  it("an aal1 token cannot DELETE the account's own rows", async () => {
    const res = await asUserWithClaims(alice, AAL1, (q) =>
      q.query(`delete from public.products where owner_id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("an aal1 token cannot INSERT on the account's behalf", async () => {
    const message = await expectDbError(
      asUserWithClaims(alice, AAL1, (q) =>
        q.query(
          `insert into public.products (owner_id, title, price_cents, currency, status)
           values ($1, 'Injected', 100, 'EUR', 'draft')`,
          [alice.id],
        ),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it("the same writes go through at aal2", async () => {
    const res = await asUserWithClaims(alice, AAL2, (q) =>
      q.query(`update public.products set title = 'Lamp v2' where owner_id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(1);
  });

  it("the service role (server-only admin client) is never affected", async () => {
    const n = await asService(async (q) =>
      Number((await q.query(`select count(*) n from public.products where owner_id = $1`, [alice.id])).rows[0].n),
    );
    expect(n).toBe(1);
  });

  it("turning 2FA off (last factor removed) restores aal1 access at once", async () => {
    const dave = await createUser();
    await seed(dave);
    await enrol(dave);
    expect((await visible(dave, AAL1)).products).toBe(0);
    await asSuper((q) => q.query(`delete from auth.mfa_factors where user_id = $1`, [dave.id]));
    expect((await visible(dave, AAL1)).products).toBe(1);
  });
});

describe("recovery codes: unreachable for every client role", () => {
  const hash = (seed: string) => seed.repeat(64).slice(0, 64);

  it("clients cannot read, write or count the table", async () => {
    for (const run of [
      (u: TestUser) => asUserWithClaims(u, AAL2, (q) => q.query(`select count(*) from public.mfa_recovery_codes`)),
      (u: TestUser) =>
        asUserWithClaims(u, AAL2, (q) =>
          q.query(`insert into public.mfa_recovery_codes (user_id, code_hash) values ($1, $2)`, [u.id, hash("a")]),
        ),
      () => asAnon((q) => q.query(`select count(*) from public.mfa_recovery_codes`)),
    ]) {
      expect(await expectDbError(run(alice))).toMatch(/permission denied/i);
    }
  });

  it("clients cannot call the replace or consume functions", async () => {
    for (const sql of [
      `select public.mfa_replace_recovery_codes($1, array['${hash("b")}'])`,
      `select public.mfa_consume_recovery_code($1, '${hash("b")}')`,
    ]) {
      expect(await expectDbError(asUserWithClaims(alice, AAL2, (q) => q.query(sql, [alice.id])))).toMatch(
        /permission denied/i,
      );
      expect(await expectDbError(asAnon((q) => q.query(sql, [alice.id])))).toMatch(/permission denied/i);
    }
  });

  it("replace swaps the whole set atomically; consume works exactly once", async () => {
    await asService(async (q) => {
      await q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [alice.id, [hash("1"), hash("2")]]);
      await q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [alice.id, [hash("3"), hash("4"), hash("5")]]);
    });
    const count = await asService(async (q) =>
      Number((await q.query(`select count(*) n from public.mfa_recovery_codes where user_id = $1`, [alice.id])).rows[0].n),
    );
    expect(count).toBe(3); // the first set is gone entirely

    const consume = (user: TestUser, h: string) =>
      asService(async (q) => (await q.query(`select public.mfa_consume_recovery_code($1, $2) ok`, [user.id, h])).rows[0].ok);

    expect(await consume(alice, hash("1"))).toBe(false); // replaced, no longer valid
    expect(await consume(alice, hash("3"))).toBe(true);
    expect(await consume(alice, hash("3"))).toBe(false); // single use
    expect(await consume(bob, hash("4"))).toBe(false); // another account's code
  });

  it("concurrent consumes of one code cannot both succeed", async () => {
    await asService((q) => q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [bob.id, [hash("9")]]));
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        asService(async (q) =>
          (await q.query(`select public.mfa_consume_recovery_code($1, $2) ok`, [bob.id, hash("9")])).rows[0].ok,
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses an empty, oversized or malformed batch", async () => {
    for (const batch of [[], Array.from({ length: 21 }, (_, i) => hash(String(i % 10)))]) {
      expect(
        await expectDbError(asService((q) => q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [bob.id, batch]))),
      ).toMatch(/invalid recovery code batch/);
    }
    expect(
      await expectDbError(
        asService((q) => q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [bob.id, ["not-a-hash"]])),
      ),
    ).toMatch(/check constraint/i);
  });

  it("codes are deleted with the account", async () => {
    const erin = await createUser();
    await asService((q) => q.query(`select public.mfa_replace_recovery_codes($1, $2)`, [erin.id, [hash("7")]]));
    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [erin.id]));
    const left = await asService(async (q) =>
      Number((await q.query(`select count(*) n from public.mfa_recovery_codes where user_id = $1`, [erin.id])).rows[0].n),
    );
    expect(left).toBe(0);
  });
});
