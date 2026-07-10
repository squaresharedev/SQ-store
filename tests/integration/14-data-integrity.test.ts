/**
 * Data-integrity behaviors that the dashboard depends on but that aren't RLS
 * per se: order snapshots surviving product edits/deletes, multiple
 * storefronts per owner, FK detach-on-delete preserving sales history, and the
 * signup trigger's metadata mapping.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  type TestUser,
} from "../db/client";

let seller: TestUser;

beforeAll(async () => {
  seller = await createUser("integrity@test.squareshare.to");
});

afterAll(closePool);

describe("order snapshots survive product mutation", () => {
  it("editing then deleting the product leaves the order's snapshot intact", async () => {
    const productId = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.products (owner_id, title, price_cents) values ($1, 'Original title', 1500) returning id`,
        [seller.id],
      );
      return rows[0].id;
    });

    const orderId = await asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.orders (seller_id, product_id, channel, amount_cents, product_title, product_price_cents)
         values ($1, $2, 'embed', 1500, 'Original title', 1500) returning id`,
        [seller.id, productId],
      );
      return rows[0].id;
    });

    // Edit the product title + price.
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Renamed', price_cents = 9999 where id = $1`, [
        productId,
      ]),
    );
    // Snapshot columns are unaffected.
    let snap = await asService((q) =>
      q.query(`select product_title, product_price_cents, product_id from public.orders where id = $1`, [
        orderId,
      ]),
    );
    expect(snap.rows[0]).toMatchObject({
      product_title: "Original title",
      product_price_cents: 1500,
      product_id: productId,
    });

    // Delete the product: order survives, product_id nulls (ON DELETE SET NULL).
    await asUser(seller, (q) => q.query(`delete from public.products where id = $1`, [productId]));
    snap = await asService((q) =>
      q.query(`select product_title, product_id from public.orders where id = $1`, [orderId]),
    );
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].product_title).toBe("Original title");
    expect(snap.rows[0].product_id).toBeNull();
  });
});

describe("multiple storefronts per owner", () => {
  it("an owner can hold several storefronts (unique constraint was dropped)", async () => {
    await asUser(seller, (q) =>
      q.query(
        `insert into public.storefronts (owner_id, name) values ($1, 'Shop A'), ($1, 'Shop B'), ($1, 'Shop C')`,
        [seller.id],
      ),
    );
    const { rows } = await asUser(seller, (q) =>
      q.query(`select count(*)::int as n from public.storefronts where owner_id = $1`, [seller.id]),
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("deleting a storefront detaches its orders instead of cascading them away", async () => {
    const storefrontId = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.storefronts (owner_id, name) values ($1, 'Doomed shop') returning id`,
        [seller.id],
      );
      return rows[0].id;
    });
    const orderId = await asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.orders (seller_id, storefront_id, channel, amount_cents, product_title, product_price_cents)
         values ($1, $2, 'embed', 500, 'Attributed', 500) returning id`,
        [seller.id, storefrontId],
      );
      return rows[0].id;
    });

    await asUser(seller, (q) => q.query(`delete from public.storefronts where id = $1`, [storefrontId]));

    const { rows } = await asService((q) =>
      q.query(`select storefront_id from public.orders where id = $1`, [orderId]),
    );
    expect(rows).toHaveLength(1); // sale history preserved
    expect(rows[0].storefront_id).toBeNull(); // attribution detached
  });

  it("storefront name length constraint (1..80) is enforced", async () => {
    let failed = false;
    try {
      await asUser(seller, (q) =>
        q.query(`insert into public.storefronts (owner_id, name) values ($1, $2)`, [
          seller.id,
          "x".repeat(81),
        ]),
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe("signup trigger maps identity metadata", () => {
  it("password signup maps display_name from metadata", async () => {
    const u = await createUser("meta1@test.squareshare.to", { display_name: "From Display" });
    const { rows } = await asSuper((q) =>
      q.query(`select display_name from public.profiles where id = $1`, [u.id]),
    );
    expect(rows[0].display_name).toBe("From Display");
  });

  it("OAuth-style metadata (full_name / name / picture) is picked up", async () => {
    const u = await createUser("meta2@test.squareshare.to", {
      full_name: "OAuth Person",
      picture: "https://example.com/a.png",
    });
    const { rows } = await asSuper((q) =>
      q.query(`select display_name, avatar_url from public.profiles where id = $1`, [u.id]),
    );
    expect(rows[0].display_name).toBe("OAuth Person");
    expect(rows[0].avatar_url).toBe("https://example.com/a.png");
  });

  it("every new profile is seeded with exactly one active owner membership", async () => {
    const u = await createUser("meta3@test.squareshare.to");
    const { rows } = await asSuper((q) =>
      q.query(
        `select count(*)::int as n from public.team_members
         where account_owner_id = $1 and role = 'owner' and status = 'active'`,
        [u.id],
      ),
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("currency + money constraints", () => {
  it("products reject unknown currency and negative price at the DB", async () => {
    for (const sql of [
      `insert into public.products (owner_id, title, price_cents, currency) values ($1, 'x', 100, 'GBP')`,
      `insert into public.products (owner_id, title, price_cents) values ($1, 'x', -1)`,
    ]) {
      let failed = false;
      try {
        await asUser(seller, (q) => q.query(sql, [seller.id]));
      } catch {
        failed = true;
      }
      expect(failed, sql).toBe(true);
    }
  });

  it("orders reject an out-of-set channel and status", async () => {
    for (const [channel, status] of [
      ["telepathy", "paid"],
      ["embed", "vaporized"],
    ]) {
      let failed = false;
      try {
        await asService((q) =>
          q.query(
            `insert into public.orders (seller_id, channel, status, amount_cents, product_title, product_price_cents)
             values ($1, $2, $3, 100, 'x', 100)`,
            [seller.id, channel, status],
          ),
        );
      } catch {
        failed = true;
      }
      expect(failed, `${channel}/${status}`).toBe(true);
    }
  });
});
