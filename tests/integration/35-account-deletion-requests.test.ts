/**
 * Account deletion requests (20261010_account_deletion_requests), against the
 * replayed schema.
 *
 * The table is what an account is DELETED from, so what is proven here is who
 * can write it (the server, and nobody with a session), that the profile flag a
 * seller can write is not it, and that deleting the account is what everything
 * else follows from.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";

let seller: TestUser;

const request = (user: TestUser, requestedAt = "now()") =>
  asService((q) =>
    q.query(
      `insert into public.account_deletion_requests (user_id, requested_at) values ($1, ${requestedAt})
       on conflict (user_id) do nothing`,
      [user.id],
    ),
  );

const requestOf = (user: TestUser) =>
  asService(async (q) =>
    (await q.query(`select * from public.account_deletion_requests where user_id = $1`, [user.id])).rows[0] as
      | { requested_at: Date; started_at: Date | null; last_error: string | null }
      | undefined,
  );

beforeAll(async () => {
  seller = await createUser(`seller-del-${randomUUID().slice(0, 6)}@test.squareshare.to`);
});

afterAll(closePool);

describe("account_deletion_requests", () => {
  it("is the server's alone: a seller can neither ask this way, nor see, nor call it off", async () => {
    const denied = /permission denied/;
    expect(
      await expectDbError(
        asUser(seller, (q) =>
          q.query(`insert into public.account_deletion_requests (user_id, requested_at) values ($1, now() - interval '1 year')`, [
            seller.id,
          ]),
        ),
      ),
    ).toMatch(denied);
    await request(seller);
    expect(await expectDbError(asUser(seller, (q) => q.query(`select * from public.account_deletion_requests`)))).toMatch(
      denied,
    );
    expect(
      await expectDbError(
        asUser(seller, (q) =>
          q.query(`update public.account_deletion_requests set requested_at = now() - interval '1 year' where user_id = $1`, [
            seller.id,
          ]),
        ),
      ),
    ).toMatch(denied);
    expect(
      await expectDbError(asUser(seller, (q) => q.query(`delete from public.account_deletion_requests where user_id = $1`, [seller.id]))),
    ).toMatch(denied);
    expect(await expectDbError(asAnon((q) => q.query(`select * from public.account_deletion_requests`)))).toMatch(denied);
  });

  it("is not moved by the flag a seller CAN write on their own profile", async () => {
    const before = await requestOf(seller);
    // The hijacked-session move: backdate the flag, skipping the waiting period.
    await asUser(seller, (q) =>
      q.query(`update public.profiles set deletion_requested_at = now() - interval '1 year' where id = $1`, [seller.id]),
    );
    const after = await requestOf(seller);
    expect(after?.requested_at.getTime()).toBe(before?.requested_at.getTime());
    // And clearing the flag does not call the request off either.
    await asUser(seller, (q) => q.query(`update public.profiles set deletion_requested_at = null where id = $1`, [seller.id]));
    expect(await requestOf(seller)).toBeDefined();
  });

  it("keeps the first request's date when asked again", async () => {
    const first = await requestOf(seller);
    await request(seller, "now() + interval '3 days'");
    expect((await requestOf(seller))?.requested_at.getTime()).toBe(first?.requested_at.getTime());
  });

  it("holds a short reason for a failure, not a message", async () => {
    await asService((q) =>
      q.query(`update public.account_deletion_requests set last_error = 'files', last_attempt_at = now() where user_id = $1`, [
        seller.id,
      ]),
    );
    expect((await requestOf(seller))?.last_error).toBe("files");
    expect(
      await expectDbError(
        asService((q) =>
          q.query(`update public.account_deletion_requests set last_error = $2 where user_id = $1`, [seller.id, "x".repeat(201)]),
        ),
      ),
    ).toMatch(/account_deletion_requests_error_length/);
  });

  it("goes with the account, and the account takes its store with it", async () => {
    const leaving = await createUser(`leaving-del-${randomUUID().slice(0, 6)}@test.squareshare.to`);
    await request(leaving);
    await asService(async (q) => {
      await q.query(
        `insert into public.products (owner_id, title, price_cents, status) values ($1, 'Stoneware vase', 2400, 'active')`,
        [leaving.id],
      );
      await q.query(
        `insert into public.orders (seller_id, channel, status, amount_cents, currency, product_title, product_price_cents)
         values ($1, 'direct', 'paid', 2400, 'EUR', 'Stoneware vase', 2400)`,
        [leaving.id],
      );
    });

    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [leaving.id]));

    const left = await asSuper(async (q) =>
      (
        await q.query(
          `select
             (select count(*)::int from public.account_deletion_requests where user_id = $1) as requests,
             (select count(*)::int from public.profiles where id = $1) as profiles,
             (select count(*)::int from public.products where owner_id = $1) as products,
             (select count(*)::int from public.orders where seller_id = $1) as orders`,
          [leaving.id],
        )
      ).rows[0],
    );
    expect(left).toEqual({ requests: 0, profiles: 0, products: 0, orders: 0 });
  });
});
