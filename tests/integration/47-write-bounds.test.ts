/**
 * 20261105_write_bounds, against the replayed schema.
 *
 * Supabase's gateway takes a 32 MB body, so a direct PostgREST write is only
 * bounded by the database. What is proven here:
 *   - the columns that had no size bound refuse what no app form could send;
 *   - one account cannot hold more than the ceiling of products or
 *     storefronts, whatever the plan switch says; the service role is exempt;
 *   - anonymous inserts are capped per minute across the platform, and cannot
 *     be backdated past the window;
 *   - a client can only point its profile picture at one moderation approved;
 *   - rl_take refuses a made-up action name of any length.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";

afterAll(closePool);

let seller: TestUser;

beforeAll(async () => {
  seller = await createUser();
});

describe("sizes", () => {
  it("refuses a product title, description or storefront design no form could send", async () => {
    for (const [sql, value] of [
      [`insert into public.products (owner_id, title, price_cents) values ($1, $2, 100)`, "x".repeat(501)],
      [`insert into public.products (owner_id, title, price_cents, description) values ($1, 'Lamp', 100, $2)`, "x".repeat(20001)],
      [`insert into public.storefronts (owner_id, name, config) values ($1, 'Shop', jsonb_build_object('pad', $2::text))`, "x".repeat(1100000)],
    ] as const) {
      const msg = await expectDbError(asUser(seller, (q) => q.query(sql, [seller.id, value])));
      expect(msg).toMatch(/check constraint/i);
    }
  });

  it("still takes what the app sends", async () => {
    const { rowCount } = await asUser(seller, (q) =>
      q.query(`insert into public.products (owner_id, title, price_cents, description) values ($1, $2, 100, $3)`, [
        seller.id,
        "x".repeat(200),
        "x".repeat(5000),
      ]),
    );
    expect(rowCount).toBe(1);
  });

  it("refuses a rate-limit name no caller uses", async () => {
    const msg = await expectDbError(
      asUser(seller, (q) => q.query(`select public.rl_take($1, 5, 60)`, ["a".repeat(65)])),
    );
    expect(msg).toMatch(/check constraint/i);
  });
});

describe("how many rows one account holds", () => {
  it("stops a client at the ceiling, plan switch off, and lets the service role past it", async () => {
    const owner = await createUser();
    await asService((q) =>
      q.query(
        `insert into public.storefronts (owner_id, name) select $1, 'Shop ' || g from generate_series(1, 200) g`,
        [owner.id],
      ),
    );
    const msg = await expectDbError(
      asUser(owner, (q) => q.query(`insert into public.storefronts (owner_id, name) values ($1, 'One more')`, [owner.id])),
    );
    expect(msg).toMatch(/account_ceiling_reached:storefronts/);
    const { rowCount } = await asService((q) =>
      q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Seeded')`, [owner.id]),
    );
    expect(rowCount).toBe(1);
  });

  it("counts products the same way", async () => {
    const owner = await createUser();
    await asService((q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents) select $1, 'P' || g, 100 from generate_series(1, 2000) g`,
        [owner.id],
      ),
    );
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(`insert into public.products (owner_id, title, price_cents) values ($1, 'One more', 100)`, [owner.id]),
      ),
    );
    expect(msg).toMatch(/account_ceiling_reached:products/);
  });
});

describe("anonymous inserts", () => {
  /** Insert until refused, each in its own transaction; how many went in. */
  async function fillUntilRefused(insert: () => Promise<unknown>, max: number): Promise<{ taken: number; error: string }> {
    for (let taken = 0; taken <= max; taken++) {
      try {
        await insert();
      } catch (error) {
        return { taken, error: error instanceof Error ? error.message : String(error) };
      }
    }
    throw new Error(`more than ${max} anonymous inserts went through in one minute`);
  }

  it("caps the waitlist per minute, and stamps each row with the real time", async () => {
    const early = `early-${randomUUID()}@example.com`;
    await asAnon((q) =>
      q.query(`insert into public.waitlist_signups (email, created_at) values ($1, '2000-01-01')`, [early]),
    );
    const { rows } = await asSuper((q) =>
      q.query(`select created_at > now() - interval '1 hour' as recent from public.waitlist_signups where email = $1`, [
        early,
      ]),
    );
    expect(rows).toEqual([{ recent: true }]);

    const { taken, error } = await fillUntilRefused(
      () =>
        asAnon((q) =>
          q.query(`insert into public.waitlist_signups (email) values ($1)`, [`w-${randomUUID()}@example.com`]),
        ),
      60,
    );
    expect(taken).toBeLessThan(60);
    expect(error).toMatch(/Too many at once/);
  });

  it("caps consent records per minute", async () => {
    const { taken, error } = await fillUntilRefused(
      () =>
        asAnon((q) =>
          q.query(
            `insert into public.consent_logs (consented_at, choices, policy_version, method)
             values (now(), '{"analytics": false}'::jsonb, 'v1', 'reject_all')`,
          ),
        ),
      120,
    );
    expect(taken).toBeLessThanOrEqual(120);
    expect(error).toMatch(/Too many at once/);
  });
});

describe("profile pictures", () => {
  it("are only ones moderation approved, when a client sets them", async () => {
    const elsewhere = await expectDbError(
      asUser(seller, (q) =>
        q.query(`update public.profiles set avatar_url = 'https://attacker.example/pixel.gif' where id = $1`, [seller.id]),
      ),
    );
    expect(elsewhere).toMatch(/uploading it, not by naming it/);

    const approved = `https://x.test/${randomUUID()}.webp`;
    await asService((q) =>
      q.query(`insert into public.moderation_checks (subject, verdict, source) values ($1, 'clean', 'model')`, [
        `avatar:${approved}`,
      ]),
    );
    const set = await asUser(seller, (q) =>
      q.query(`update public.profiles set avatar_url = $2 where id = $1`, [seller.id, approved]),
    );
    expect(set.rowCount).toBe(1);
    const cleared = await asUser(seller, (q) =>
      q.query(`update public.profiles set avatar_url = null where id = $1`, [seller.id]),
    );
    expect(cleared.rowCount).toBe(1);
  });
});
