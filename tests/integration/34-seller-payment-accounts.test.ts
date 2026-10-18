/**
 * Seller payment accounts (20261008_seller_payment_accounts), against the
 * replayed schema.
 *
 * The table is the TRUST ANCHOR of buyer payments: an event from Stripe names
 * a connected account, and this row is what turns that into a seller. So what
 * is proven here is that nobody but the server can read or write it, that one
 * seller has one account and one account one seller, and that a refund or a
 * dispute can find its order by the payment it names.
 */
import { randomUUID } from "node:crypto";
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

let owner: TestUser;
let other: TestUser;

const accountId = () => `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

const connect = (user: TestUser, stripeAccountId: string) =>
  asService((q) =>
    q.query(`insert into public.seller_payment_accounts (owner_id, stripe_account_id) values ($1, $2)`, [
      user.id,
      stripeAccountId,
    ]),
  );

beforeAll(async () => {
  owner = await createUser(`owner-pay-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  other = await createUser(`other-pay-${randomUUID().slice(0, 6)}@test.squareshare.to`);
});

afterAll(closePool);

describe("seller_payment_accounts", () => {
  it("starts an account as unable to take payments, in test mode", async () => {
    const id = accountId();
    await connect(owner, id);
    const row = await asService(async (q) =>
      (await q.query(`select * from public.seller_payment_accounts where owner_id = $1`, [owner.id])).rows[0],
    );
    expect(row).toMatchObject({
      stripe_account_id: id,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      livemode: false,
    });
  });

  it("is the server's alone: a seller cannot read their own row, let alone write one", async () => {
    expect(await expectDbError(asUser(owner, (q) => q.query(`select * from public.seller_payment_accounts`)))).toMatch(
      /permission denied/,
    );
    expect(await expectDbError(asAnon((q) => q.query(`select * from public.seller_payment_accounts`)))).toMatch(
      /permission denied/,
    );
    // The write that would matter most: pointing someone else's payments at
    // an account of your own, or marking your own as cleared.
    expect(
      await expectDbError(
        asUser(other, (q) =>
          q.query(`insert into public.seller_payment_accounts (owner_id, stripe_account_id) values ($1, $2)`, [
            other.id,
            accountId(),
          ]),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUser(owner, (q) =>
          q.query(`update public.seller_payment_accounts set charges_enabled = true where owner_id = $1`, [owner.id]),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("holds one account per seller and one seller per account", async () => {
    expect(await expectDbError(connect(owner, accountId()))).toMatch(/duplicate key/);
    const taken = await asService(async (q) =>
      (await q.query(`select stripe_account_id from public.seller_payment_accounts where owner_id = $1`, [owner.id]))
        .rows[0].stripe_account_id as string,
    );
    expect(await expectDbError(connect(other, taken))).toMatch(/duplicate key/);
  });

  it("takes nothing that is not a Stripe account id", async () => {
    for (const bad of ["", "acct_", "cus_1234567890", "acct_12 34567", "acct_123;drop"]) {
      expect(await expectDbError(connect(other, bad))).toMatch(/seller_payment_accounts_id_shape/);
    }
  });

  it("stamps updated_at when Stripe's answer changes", async () => {
    const before = await asService(async (q) => {
      await q.query(
        `update public.seller_payment_accounts set updated_at = now() - interval '1 hour' where owner_id = $1`,
        [owner.id],
      );
      return (await q.query(`select updated_at from public.seller_payment_accounts where owner_id = $1`, [owner.id]))
        .rows[0].updated_at as Date;
    });
    const after = await asService(async (q) => {
      await q.query(`update public.seller_payment_accounts set charges_enabled = true where owner_id = $1`, [owner.id]);
      return (await q.query(`select updated_at from public.seller_payment_accounts where owner_id = $1`, [owner.id]))
        .rows[0].updated_at as Date;
    });
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it("goes with the seller's account when that is deleted", async () => {
    const leaving = await createUser(`leaving-pay-${randomUUID().slice(0, 6)}@test.squareshare.to`);
    await connect(leaving, accountId());
    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [leaving.id]));
    const left = await asSuper(async (q) =>
      (await q.query(`select count(*)::int as n from public.seller_payment_accounts where owner_id = $1`, [leaving.id]))
        .rows[0].n as number,
    );
    expect(left).toBe(0);
  });

  it("lets a refund or a dispute find its order by the payment it names", async () => {
    const index = await asSuper(async (q) =>
      (await q.query(`select indexdef from pg_indexes where indexname = 'orders_payment_ref_idx'`)).rows[0]?.indexdef as
        | string
        | undefined,
    );
    expect(index).toContain("(payment_ref)");
    expect(index).toContain("WHERE (payment_ref IS NOT NULL)");
  });
});
