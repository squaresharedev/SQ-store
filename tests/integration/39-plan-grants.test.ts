/**
 * Plan grants (20261019_plan_grants) and the admin panel's plan directory
 * (Admin 0009_plan_directory), against the replayed schema.
 *
 * What is proven here:
 *   - the reason codes are the TS list, code for code;
 *   - no client role can read or write a grant, or run the admin writes;
 *   - account_plan() (what the limit triggers ask) answers the HIGHER of the
 *     paid plan and an active grant, ignores an ended one, and ties go to the
 *     paid plan in the directory, the same rule as grantedPlan() in TS;
 *   - plan_grant_set keeps the start of an active grant, starts an ended one
 *     afresh, refuses an end in the past and skips ids with no profile;
 *   - plan_grant_end ends only active grants and returns what it ended;
 *   - the directory is service-role only and agrees with account_plan();
 *   - deleting the account takes its grant with it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";
import { GRANT_REASONS } from "../../src/lib/billing/grants";

const email = (label: string) => `${label}-${randomUUID().slice(0, 6)}@test.squareshare.to`;
const IN_A_MONTH = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

type SetRow = { owner_id: string; previous_plan: string | null; previous_ends_at: string | null; was_active: boolean };

/** plan_grant_set as the admin panel calls it. */
const grant = (
  owners: string[],
  plan: string,
  endsAt: string | null,
  fields: { reason?: string; note?: string | null; actor?: string } = {},
) =>
  asService(
    async (q) =>
      (
        await q.query<SetRow>(`select * from public.plan_grant_set($1::uuid[], $2, $3, $4, $5, $6)`, [
          owners,
          plan,
          endsAt,
          fields.reason ?? "beta_tester",
          fields.note ?? null,
          fields.actor ?? randomUUID(),
        ])
      ).rows,
  );

const endGrants = (owners: string[]) =>
  asService(
    async (q) =>
      (await q.query(`select * from public.plan_grant_end($1::uuid[], $2)`, [owners, randomUUID()])).rows as {
        owner_id: string;
        previous_plan: string;
      }[],
  );

const accountPlan = (owner: TestUser) =>
  asService(async (q) => (await q.query(`select public.account_plan($1) as plan`, [owner.id])).rows[0].plan as string);

const grantRow = (owner: TestUser) =>
  asService(
    async (q) =>
      (await q.query(`select plan, reason, note, starts_at, ends_at from public.plan_grants where owner_id = $1`, [owner.id]))
        .rows[0] as { plan: string; reason: string; note: string | null; starts_at: Date; ends_at: Date | null } | undefined,
  );

/** A paid plan as the Stripe webhook would leave it. */
const pay = (owner: TestUser, plan: "starter" | "pro", paidUntil = IN_A_MONTH()) =>
  asService((q) =>
    q.query(
      `insert into public.seller_billing (owner_id, stripe_customer_id, plan, status, paid_until)
       values ($1, $2, $3, 'active', $4)`,
      [owner.id, `cus_${randomUUID().replace(/-/g, "")}`, plan, paidUntil],
    ),
  );

/** Move a grant into the past (as if time had passed): shifts both ends. */
const ageGrant = (owner: TestUser, ended: boolean) =>
  asSuper((q) =>
    q.query(
      `update public.plan_grants
          set starts_at = now() - interval '60 days',
              ends_at = case when $2 then now() - interval '1 day' else ends_at end
        where owner_id = $1`,
      [owner.id, ended],
    ),
  );

let seller: TestUser;
beforeAll(async () => {
  seller = await createUser(email("grant"));
});
afterAll(closePool);

describe("plan_grants", () => {
  it("accepts exactly the reasons the admin panel offers", async () => {
    const [{ def }] = await asSuper(
      async (q) =>
        (
          await q.query(
            `select pg_get_constraintdef(oid) as def from pg_constraint
             where conrelid = 'public.plan_grants'::regclass and conname = 'plan_grants_reason_check'`,
          )
        ).rows,
    );
    const codes = [...(def as string).matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort();
    expect(codes).toEqual([...GRANT_REASONS].sort());

    expect(await expectDbError(grant([seller.id], "pro", null, { reason: "friend" }))).toMatch(/plan_grants_reason_check/);
    expect(await expectDbError(grant([seller.id], "free", null))).toMatch(/plan_grants_plan_check/);
    expect(await expectDbError(grant([seller.id], "pro", null, { note: "x".repeat(501) }))).toMatch(
      /plan_grants_note_length/,
    );
  });

  it("is closed to anon and to the account's own owner, writes and functions included", async () => {
    const owner = await createUser(email("closed"));
    await grant([owner.id], "starter", null);

    expect(await expectDbError(asAnon((q) => q.query(`select * from public.plan_grants`)))).toMatch(/permission denied/);
    expect(
      await expectDbError(asUser(owner, (q) => q.query(`select * from public.plan_grants where owner_id = $1`, [owner.id]))),
    ).toMatch(/permission denied/);
    const selfGrant = asUser(owner, (q) =>
      q.query(`insert into public.plan_grants (owner_id, plan, reason) values ($1, 'pro', 'other')`, [owner.id]),
    );
    expect(await expectDbError(selfGrant)).toMatch(/permission denied/);
    const extend = asUser(owner, (q) => q.query(`update public.plan_grants set ends_at = null`));
    expect(await expectDbError(extend)).toMatch(/permission denied/);

    for (const call of [
      `select public.plan_grant_set(array['${owner.id}']::uuid[], 'pro', null, 'other', null, '${owner.id}')`,
      `select public.plan_grant_end(array['${owner.id}']::uuid[], '${owner.id}')`,
      `select public.account_plan('${owner.id}')`,
    ]) {
      expect(await expectDbError(asUser(owner, (q) => q.query(call)))).toMatch(/permission denied/);
      expect(await expectDbError(asAnon((q) => q.query(call)))).toMatch(/permission denied/);
    }
  });

  it("puts the account on the granted plan, and back when the grant ends", async () => {
    const owner = await createUser(email("plan"));
    expect(await accountPlan(owner)).toBe("free");

    const [row] = await grant([owner.id], "pro", IN_A_MONTH(), { note: "  launch partner  " });
    expect(row).toMatchObject({ owner_id: owner.id, previous_plan: null, was_active: false });
    expect(await accountPlan(owner)).toBe("pro");
    expect((await grantRow(owner))?.note).toBe("launch partner");

    const ended = await endGrants([owner.id]);
    expect(ended).toEqual([expect.objectContaining({ owner_id: owner.id, previous_plan: "pro" })]);
    expect(await accountPlan(owner)).toBe("free");
    // The row stays, ended, so the seller's page can say when it stopped.
    expect((await grantRow(owner))?.ends_at).not.toBeNull();
    // Ending again ends nothing.
    expect(await endGrants([owner.id])).toEqual([]);
  });

  it("answers the higher of a paid plan and a grant, and never lowers a paid one", async () => {
    const payingStarter = await createUser(email("paystarter"));
    await pay(payingStarter, "starter");
    await grant([payingStarter.id], "pro", null);
    expect(await accountPlan(payingStarter)).toBe("pro");

    const payingPro = await createUser(email("paypro"));
    await pay(payingPro, "pro");
    await grant([payingPro.id], "starter", IN_A_MONTH());
    expect(await accountPlan(payingPro)).toBe("pro");

    // A lapsed subscription is Free, and the grant decides alone.
    const lapsed = await createUser(email("lapsed"));
    await pay(lapsed, "pro", new Date(Date.now() - 86_400_000).toISOString());
    await grant([lapsed.id], "starter", IN_A_MONTH());
    expect(await accountPlan(lapsed)).toBe("starter");
  });

  it("keeps an active grant's start when it is extended or changed, and starts an ended one afresh", async () => {
    const owner = await createUser(email("extend"));
    await grant([owner.id], "starter", IN_A_MONTH());
    await ageGrant(owner, false);
    const started = (await grantRow(owner))!.starts_at;

    const [changed] = await grant([owner.id], "pro", null, { reason: "founding_seller" });
    expect(changed).toMatchObject({ previous_plan: "starter", was_active: true });
    const after = (await grantRow(owner))!;
    expect(after).toMatchObject({ plan: "pro", reason: "founding_seller", ends_at: null });
    expect(after.starts_at.getTime()).toBe(started.getTime());

    await ageGrant(owner, true);
    expect(await accountPlan(owner)).toBe("free");
    const [renewed] = await grant([owner.id], "starter", IN_A_MONTH());
    expect(renewed).toMatchObject({ previous_plan: null, previous_ends_at: null, was_active: false });
    expect((await grantRow(owner))!.starts_at.getTime()).toBeGreaterThan(started.getTime());
    expect(await accountPlan(owner)).toBe("starter");
  });

  it("grants many accounts at once, skipping ids with no account and refusing an end in the past", async () => {
    const [a, b] = await Promise.all([createUser(email("bulka")), createUser(email("bulkb"))]);
    const ghost = randomUUID();
    const rows = await grant([a.id, b.id, a.id, ghost], "pro", IN_A_MONTH());
    expect(rows.map((row) => row.owner_id).sort()).toEqual([a.id, b.id].sort());
    expect(await accountPlan(a)).toBe("pro");
    expect(await accountPlan(b)).toBe("pro");

    const past = new Date(Date.now() - 60_000).toISOString();
    expect(await expectDbError(grant([a.id], "starter", past))).toMatch(/plan_grant_ends_in_past/);
    // The refused call changed nothing.
    expect((await grantRow(a))?.plan).toBe("pro");

    const ended = await endGrants([a.id, b.id, ghost]);
    expect(ended.map((row) => row.owner_id).sort()).toEqual([a.id, b.id].sort());
  });

  it("goes with the account", async () => {
    const owner = await createUser(email("cascade"));
    await grant([owner.id], "pro", null);
    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [owner.id]));
    expect(await grantRow(owner)).toBeUndefined();
  });
});

describe("admin_plan_directory", () => {
  type DirectoryRow = {
    effective_plan: string;
    plan_source: string;
    plan_until: Date | null;
    grant_active: boolean;
    grant_plan: string | null;
    paid_plan: string | null;
  };
  const directoryRow = (owner: TestUser) =>
    asService(
      async (q) =>
        (await q.query(`select * from public.admin_plan_directory where id = $1`, [owner.id])).rows[0] as DirectoryRow,
    );

  it("is service-role only", async () => {
    const owner = await createUser(email("dirclosed"));
    expect(await expectDbError(asAnon((q) => q.query(`select * from public.admin_plan_directory`)))).toMatch(
      /permission denied/,
    );
    expect(await expectDbError(asUser(owner, (q) => q.query(`select * from public.admin_plan_directory`)))).toMatch(
      /permission denied/,
    );
    // No client role holds any right on it, write rights included (PostgREST
    // grants a new view to both, and a simple view is updatable).
    const grants = await asSuper(
      async (q) =>
        (
          await q.query(
            `select grantee, privilege_type from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'admin_plan_directory'
                and grantee in ('anon', 'authenticated', 'PUBLIC')`,
          )
        ).rows,
    );
    expect(grants).toEqual([]);
  });

  it("names the plan in force and where it comes from, agreeing with account_plan()", async () => {
    const free = await createUser(email("dirfree"));
    expect(await directoryRow(free)).toMatchObject({ effective_plan: "free", plan_source: "free", plan_until: null });

    const granted = await createUser(email("dirgrant"));
    const until = IN_A_MONTH();
    await grant([granted.id], "starter", until);
    const grantedRow = await directoryRow(granted);
    expect(grantedRow).toMatchObject({ effective_plan: "starter", plan_source: "granted", grant_active: true });
    expect(grantedRow.plan_until?.toISOString()).toBe(new Date(until).toISOString());

    // A tie goes to the plan being paid for.
    const tie = await createUser(email("dirtie"));
    await pay(tie, "pro");
    await grant([tie.id], "pro", null);
    expect(await directoryRow(tie)).toMatchObject({ effective_plan: "pro", plan_source: "paid" });

    const higher = await createUser(email("dirhigher"));
    await pay(higher, "starter");
    await grant([higher.id], "pro", null);
    expect(await directoryRow(higher)).toMatchObject({ effective_plan: "pro", plan_source: "granted", plan_until: null });

    for (const owner of [free, granted, tie, higher]) {
      expect((await directoryRow(owner)).effective_plan).toBe(await accountPlan(owner));
    }

    await endGrants([granted.id]);
    expect(await directoryRow(granted)).toMatchObject({ effective_plan: "free", plan_source: "free", grant_active: false });
  });
});
