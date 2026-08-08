/**
 * EVERY table in `public` has RLS enabled, and the replica knows about every
 * table production has.
 *
 * WHY THIS EXISTS. The other integration files each prove that ONE feature's
 * policies behave. None of them could notice a table that nobody wrote a test
 * for — and that is exactly what happened. This project's Supabase instance is
 * shared with SQ-app, whose `sq_app_likes_follows_reports` migration added
 * artifact_likes, follows and reports straight to production. They were absent
 * from tests/db/prod-migrations.sql for four weeks, so the suite could not see
 * them, while they were reachable with the same publishable anon key this
 * dashboard ships to every browser.
 *
 * A per-feature test would never have caught that. This one is deliberately
 * written against the catalog rather than against a list of tables someone
 * maintains by hand, so a new table is guilty until a human adds it below.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asSuper, closePool } from "../db/client";

/**
 * Tables that are allowed to carry zero policies.
 *
 * RLS with no policy is DENY-ALL for anon/authenticated, which is fail-closed
 * and correct for a table only service_role should touch. It is listed rather
 * than inferred so that a table arriving here is a decision, not an accident.
 */
const POLICY_FREE_BY_DESIGN = new Set([
  // Rate-limit state. Written only through rl_take / rl_take_key, which are
  // SECURITY DEFINER; a client that could read these could map other users'
  // budgets, and one that could write them could clear its own.
  "rate_limits",
  "rate_limit_keys",
]);

afterAll(async () => {
  await closePool();
});

describe("RLS coverage", () => {
  it("has row level security enabled on every public table", async () => {
    const unprotected = await asSuper(async (q) => {
      const { rows } = await q.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and not c.relrowsecurity
          order by c.relname`,
      );
      return rows.map((row) => row.relname);
    });

    expect(unprotected).toEqual([]);
  });

  it("has at least one policy on every table not explicitly exempt", async () => {
    const bare = await asSuper(async (q) => {
      const { rows } = await q.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and c.relrowsecurity
            and not exists (
              select 1 from pg_policy p where p.polrelid = c.oid
            )
          order by c.relname`,
      );
      return rows.map((row) => row.relname);
    });

    // Anything here is either a table that needs policies, or a deliberate
    // deny-all that belongs in POLICY_FREE_BY_DESIGN with a reason.
    expect(bare.filter((name) => !POLICY_FREE_BY_DESIGN.has(name))).toEqual([]);
  });

  it("replays the SQ-app social tables, which share this database", async () => {
    // Not a policy assertion — a REPLICA assertion. If tests/db/prod-migrations.sql
    // drifts from production again, these disappear and this fails, which is
    // the whole point. Keep in step with `pnpm check:migrations`.
    const present = await asSuper(async (q) => {
      const { rows } = await q.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and c.relname in ('artifact_likes', 'follows', 'reports')
          order by c.relname`,
      );
      return rows.map((row) => row.relname);
    });

    expect(present).toEqual(["artifact_likes", "follows", "reports"]);
  });

  it("keeps the reports queue readable only by staff", async () => {
    // reports holds abuse complaints naming other users. It is the one SQ-app
    // table whose rows must never be public, so unlike likes and follows it
    // gets an explicit assertion that no anon-readable policy was ever added.
    const anonReadable = await asSuper(async (q) => {
      const { rows } = await q.query<{ polname: string }>(
        `select p.polname
           from pg_policy p
           join pg_class c on c.oid = p.polrelid
          where c.relname = 'reports'
            and p.polcmd in ('r', '*')
            and exists (
              select 1 from unnest(p.polroles) r
              where r::regrole::text = 'anon'
            )`,
      );
      return rows.map((row) => row.polname);
    });

    expect(anonReadable).toEqual([]);
  });
});
