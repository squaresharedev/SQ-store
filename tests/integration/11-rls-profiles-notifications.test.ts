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
    display_name: "Alice",
  });
  bob = await createUser("bob-prof@test.squareshare.to", { display_name: "Bob" });

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
      q.query(`update public.profiles set display_name = 'Pwned' where id = $1`, [alice.id]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("users cannot INSERT profiles directly (trigger-only creation)", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(`insert into public.profiles (id, display_name) values ($1, 'fake')`, [bob.id]),
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

  it("display-name uniqueness is enforced case-insensitively at the DB", async () => {
    await asUser(alice, (q) =>
      q.query(`update public.profiles set display_name = 'UniqueName' where id = $1`, [alice.id]),
    );
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(`update public.profiles set display_name = 'uniquename' where id = $1`, [bob.id]),
      ),
    );
    expect(msg).toMatch(/duplicate key|profiles_display_name_lower_idx/i);
  });

  it("is_display_name_available: taken names report false, own name reports true", async () => {
    const taken = await asUser(bob, (q) =>
      q.query(`select public.is_display_name_available('UniqueName') as ok`),
    );
    expect(taken.rows[0].ok).toBe(false);

    const own = await asUser(alice, (q) =>
      q.query(`select public.is_display_name_available('uniquename') as ok`),
    );
    expect(own.rows[0].ok).toBe(true);
  });

  it("anon cannot call is_display_name_available (name enumeration gate)", async () => {
    const msg = await expectDbError(
      asAnon((q) => q.query(`select public.is_display_name_available('anything')`)),
    );
    expect(msg).toMatch(/permission denied/i);
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
