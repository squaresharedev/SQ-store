/**
 * Plan cancellations (20261003_plan_cancellations), against the replayed schema.
 *
 * What is proven here:
 *   - the reason codes are the TS list, code for code;
 *   - no client role can read or write the table: only the cancel action
 *     (service role) writes it, and only the admin panel (service role) reads;
 *   - a double submit cannot record the same ending twice, while a cancel
 *     after a resume records a new one;
 *   - the note's length cap and the reason list hold in the database too;
 *   - deleting the account takes its cancellations with it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";
import { CANCELLATION_DETAIL_MAX, CANCELLATION_REASONS } from "../../src/lib/billing/cancellation";

const email = (label: string) => `${label}-${randomUUID().slice(0, 6)}@test.squareshare.to`;
const ENDS_AT = "2999-01-01T00:00:00Z";

/** One cancellation as the action writes it. */
const record = (owner: TestUser, fields: { reason?: string | null; detail?: string | null; endsAt?: string } = {}) =>
  asService((q) =>
    q.query(
      `insert into public.plan_cancellations (owner_id, plan, billing_interval, reason, detail, ends_at)
       values ($1, 'starter', 'month', $2, $3, $4) returning id`,
      [owner.id, fields.reason ?? null, fields.detail ?? null, fields.endsAt ?? ENDS_AT],
    ),
  );

let seller: TestUser;
beforeAll(async () => {
  seller = await createUser(email("cancel"));
});
afterAll(closePool);

describe("plan_cancellations", () => {
  it("accepts exactly the reasons the dialog offers, or none", async () => {
    const [{ def }] = await asSuper(
      async (q) =>
        (
          await q.query(
            `select pg_get_constraintdef(oid) as def from pg_constraint
             where conrelid = 'public.plan_cancellations'::regclass and conname = 'plan_cancellations_reason_check'`,
          )
        ).rows,
    );
    const codes = [...(def as string).matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort();
    expect(codes).toEqual([...CANCELLATION_REASONS].sort());

    const owner = await createUser(email("noreason"));
    await record(owner);
    expect(await expectDbError(record(seller, { reason: "bored", endsAt: "2998-01-01T00:00:00Z" }))).toMatch(
      /plan_cancellations_reason_check/,
    );
  });

  it("is closed to anon and to the store's own owner", async () => {
    const owner = await createUser(email("closed"));
    await record(owner, { reason: "unused" });
    expect(await expectDbError(asAnon((q) => q.query(`select * from public.plan_cancellations`)))).toMatch(
      /permission denied/,
    );
    expect(
      await expectDbError(asUser(owner, (q) => q.query(`select * from public.plan_cancellations where owner_id = $1`, [owner.id]))),
    ).toMatch(/permission denied/);
    const insert = asUser(owner, (q) =>
      q.query(
        `insert into public.plan_cancellations (owner_id, plan, billing_interval, ends_at) values ($1, 'pro', 'year', now())`,
        [owner.id],
      ),
    );
    expect(await expectDbError(insert)).toMatch(/permission denied/);
    const resume = asUser(owner, (q) => q.query(`update public.plan_cancellations set resumed_at = now()`));
    expect(await expectDbError(resume)).toMatch(/permission denied/);
  });

  it("records one open cancellation per ending, and a fresh one after a resume", async () => {
    const owner = await createUser(email("twice"));
    await record(owner, { reason: "too_expensive" });
    expect(await expectDbError(record(owner, { reason: "too_expensive" }))).toMatch(/plan_cancellations_open_idx/);

    await asService((q) =>
      q.query(`update public.plan_cancellations set resumed_at = now() where owner_id = $1 and resumed_at is null`, [owner.id]),
    );
    await record(owner, { reason: "other" });
    const rows = await asService(
      async (q) =>
        (await q.query(`select reason, resumed_at from public.plan_cancellations where owner_id = $1 order by created_at`, [owner.id]))
          .rows,
    );
    expect(rows.map((row) => [row.reason, row.resumed_at !== null])).toEqual([
      ["too_expensive", true],
      ["other", false],
    ]);
  });

  it("caps the note at the dialog's limit", async () => {
    const owner = await createUser(email("long"));
    await record(owner, { detail: "x".repeat(CANCELLATION_DETAIL_MAX) });
    expect(
      await expectDbError(record(owner, { detail: "x".repeat(CANCELLATION_DETAIL_MAX + 1), endsAt: "2998-01-01T00:00:00Z" })),
    ).toMatch(/plan_cancellations_detail_check/);
  });

  it("goes with the account", async () => {
    const owner = await createUser(email("gone"));
    await record(owner, { reason: "switched_service" });
    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [owner.id]));
    const [{ count }] = await asService(
      async (q) => (await q.query(`select count(*)::int as count from public.plan_cancellations where owner_id = $1`, [owner.id])).rows,
    );
    expect(count).toBe(0);
  });
});
