/**
 * Harness smoke test: proves the embedded Postgres replica faithfully
 * reproduces the production Supabase environment before any real suite runs.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
} from "../db/client";

afterAll(closePool);

describe("embedded supabase replica", () => {
  it("applied every table from the prod migration history", async () => {
    const { rows } = await asSuper((q) =>
      q.query(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE'
         order by 1`,
      ),
    );
    const names = rows.map((r) => r.table_name);
    // Exhaustive on purpose: a table appearing here that nobody expected is
    // the signal. artifact_likes, follows and reports arrived exactly that
    // way — SQ-app shares this database and added them to production, and the
    // replica did not carry them until 2026-08-07, so no test could see them.
    // If this list needs changing, check `pnpm check:migrations` first.
    expect(names).toEqual([
      "admin_audit_log",
      "admin_users",
      "artifact_likes",
      "artifacts",
      "collections",
      "follows",
      "notifications",
      "orders",
      "products",
      "profiles",
      "rate_limit_keys",
      "rate_limits",
      "reports",
      "security_events",
      "storefront_signals",
      "storefronts",
      "team_members",
      "waitlist_signups",
    ]);
  });

  it("has RLS enabled on every public table", async () => {
    const { rows } = await asSuper((q) =>
      q.query(
        `select relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
      ),
    );
    expect(rows).toEqual([]);
  });

  it("signup trigger chain creates profile + owner team membership", async () => {
    const user = await createUser("harness-owner@test.squareshare.to", {
      username: "harness_owner",
    });

    const profile = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [
        user.id,
      ]),
    );
    expect(profile.rows[0]?.username).toBe("harness_owner");

    const owner = await asSuper((q) =>
      q.query(
        `select role, status, member_user_id, invited_email
         from public.team_members where account_owner_id = $1`,
        [user.id],
      ),
    );
    expect(owner.rows).toHaveLength(1);
    expect(owner.rows[0]).toMatchObject({
      role: "owner",
      status: "active",
      member_user_id: user.id,
      invited_email: user.email,
    });
  });

  it("auth.uid() resolves from request.jwt.claims exactly like PostgREST", async () => {
    const user = await createUser();
    const { rows } = await asUser(user, (q) =>
      q.query(`select auth.uid() as uid, auth.jwt() ->> 'email' as email`),
    );
    expect(rows[0].uid).toBe(user.id);
    expect(rows[0].email).toBe(user.email);
  });

  it("RLS separates two users at the smoke level", async () => {
    const a = await createUser();
    const b = await createUser();

    await asUser(a, (q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents) values ($1, 'A thing', 100)`,
        [a.id],
      ),
    );

    const mine = await asUser(a, (q) =>
      q.query(`select count(*)::int as n from public.products`),
    );
    const theirs = await asUser(b, (q) =>
      q.query(`select count(*)::int as n from public.products`),
    );
    expect(mine.rows[0].n).toBe(1);
    expect(theirs.rows[0].n).toBe(0);
  });

  it("service_role bypasses RLS (admin client semantics)", async () => {
    const { rows } = await asService((q) =>
      q.query(`select count(*)::int as n from public.products`),
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("anon role has no access to owner-scoped tables", async () => {
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int as n from public.products`),
    );
    // anon has the table grant but no policy applies -> zero rows, no error
    expect(rows[0].n).toBe(0);
  });
});
