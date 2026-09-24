/**
 * The public profile directory, without a SECURITY DEFINER view.
 *
 * `public_profiles` used to run with its owner's rights over `profiles`, which
 * Supabase's advisor reports as CRITICAL (lint 0010). Since
 * 20260924_public_profiles_invoker it reads `profile_directory` as the caller,
 * and a trigger on `profiles` keeps that table to exactly the public part of
 * exactly the opted-in profiles.
 *
 * What these tests pin:
 *   - no view a client can read runs with definer rights (the advisor's rule);
 *   - anon still sees public profiles, and ONLY id/username/avatar_url;
 *   - the directory follows every change to a profile, including ones the
 *     owner makes through RLS with no write grant on the directory;
 *   - no client role can write the directory, directly or through the view.
 * The policies that consult the view (artifacts_public_read,
 * follows_visible_read) are covered by 20-sq-app-social-visibility, which
 * reads through it as anon.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let opted: TestUser; // is_public, has a username
let hidden: TestUser; // private
let changer: TestUser; // flips its own settings in the tests below

const directoryRow = async (id: string) =>
  (
    await asAnon((q) =>
      q.query(`select * from public.public_profiles where id = $1`, [id]),
    )
  ).rows[0];

beforeAll(async () => {
  opted = await createUser("dir-opted@test.squareshare.to", { username: "dir_opted" });
  hidden = await createUser("dir-hidden@test.squareshare.to", { username: "dir_hidden" });
  changer = await createUser("dir-changer@test.squareshare.to", { username: "dir_changer" });

  // Postures set explicitly, never trusted to the column default (see the
  // note in 20-sq-app-social-visibility about the default that drifted).
  await asService((q) =>
    q.query(`update public.profiles set is_public = true, avatar_url = 'https://x.test/a.webp' where id = $1`, [
      opted.id,
    ]),
  );
  await asService((q) =>
    q.query(`update public.profiles set is_public = false where id = any($1)`, [
      [hidden.id, changer.id],
    ]),
  );
});

afterAll(async () => {
  await closePool();
});

describe("no definer views", () => {
  it("every view anon or authenticated can read runs as the caller", async () => {
    // The advisor's 0010 rule, asserted here so it fails in CI rather than in
    // a dashboard nobody opened. admin_user_directory stays definer, and is
    // allowed only because no client role can read it.
    const definer = await asSuper(async (q) =>
      (
        await q.query<{ relname: string }>(
          `select c.relname
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind in ('v', 'm')
              and not coalesce('security_invoker=true' = any(c.reloptions)
                            or 'security_invoker=on' = any(c.reloptions), false)
              and (has_table_privilege('anon', c.oid, 'select')
                or has_table_privilege('authenticated', c.oid, 'select'))
            order by 1`,
        )
      ).rows.map((r) => r.relname),
    );
    expect(definer).toEqual([]);
  });

  it("the directory carries exactly the three public columns", async () => {
    // The fence SQ-app's RISKS.md asked for: widening what the internet can
    // see has to be a deliberate edit to this test, not a side effect.
    const columns = await asSuper(async (q) =>
      (
        await q.query<{ table_name: string; cols: string }>(
          `select table_name, string_agg(column_name, ',' order by ordinal_position) cols
             from information_schema.columns
            where table_schema = 'public'
              and table_name in ('profile_directory', 'public_profiles')
            group by 1 order by 1`,
        )
      ).rows,
    );
    expect(columns).toEqual([
      { table_name: "profile_directory", cols: "id,username,avatar_url" },
      { table_name: "public_profiles", cols: "id,username,avatar_url" },
    ]);
  });
});

describe("what anon sees", () => {
  it("an opted-in profile, with only its public columns", async () => {
    expect(await directoryRow(opted.id)).toEqual({
      id: opted.id,
      username: "dir_opted",
      avatar_url: "https://x.test/a.webp",
    });
  });

  it("nothing of a private profile", async () => {
    expect(await directoryRow(hidden.id)).toBeUndefined();
  });

  it("still nothing of profiles itself", async () => {
    // The reason the view was definer in the first place: profiles has no
    // anon policy, and this fix must not have added one.
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int n from public.profiles`),
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("the directory follows the profile", () => {
  it("appears when the owner opts in through their own session", async () => {
    // The owner has no write grant on the directory. The trigger must still
    // run for them, or opting in would silently do nothing.
    await asUser(changer, (q) =>
      q.query(`update public.profiles set is_public = true where id = $1`, [changer.id]),
    );
    expect((await directoryRow(changer.id))?.username).toBe("dir_changer");
  });

  it("tracks a new username and avatar", async () => {
    await asUser(changer, (q) =>
      q.query(
        `update public.profiles set username = 'dir_renamed', avatar_url = 'https://x.test/b.webp' where id = $1`,
        [changer.id],
      ),
    );
    expect(await directoryRow(changer.id)).toMatchObject({
      username: "dir_renamed",
      avatar_url: "https://x.test/b.webp",
    });
  });

  it("disappears the moment the owner goes private", async () => {
    await asUser(changer, (q) =>
      q.query(`update public.profiles set is_public = false where id = $1`, [changer.id]),
    );
    expect(await directoryRow(changer.id)).toBeUndefined();
  });

  it("disappears when the account is deleted", async () => {
    const leaving = await createUser("dir-leaving@test.squareshare.to", { username: "dir_leaving" });
    await asService((q) =>
      q.query(`update public.profiles set is_public = true where id = $1`, [leaving.id]),
    );
    expect(await directoryRow(leaving.id)).toBeDefined();

    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [leaving.id]));
    expect(await directoryRow(leaving.id)).toBeUndefined();
  });
});

describe("no client can write it", () => {
  const attempts = (id: string) => [
    `insert into public.profile_directory (id, username) values ('${id}', 'dir_forged')`,
    `update public.profile_directory set username = 'dir_forged' where id = '${id}'`,
    `delete from public.profile_directory where id = '${id}'`,
    `update public.public_profiles set username = 'dir_forged' where id = '${id}'`,
    `delete from public.public_profiles where id = '${id}'`,
  ];

  it("anon and a signed-in user are refused, even on their own row", async () => {
    for (const sql of attempts(opted.id)) {
      expect(await expectDbError(asAnon((q) => q.query(sql)))).toMatch(/permission denied/);
      expect(await expectDbError(asUser(opted, (q) => q.query(sql)))).toMatch(/permission denied/);
    }
    expect((await directoryRow(opted.id))?.username).toBe("dir_opted");
  });

  it("the sync function is not callable", async () => {
    // Also covered by the definer-function list in 22-two-factor-rls; stated
    // here so the reason sits next to the table it writes.
    const callable = await asSuper(async (q) =>
      (
        await q.query(
          `select has_function_privilege('anon', 'public.sync_profile_directory()', 'execute') anon,
                  has_function_privilege('authenticated', 'public.sync_profile_directory()', 'execute') authed`,
        )
      ).rows[0],
    );
    expect(callable).toEqual({ anon: false, authed: false });
  });
});

describe("the migration's pre-flight (what production runs first)", () => {
  // Step 0 of the migration is the only thing standing between a drifted
  // production view and a directory that silently publishes the wrong set of
  // profiles. Run the exact block from the file, against each shape.
  const migration = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260924_public_profiles_invoker.sql"),
    "utf8",
  );
  const preflight = migration.match(/do \$preflight\$[\s\S]*?\$preflight\$;/)?.[0];

  const runAgainst = (viewSql: string | null) =>
    asSuper(async (q) => {
      await q.query("begin");
      try {
        if (viewSql) await q.query(viewSql);
        await q.query(preflight!);
        return "passed";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        await q.query("rollback");
      }
    });

  it("is found in the migration file", () => {
    expect(preflight).toMatch(/raise exception/);
  });

  it("accepts the view as production has it today", async () => {
    expect(
      await runAgainst(
        `create or replace view public.public_profiles with (security_invoker = false) as
           select id, username, avatar_url from public.profiles
            where is_public = true and username is not null`,
      ),
    ).toBe("passed");
  });

  it("accepts the migrated view, so a re-run is harmless", async () => {
    expect(await runAgainst(null)).toBe("passed");
  });

  it("refuses a view with a different filter, and changes nothing", async () => {
    expect(
      await runAgainst(
        `create or replace view public.public_profiles as
           select id, username, avatar_url from public.profiles
            where username is not null`,
      ),
    ).toMatch(/not the view this migration was written for/);
  });
});
