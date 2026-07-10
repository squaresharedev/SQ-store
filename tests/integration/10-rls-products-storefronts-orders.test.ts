/**
 * RLS isolation: products, storefronts, orders — two unrelated users must be
 * fully separated on every verb, and team roles must open exactly the access
 * the permission map grants.
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

let alice: TestUser; // store owner
let bob: TestUser; // unrelated second user
let productId: string;
let storefrontId: string;
let orderId: string;

beforeAll(async () => {
  alice = await createUser("alice-rls@test.squareshare.to");
  bob = await createUser("bob-rls@test.squareshare.to");

  productId = await asUser(alice, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Alice print', 1500, 'active') returning id`,
      [alice.id],
    );
    return rows[0].id;
  });

  storefrontId = await asUser(alice, async (q) => {
    const { rows } = await q.query(
      `insert into public.storefronts (owner_id, name) values ($1, 'Alice shop') returning id`,
      [alice.id],
    );
    return rows[0].id;
  });

  // Orders are service-written (checkout webhook / seed) — no client insert path.
  orderId = await asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.orders (seller_id, product_id, storefront_id, channel, amount_cents, product_title, product_price_cents, buyer_email)
       values ($1, $2, $3, 'embed', 1500, 'Alice print', 1500, 'buyer@example.com') returning id`,
      [alice.id, productId, storefrontId],
    );
    return rows[0].id;
  });
});

afterAll(closePool);

describe("products RLS", () => {
  it("owner reads their product; stranger sees nothing", async () => {
    const mine = await asUser(alice, (q) =>
      q.query(`select id from public.products where id = $1`, [productId]),
    );
    expect(mine.rows).toHaveLength(1);

    const theirs = await asUser(bob, (q) =>
      q.query(`select id from public.products where id = $1`, [productId]),
    );
    expect(theirs.rows).toHaveLength(0);
  });

  it("stranger cannot UPDATE another's product (0 rows affected)", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`update public.products set title = 'hacked' where id = $1`, [productId]),
    );
    expect(res.rowCount).toBe(0);
    const check = await asSuper((q) =>
      q.query(`select title from public.products where id = $1`, [productId]),
    );
    expect(check.rows[0].title).toBe("Alice print");
  });

  it("stranger cannot DELETE another's product", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`delete from public.products where id = $1`, [productId]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("stranger cannot INSERT a product owned by someone else (spoofed owner_id)", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(
          `insert into public.products (owner_id, title, price_cents) values ($1, 'spoof', 100)`,
          [alice.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("anon can neither read nor write products", async () => {
    const read = await asAnon((q) => q.query(`select * from public.products`));
    expect(read.rows).toHaveLength(0);
    await expectDbError(
      asAnon((q) =>
        q.query(
          `insert into public.products (owner_id, title, price_cents) values ($1, 'anon', 100)`,
          [alice.id],
        ),
      ),
    );
  });
});

describe("storefronts RLS", () => {
  it("owner reads, stranger blind", async () => {
    const mine = await asUser(alice, (q) =>
      q.query(`select id, config from public.storefronts where id = $1`, [storefrontId]),
    );
    expect(mine.rows).toHaveLength(1);

    const theirs = await asUser(bob, (q) =>
      q.query(`select id from public.storefronts where id = $1`, [storefrontId]),
    );
    expect(theirs.rows).toHaveLength(0);
  });

  it("stranger cannot rewrite another's storefront config", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`update public.storefronts set config = '{"pwned":true}' where id = $1`, [
        storefrontId,
      ]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("stranger cannot create a storefront under another owner", async () => {
    const msg = await expectDbError(
      asUser(bob, (q) =>
        q.query(`insert into public.storefronts (owner_id, name) values ($1, 'fake')`, [alice.id]),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("stranger cannot delete another's storefront", async () => {
    const res = await asUser(bob, (q) =>
      q.query(`delete from public.storefronts where id = $1`, [storefrontId]),
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("orders RLS", () => {
  it("seller reads own orders including buyer email", async () => {
    const mine = await asUser(alice, (q) =>
      q.query(`select buyer_email from public.orders where id = $1`, [orderId]),
    );
    expect(mine.rows[0]?.buyer_email).toBe("buyer@example.com");
  });

  it("stranger sees zero orders (buyer PII protected)", async () => {
    const theirs = await asUser(bob, (q) => q.query(`select * from public.orders`));
    expect(theirs.rows).toHaveLength(0);
  });

  it("no client can INSERT orders — not even for themselves", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(
          `insert into public.orders (seller_id, channel, amount_cents, product_title, product_price_cents)
           values ($1, 'embed', 100, 'x', 100)`,
          [alice.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("no client can UPDATE an order (no update policy, e.g. faking refunds)", async () => {
    const res = await asUser(alice, (q) =>
      q.query(`update public.orders set status = 'refunded' where id = $1`, [orderId]),
    );
    expect(res.rowCount).toBe(0);
  });

  it("no client can DELETE an order (sales history immutable)", async () => {
    const res = await asUser(alice, (q) =>
      q.query(`delete from public.orders where id = $1`, [orderId]),
    );
    expect(res.rowCount).toBe(0);
  });
});

describe("team-role store access (multi-tenant)", () => {
  let editor: TestUser;
  let viewer: TestUser;

  beforeAll(async () => {
    editor = await createUser("editor-rls@test.squareshare.to");
    viewer = await createUser("viewer-rls@test.squareshare.to");
    // Wire memberships directly as service (invite/accept flow is tested separately).
    await asService(async (q) => {
      await q.query(
        `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'editor', 'active', now()),
                ($1, $4, $5, 'viewer', 'active', now())`,
        [alice.id, editor.id, editor.email, viewer.id, viewer.email],
      );
    });
  });

  it("editor can read and write the owner's products", async () => {
    const read = await asUser(editor, (q) =>
      q.query(`select id from public.products where owner_id = $1`, [alice.id]),
    );
    expect(read.rows.length).toBeGreaterThanOrEqual(1);

    const update = await asUser(editor, (q) =>
      q.query(`update public.products set description = 'edited by editor' where id = $1`, [
        productId,
      ]),
    );
    expect(update.rowCount).toBe(1);

    const insert = await asUser(editor, (q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents) values ($1, 'Editor addition', 900) returning id`,
        [alice.id],
      ),
    );
    expect(insert.rows).toHaveLength(1);
  });

  it("viewer can read but NOT write the owner's products", async () => {
    const read = await asUser(viewer, (q) =>
      q.query(`select id from public.products where owner_id = $1`, [alice.id]),
    );
    expect(read.rows.length).toBeGreaterThanOrEqual(1);

    const update = await asUser(viewer, (q) =>
      q.query(`update public.products set title = 'viewer hack' where id = $1`, [productId]),
    );
    expect(update.rowCount).toBe(0);

    const msg = await expectDbError(
      asUser(viewer, (q) =>
        q.query(
          `insert into public.products (owner_id, title, price_cents) values ($1, 'nope', 1)`,
          [alice.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("viewer and editor can read the owner's orders; stranger still cannot", async () => {
    const v = await asUser(viewer, (q) =>
      q.query(`select id from public.orders where seller_id = $1`, [alice.id]),
    );
    expect(v.rows.length).toBeGreaterThanOrEqual(1);

    const s = await asUser(bob, (q) =>
      q.query(`select id from public.orders where seller_id = $1`, [alice.id]),
    );
    expect(s.rows).toHaveLength(0);
  });

  it("editor can write the owner's storefront; viewer cannot", async () => {
    const e = await asUser(editor, (q) =>
      q.query(`update public.storefronts set name = 'Edited shop' where id = $1`, [storefrontId]),
    );
    expect(e.rowCount).toBe(1);

    const v = await asUser(viewer, (q) =>
      q.query(`update public.storefronts set name = 'Viewer shop' where id = $1`, [storefrontId]),
    );
    expect(v.rowCount).toBe(0);
  });

  it("a REVOKED editor loses access instantly", async () => {
    const temp = await createUser("temp-editor@test.squareshare.to");
    await asService((q) =>
      q.query(
        `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'editor', 'active', now())`,
        [alice.id, temp.id, temp.email],
      ),
    );
    const before = await asUser(temp, (q) =>
      q.query(`select id from public.products where owner_id = $1`, [alice.id]),
    );
    expect(before.rows.length).toBeGreaterThanOrEqual(1);

    await asService((q) =>
      q.query(
        `update public.team_members set status = 'revoked' where account_owner_id = $1 and member_user_id = $2`,
        [alice.id, temp.id],
      ),
    );

    const after = await asUser(temp, (q) =>
      q.query(`select id from public.products where owner_id = $1`, [alice.id]),
    );
    expect(after.rows).toHaveLength(0);

    const write = await asUser(temp, (q) =>
      q.query(`update public.products set title = 'zombie' where id = $1`, [productId]),
    );
    expect(write.rowCount).toBe(0);
  });
});
