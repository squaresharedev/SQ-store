/**
 * RLS isolation: profiles + notifications (+ rate_limits + admin/waitlist
 * surfaces that share the schema).
 */
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

let alice: TestUser;
let bob: TestUser;
let aliceNotificationId: string;

beforeAll(async () => {
  alice = await createUser("alice-prof@test.squareshare.to", {
    username: "alice",
  });
  bob = await createUser("bob-prof@test.squareshare.to", { username: "bob" });

  aliceNotificationId = await asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.notifications (user_id, type, title, body)
       values ($1, 'team', 'Welcome', 'hello') returning id`,
      [alice.id],
    );
    return rows[0].id;
  });
});

afterAll(closePool);

describe("profiles RLS", () => {
  it("users read only their own profile", async () => {
    const mine = await asUser(alice, (q) => q.query(`select id from public.profiles`));
    expect(mine.rows).toEqual([{ id: alice.id }]);
  });

  it("users cannot update another's profile", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`update public.profiles set username = 'pwned' where id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("users cannot INSERT profiles directly (trigger-only creation)", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(`insert into public.profiles (id, username) values ($1, 'fake')`, [bob.id]),
      ),
    );
    // bob already has a row (pkey) OR RLS rejects — either way the write path is closed.
    expect(msg).toMatch(/row-level security|duplicate key/i);
  });

  it("users cannot DELETE profiles (no delete policy)", async () => {
    const res = await asUser(alice, (q) =>
      q.query(`delete from public.profiles where id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("username uniqueness is enforced case-insensitively at the DB", async () => {
    // One identifier now, so this index is the only thing standing between two
    // accounts and the same identity.
    await asUser(alice, (q) =>
      q.query(`update public.profiles set username = 'uniquename' where id = $1`, [alice.id]),
    );
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(`update public.profiles set username = 'UniqueName' where id = $1`, [bob.id]),
      ),
    );
    expect(msg).toMatch(/duplicate key|profiles_username_lower_idx/i);
  });

  it("the display-name availability RPC is gone with the column", async () => {
    // Its job passed to username_taken, which is service_role-only rather than
    // callable by any signed-in user.
    const msg = await expectDbError(
      asUser(alice, (q) => q.query(`select public.is_display_name_available('anything')`)),
    );
    expect(msg).toMatch(/does not exist/i);
  });

  it("username_taken stays unreachable by anon and authenticated", async () => {
    for (const run of [
      asAnon((q) => q.query(`select public.username_taken('uniquename')`)),
      asUser(bob, (q) => q.query(`select public.username_taken('uniquename')`)),
    ]) {
      expect(await expectDbError(run)).toMatch(/permission denied/i);
    }
  });
});

describe("notifications RLS + grants", () => {
  it("owner reads own notifications; stranger sees none", async () => {
    const mine = await asUser(alice, (q) => q.query(`select id from public.notifications`));
    expect(mine.rows).toEqual([{ id: aliceNotificationId }]);

    const theirs = await asUser(bob, (q) => q.query(`select id from public.notifications`));
    expect(theirs.rows).toHaveLength(0);
  });

  it("clients cannot INSERT notifications — even addressed to themselves", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(
          `insert into public.notifications (user_id, type, title) values ($1, 'system', 'spoof')`,
          [bob.id],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied/i); // no INSERT grant at all
  });

  it("clients can update ONLY the read column on their own rows", async () => {
    const ok = await asUser(alice, (q) =>
      q.query(`update public.notifications set read = true where id = $1`, [aliceNotificationId]),
    );
    expect(ok.rowCount).toBe(1);

    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(`update public.notifications set title = 'edited' where id = $1`, [
          aliceNotificationId,
        ]),
      ),
    );
    expect(msg).toMatch(/permission denied/i); // column-level grant blocks title
  });

  it("stranger cannot mark another's notification read", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`update public.notifications set read = true where id = $1`, [aliceNotificationId]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("clients cannot DELETE notifications", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(`delete from public.notifications where id = $1`, [aliceNotificationId]),
      ),
    );
    expect(msg).toMatch(/permission denied/i);
  });

  it("user_id_by_email resolver is service_role-only (no email→id oracle)", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) => q.query(`select public.user_id_by_email($1)`, [alice.email])),
    );
    expect(msg).toMatch(/permission denied/i);

    const ok = await asService((q) =>
      q.query(`select public.user_id_by_email($1) as id`, [alice.email]),
    );
    expect(ok.rows[0].id).toBe(alice.id);
  });
});

describe("rate_limits table + rl_take()", () => {
  it("clients can never touch the rate_limits table directly", async () => {
    const read = await asUser(alice, (q) => q.query(`select * from public.rate_limits`));
    // RLS with no policies -> zero rows (grant exists via default privileges).
    expect(read.rows).toHaveLength(0);

    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(
          `insert into public.rate_limits (user_id, action, hits) values ($1, 'x', '{}')`,
          [alice.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("rl_take enforces the cap within a window", async () => {
    const takes: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { rows } = await asUser(alice, (q) =>
        q.query(`select public.rl_take('test_action', 3, 3600) as ok`),
      );
      takes.push(rows[0].ok);
    }
    expect(takes).toEqual([true, true, true, false]);
  });

  it("rl_take keys off auth.uid(): another user has an independent budget", async () => {
    const { rows } = await asUser(bob, (q) =>
      q.query(`select public.rl_take('test_action', 3, 3600) as ok`),
    );
    expect(rows[0].ok).toBe(true);
  });

  it("hits age out of the window", async () => {
    await asUser(alice, (q) => q.query(`select public.rl_take('expire_action', 1, 3600)`));
    const denied = await asUser(alice, (q) =>
      q.query(`select public.rl_take('expire_action', 1, 3600) as ok`),
    );
    expect(denied.rows[0].ok).toBe(false);

    // Backdate the recorded hit past the window; it should fall out of the
    // sliding count and free the budget.
    await asSuper((q) =>
      q.query(
        `update public.rate_limits
            set hits = array(select now() - interval '2 hours' from unnest(hits))
          where user_id = $1 and action = 'expire_action'`,
        [alice.id],
      ),
    );
    const renewed = await asUser(alice, (q) =>
      q.query(`select public.rl_take('expire_action', 1, 3600) as ok`),
    );
    expect(renewed.rows[0].ok).toBe(true);
  });

  // REGRESSION: the limiter used to be a fixed window that hard-reset its
  // counter once window_start aged out. That let a caller spend the whole
  // budget just before the boundary and the whole budget again just after
  // (send at 20:59, send again at 21:01). A sliding window has no such
  // boundary — these two cases pin that down.
  it("does not reset at a window boundary (spend-before / spend-after)", async () => {
    const take = () =>
      asUser(alice, (q) =>
        q.query(`select public.rl_take('boundary_action', 3, 3600) as ok`),
      ).then((r) => r.rows[0].ok as boolean);

    expect([await take(), await take(), await take()]).toEqual([true, true, true]);
    expect(await take()).toBe(false);

    // Age the burst to 59 minutes: still inside a 60-minute window. A fixed
    // window whose start had rolled over would wrongly hand back a full budget.
    await asSuper((q) =>
      q.query(
        `update public.rate_limits
            set hits = array(select now() - interval '59 minutes' from unnest(hits))
          where user_id = $1 and action = 'boundary_action'`,
        [alice.id],
      ),
    );
    expect(await take()).toBe(false);

    // Past the window the same hits drop out and the budget genuinely returns.
    await asSuper((q) =>
      q.query(
        `update public.rate_limits
            set hits = array(select now() - interval '61 minutes' from unnest(hits))
          where user_id = $1 and action = 'boundary_action'`,
        [alice.id],
      ),
    );
    expect(await take()).toBe(true);
  });

  it("denied takes do not extend the window or grow the log", async () => {
    const take = () =>
      asUser(alice, (q) =>
        q.query(`select public.rl_take('nogrow_action', 2, 3600) as ok`),
      ).then((r) => r.rows[0].ok as boolean);

    await take();
    await take();
    // Hammer well past the cap; every one of these must be refused.
    for (let i = 0; i < 5; i += 1) expect(await take()).toBe(false);

    // The log is bounded by max: only ALLOWED takes are recorded.
    const { rows } = await asSuper((q) =>
      q.query(
        `select coalesce(array_length(hits, 1), 0) as n
           from public.rate_limits where user_id = $1 and action = 'nogrow_action'`,
        [alice.id],
      ),
    );
    expect(rows[0].n).toBe(2);
  });

  it("anon rl_take is denied outright", async () => {
    const msg = await expectDbError(
      asAnon((q) => q.query(`select public.rl_take('x', 1, 60)`)),
    );
    expect(msg).toMatch(/permission denied/i);
  });
});

describe("admin + waitlist surfaces", () => {
  it("non-staff users read zero rows from admin tables", async () => {
    const a = await asUser(alice, (q) => q.query(`select * from public.admin_users`));
    expect(a.rows).toHaveLength(0);
    const b = await asUser(alice, (q) => q.query(`select * from public.admin_audit_log`));
    expect(b.rows).toHaveLength(0);
  });

  it("non-staff cannot self-append to admin_users", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(`insert into public.admin_users (user_id, role) values ($1, 'owner')`, [alice.id]),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("admin_user_directory view is service_role-only (auth.users leak guard)", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) => q.query(`select * from public.admin_user_directory`)),
    );
    expect(msg).toMatch(/permission denied/i);

    const anonMsg = await expectDbError(
      asAnon((q) => q.query(`select * from public.admin_user_directory`)),
    );
    expect(anonMsg).toMatch(/permission denied/i);
  });

  it("anyone may JOIN the waitlist but nobody may read it back", async () => {
    const insert = await asAnon((q) =>
      q.query(`insert into public.waitlist_signups (email) values ('lurker@example.com')`),
    );
    expect(insert.rowCount).toBe(1);

    const read = await asUser(alice, (q) => q.query(`select * from public.waitlist_signups`));
    expect(read.rows).toHaveLength(0);
  });

  it("staff membership grants admin reads", async () => {
    const staff = await createUser("staff@test.squareshare.to");
    await asService((q) =>
      q.query(`insert into public.admin_users (user_id, role) values ($1, 'staff')`, [staff.id]),
    );
    const rows = await asUser(staff, (q) => q.query(`select user_id from public.admin_users`));
    expect(rows.rows.map((r) => r.user_id)).toContain(staff.id);
  });
});

describe("user_has_password + security_events", () => {
  it("user_has_password is service_role-only", async () => {
    // It reads auth.users and takes a caller-supplied id, so exposing it would
    // answer "does this account have a password?" about anybody.
    for (const run of [
      asAnon((q) => q.query(`select public.user_has_password($1)`, [alice.id])),
      asUser(bob, (q) => q.query(`select public.user_has_password($1)`, [alice.id])),
    ]) {
      expect(await expectDbError(run)).toMatch(/permission denied/i);
    }

    const ok = await asService((q) =>
      q.query(`select public.user_has_password($1) as has`, [alice.id]),
    );
    expect(typeof ok.rows[0].has).toBe("boolean");
  });

  it("answers from the password HASH, not from the identities list", async () => {
    // The whole point: an OAuth account that set a password through recovery
    // has a hash but no `email` identity row. The old check read that as "no
    // password" and skipped email-change re-authentication.
    await asSuper((q) =>
      q.query(`update auth.users set encrypted_password = '$2a$10$fakehashfakehashfake' where id = $1`, [
        alice.id,
      ]),
    );
    await asSuper((q) =>
      q.query(`update auth.users set encrypted_password = null where id = $1`, [bob.id]),
    );

    const aliceHas = await asService((q) =>
      q.query(`select public.user_has_password($1) as has`, [alice.id]),
    );
    const bobHas = await asService((q) =>
      q.query(`select public.user_has_password($1) as has`, [bob.id]),
    );

    // Neither account has an `email` identity (the shim has no identities
    // table at all, and these users were created straight into auth.users), so
    // the OLD signal would have answered false for both. The hash is what
    // separates them.
    expect(aliceHas.rows[0].has).toBe(true);
    expect(bobHas.rows[0].has).toBe(false);
  });

  it("security_events: the owner reads their own and nobody else's", async () => {
    await asService((q) =>
      q.query(
        `insert into public.security_events (user_id, event) values ($1, 'password.changed')`,
        [alice.id],
      ),
    );

    const mine = await asUser(alice, (q) =>
      q.query(`select event from public.security_events`),
    );
    expect(mine.rows).toEqual([{ event: "password.changed" }]);

    const theirs = await asUser(bob, (q) =>
      q.query(`select event from public.security_events`),
    );
    expect(theirs.rows).toHaveLength(0);
  });

  it("security_events is APPEND-ONLY to clients: no insert, update or delete", async () => {
    // An audit log a suspect can write to is worse than no audit log. There is
    // no insert/update/delete policy at all, and the table grant is SELECT only.
    const forged = await expectDbError(
      asUser(bob, (q) =>
        q.query(
          `insert into public.security_events (user_id, event) values ($1, 'password.changed')`,
          [bob.id],
        ),
      ),
    );
    expect(forged).toMatch(/permission denied/i);

    // Even aimed at their OWN row, and even as anon.
    expect(
      await expectDbError(
        asAnon((q) =>
          q.query(
            `insert into public.security_events (user_id, event) values ($1, 'password.changed')`,
            [alice.id],
          ),
        ),
      ),
    ).toMatch(/permission denied/i);

    expect(
      await expectDbError(
        asUser(alice, (q) =>
          q.query(`update public.security_events set event = 'nope'`),
        ),
      ),
    ).toMatch(/permission denied/i);

    expect(
      await expectDbError(
        asUser(alice, (q) => q.query(`delete from public.security_events`)),
      ),
    ).toMatch(/permission denied/i);
  });

  it("refuses an event slug outside the shape the column allows", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.security_events (user_id, event) values ($1, 'Password Changed!')`,
          [alice.id],
        ),
      ),
    );
    expect(message).toMatch(/check constraint|security_events_event/i);
  });
});

describe("notification type vocabulary", () => {
  it("the DB CHECK accepts every type the app can emit", async () => {
    // These two lists drift silently: createNotification is best-effort, so a
    // type the app knows and the constraint does not fails the insert and the
    // caller never hears about it. That is how the first "security" alert went
    // missing after a password change.
    const appTypes = ["team", "payment", "stock", "order", "system", "security"];
    for (const type of appTypes) {
      await asService((q) =>
        q.query(
          `insert into public.notifications (user_id, type, title) values ($1, $2, 'vocabulary probe')`,
          [alice.id, type],
        ),
      );
    }
    const { rows } = await asService((q) =>
      q.query(
        `select count(*)::int as n from public.notifications where user_id = $1 and title = 'vocabulary probe'`,
        [alice.id],
      ),
    );
    expect(rows[0].n).toBe(appTypes.length);
  });

  it("still refuses a type outside that list", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.notifications (user_id, type, title) values ($1, 'invented', 'x')`,
          [alice.id],
        ),
      ),
    );
    expect(message).toMatch(/notifications_type_check|check constraint/i);
  });
});
