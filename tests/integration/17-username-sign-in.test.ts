/**
 * Username sign-in: the handle resolver, the availability check, and the
 * signup trigger that claims a handle.
 *
 * The two things these tests exist to hold down:
 *
 *   1. Neither lookup is reachable by anon or authenticated. If either grant
 *      slips, the login box becomes a free "does this handle exist?" oracle
 *      and every rate limit in front of it is bypassed at the PostgREST layer.
 *   2. A handle is claimed in the SAME transaction as the auth user, so a
 *      collision leaves no account behind at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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

let holder: TestUser;
let other: TestUser;

beforeAll(async () => {
  holder = await createUser("handle-holder@test.squareshare.to", {
    username: "builderboy",
  });
  other = await createUser("handle-other@test.squareshare.to");
});

afterAll(closePool);

describe("handle_new_user claims the handle", () => {
  it("writes the username from signup metadata", async () => {
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [holder.id]),
    );
    expect(rows[0].username).toBe("builderboy");
  });

  it("normalizes to lowercase, so the stored value is what lookups compare", async () => {
    const user = await createUser(undefined, { username: "  MixedCase_99  " });
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [user.id]),
    );
    expect(rows[0].username).toBe("mixedcase_99");
  });

  it("leaves it null when signup supplied none", async () => {
    // Google sign-ups and every account created before this feature.
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [other.id]),
    );
    expect(rows[0].username).toBeNull();
  });

  it("treats a blank handle as no handle rather than storing an empty string", async () => {
    const user = await createUser(undefined, { username: "   " });
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [user.id]),
    );
    expect(rows[0].username).toBeNull();
  });
});

describe("no duplicate accounts", () => {
  it("aborts the WHOLE signup when the handle is already taken", async () => {
    // The claim happens inside the auth.users insert's transaction, so a
    // collision must roll back the auth user too. Anything less would leave
    // an account with no handle, or worse, a second account for one handle.
    const id = randomUUID();
    const email = `dupe-${id.slice(0, 8)}@test.squareshare.to`;

    const message = await expectDbError(
      asSuper((q) =>
        q.query(
          `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
           values ($1, $2, $3, now())`,
          [id, email, JSON.stringify({ username: "BuilderBoy" })],
        ),
      ),
    );
    expect(message).toMatch(/profiles_username_lower_idx|unique/i);

    const { rows: users } = await asSuper((q) =>
      q.query(`select id from auth.users where id = $1`, [id]),
    );
    const { rows: profiles } = await asSuper((q) =>
      q.query(`select id from public.profiles where id = $1`, [id]),
    );
    expect(users).toHaveLength(0);
    expect(profiles).toHaveLength(0);
  });

  it("still refuses when the collision differs only by case", async () => {
    const taken = await asSuper((q) =>
      q.query(
        `select count(*)::int as n from public.profiles where lower(username) = 'builderboy'`,
      ),
    );
    expect(taken.rows[0].n).toBe(1);
  });

  it("slugs a handle that is not handle-shaped rather than storing it raw", async () => {
    // raw_user_meta_data is caller-supplied, so the trigger cannot trust it.
    // Since the merge it SLUGS rather than rejects: an OAuth signup arrives
    // with a human name, and refusing those would leave real accounts with no
    // identity at all. What must never happen is the raw value landing in the
    // column, which would violate the format CHECK.
    const id = randomUUID();
    await asSuper((q) =>
      q.query(
        `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
         values ($1, $2, $3, now())`,
        [
          id,
          `bad-shape-${randomUUID().slice(0, 8)}@test.squareshare.to`,
          JSON.stringify({ username: "not a handle!" }),
        ],
      ),
    );
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [id]),
    );
    expect(rows[0].username).toBe("not_a_handle");
  });

  it("still refuses a raw value the slug cannot rescue into a free handle", async () => {
    // Slugging does not defeat uniqueness: "Builder Boy" and "builder_boy"
    // reduce to the same handle, and the second one loses.
    await createUser(undefined, { username: "collide_me" });
    const message = await expectDbError(
      asSuper((q) =>
        q.query(
          `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
           values ($1, $2, $3, now())`,
          [
            randomUUID(),
            `collide-${randomUUID().slice(0, 8)}@test.squareshare.to`,
            JSON.stringify({ username: "Collide Me" }),
          ],
        ),
      ),
    );
    expect(message).toMatch(/profiles_username_lower_idx|unique/i);
  });
});

describe("email_by_username is service_role-only", () => {
  it("resolves a handle to the account email for service_role", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.email_by_username('builderboy') as email`),
    );
    expect(rows[0].email).toBe(holder.email);
  });

  it("folds case, exactly like profiles_username_lower_idx", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.email_by_username('  BUILDERBOY ') as email`),
    );
    expect(rows[0].email).toBe(holder.email);
  });

  it("returns nothing for a handle nobody holds", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.email_by_username('nobodyhasthis') as email`),
    );
    expect(rows[0].email).toBeNull();
  });

  it("never matches an account with no handle", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.email_by_username(null) as email`),
    );
    expect(rows[0].email).toBeNull();
  });

  it("is unreachable by anon (handle enumeration gate)", async () => {
    const message = await expectDbError(
      asAnon((q) => q.query(`select public.email_by_username('builderboy')`)),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it("is unreachable by an authenticated user too", async () => {
    // The stricter half: a signed-in caller must not be able to walk a
    // dictionary through PostgREST behind the app's back.
    const message = await expectDbError(
      asUser(other, (q) => q.query(`select public.email_by_username('builderboy')`)),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe("username_taken is service_role-only", () => {
  it("reports a held handle as taken", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.username_taken('BuilderBoy') as taken`),
    );
    expect(rows[0].taken).toBe(true);
  });

  it("reports a free handle as available", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.username_taken('nobodyhasthis') as taken`),
    );
    expect(rows[0].taken).toBe(false);
  });

  it("excludes the caller, so re-saving your own handle reads as free", async () => {
    const { rows } = await asService((q) =>
      q.query(`select public.username_taken('builderboy', $1) as taken`, [
        holder.id,
      ]),
    );
    expect(rows[0].taken).toBe(false);
  });

  it("matches underscores literally rather than as a LIKE wildcard", async () => {
    // `_` is legal in a handle AND is a single-character LIKE wildcard, so an
    // ILIKE-based check would report "a_b" as colliding with any "axb".
    await createUser(undefined, { username: "a_b_c" });
    const { rows } = await asService((q) =>
      q.query(`select public.username_taken('axbxc') as taken`),
    );
    expect(rows[0].taken).toBe(false);
  });

  it("is unreachable by anon and by authenticated", async () => {
    for (const run of [
      asAnon((q) => q.query(`select public.username_taken('builderboy')`)),
      asUser(other, (q) => q.query(`select public.username_taken('builderboy')`)),
    ]) {
      expect(await expectDbError(run)).toMatch(/permission denied/i);
    }
  });
});

describe("claiming a handle from settings", () => {
  it("lets an owner set their own username", async () => {
    await asUser(other, (q) =>
      q.query(`update public.profiles set username = 'freshhandle' where id = $1`, [
        other.id,
      ]),
    );
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [other.id]),
    );
    expect(rows[0].username).toBe("freshhandle");
  });

  it("cannot take a handle someone else holds", async () => {
    const message = await expectDbError(
      asUser(other, (q) =>
        q.query(`update public.profiles set username = 'BUILDERBOY' where id = $1`, [
          other.id,
        ]),
      ),
    );
    expect(message).toMatch(/profiles_username_lower_idx|unique/i);
  });

  it("cannot write a handle onto someone else's profile", async () => {
    // RLS, not the unique index, is what stops this one.
    await asUser(other, (q) =>
      q.query(`update public.profiles set username = 'stolen' where id = $1`, [
        holder.id,
      ]),
    );
    const { rows } = await asSuper((q) =>
      q.query(`select username from public.profiles where id = $1`, [holder.id]),
    );
    expect(rows[0].username).toBe("builderboy");
  });
});
