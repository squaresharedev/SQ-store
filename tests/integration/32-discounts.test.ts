/**
 * Discounts (20261004_discounts), against the replayed schema.
 *
 * Proven here: who may read and write a store's discounts (and that nobody
 * deletes one), the columns a client can never change, every CHECK, the guard
 * that keeps a sale's history true for the EU 30-day price rule, the price
 * history trigger, the new order columns, and discount_performance's scoping
 * and crediting.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  asUserWithClaims,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let productId: string;

const tag = () => randomUUID().slice(0, 6);
const future = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

/** A code, written as a store member writes it (through RLS). */
async function insertCode(user: TestUser, columns: Record<string, unknown> = {}): Promise<string> {
  const row = {
    owner_id: owner.id,
    kind: "code",
    code: `CODE${tag().toUpperCase()}`,
    value_type: "percent",
    percent_off: 10,
    ...columns,
  };
  const names = Object.keys(row);
  return asUser(user, async (q) => {
    const { rows } = await q.query(
      `insert into public.discounts (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(row),
    );
    return rows[0].id as string;
  });
}

/** A sale, written by the service role so its start can be set freely. */
async function serviceSale(columns: Record<string, unknown> = {}): Promise<string> {
  const row = { owner_id: owner.id, kind: "automatic", value_type: "percent", percent_off: 20, ...columns };
  const names = Object.keys(row);
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.discounts (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(row),
    );
    return rows[0].id as string;
  });
}

const read = (id: string) =>
  asSuper(async (q) => (await q.query(`select * from public.discounts where id = $1`, [id])).rows[0]);

beforeAll(async () => {
  owner = await createUser(`owner-disc-${tag()}@test.squareshare.to`);
  editor = await createUser(`editor-disc-${tag()}@test.squareshare.to`);
  viewer = await createUser(`viewer-disc-${tag()}@test.squareshare.to`);
  stranger = await createUser(`stranger-disc-${tag()}@test.squareshare.to`);
  await asService((q) =>
    q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'editor', 'active', now()), ($1, $4, $5, 'viewer', 'active', now())`,
      [owner.id, editor.id, editor.email, viewer.id, viewer.email],
    ),
  );
  productId = await asUser(owner, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status) values ($1, 'Vase', 2400, 'active') returning id`,
      [owner.id],
    );
    return rows[0].id as string;
  });
});

afterAll(closePool);

describe("who may read and write a store's discounts", () => {
  it("lets the owner and an editor create, and everyone on the team read", async () => {
    const byOwner = await insertCode(owner);
    const byEditor = await insertCode(editor);
    for (const user of [owner, editor, viewer]) {
      const ids = await asUser(user, async (q) =>
        (await q.query(`select id from public.discounts where owner_id = $1`, [owner.id])).rows.map((row) => row.id),
      );
      expect(ids).toEqual(expect.arrayContaining([byOwner, byEditor]));
    }
  });

  it("refuses a viewer's or a stranger's write", async () => {
    for (const user of [viewer, stranger]) {
      expect(await expectDbError(insertCode(user))).toMatch(/row-level security/);
    }
    const id = await insertCode(owner);
    for (const user of [viewer, stranger]) {
      const res = await asUser(user, (q) => q.query(`update public.discounts set enabled = false where id = $1`, [id]));
      expect(res.rowCount).toBe(0);
    }
    expect((await read(id)).enabled).toBe(true);
  });

  it("shows a stranger and an anonymous caller nothing", async () => {
    await insertCode(owner);
    const seen = await asUser(stranger, async (q) =>
      (await q.query(`select id from public.discounts where owner_id = $1`, [owner.id])).rowCount,
    );
    expect(seen).toBe(0);
    expect(await expectDbError(asAnon((q) => q.query(`select id from public.discounts`)))).toMatch(/permission denied/);
  });

  it("lets nobody delete a discount, only archive it", async () => {
    const id = await insertCode(owner);
    expect(await expectDbError(asUser(owner, (q) => q.query(`delete from public.discounts where id = $1`, [id])))).toMatch(
      /permission denied/,
    );
    await asUser(owner, (q) => q.query(`update public.discounts set archived_at = now() where id = $1`, [id]));
    expect((await read(id)).archived_at).not.toBeNull();
  });

  it("never lets a discount move to another store or change kind", async () => {
    const id = await insertCode(owner);
    for (const change of [`owner_id = '${editor.id}'`, `kind = 'automatic'`, `id = gen_random_uuid()`]) {
      expect(
        await expectDbError(asUser(owner, (q) => q.query(`update public.discounts set ${change} where id = $1`, [id]))),
      ).toMatch(/permission denied/);
    }
  });

  it("is refused to a password-only session of an account with 2FA on", async () => {
    const guarded = await createUser(`twofa-disc-${tag()}@test.squareshare.to`);
    await asSuper((q) =>
      q.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
         values ($1, $2, 'phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
        [randomUUID(), guarded.id],
      ),
    );
    const insert = (claims: Record<string, unknown>) =>
      asUserWithClaims(guarded, claims, (q) =>
        q.query(
          `insert into public.discounts (owner_id, kind, code, value_type, percent_off) values ($1, 'code', 'TWOFA10', 'percent', 10)`,
          [guarded.id],
        ),
      );
    expect(await expectDbError(insert({ aal: "aal1" }))).toMatch(/row-level security/);
    await insert({ aal: "aal2" });
  });
});

describe("discount columns", () => {
  it("holds a code's shape, and one live code per store", async () => {
    expect(await expectDbError(insertCode(owner, { code: "lower10" }))).toMatch(/discounts_code_shape/);
    expect(await expectDbError(insertCode(owner, { code: "A B" }))).toMatch(/discounts_code_shape/);
    const code = `TAKEN${tag().toUpperCase()}`;
    const first = await insertCode(owner, { code });
    expect(await expectDbError(insertCode(editor, { code }))).toMatch(/discounts_live_code_idx/);
    await asUser(owner, (q) => q.query(`update public.discounts set archived_at = now() where id = $1`, [first]));
    await insertCode(owner, { code });
  });

  it("holds the value, the products and the window to their bounds", async () => {
    expect(await expectDbError(insertCode(owner, { percent_off: 91 }))).toMatch(/discounts_value/);
    expect(
      await expectDbError(insertCode(owner, { value_type: "amount", percent_off: null, amount_off_cents: 500, currency: "GBP" })),
    ).toMatch(/discounts_value/);
    expect(await expectDbError(insertCode(owner, { applies_to: "products" }))).toMatch(/discounts_products/);
    expect(await expectDbError(insertCode(owner, { product_ids: [productId] }))).toMatch(/discounts_products/);
    expect(await expectDbError(insertCode(owner, { starts_at: future(5), ends_at: future(1) }))).toMatch(/discounts_window/);
    expect(await expectDbError(insertCode(owner, { usage_limit: 0 }))).toMatch(/discounts_usage_limit/);
    expect(await expectDbError(insertCode(owner, { share_channel: "x".repeat(41) }))).toMatch(/discounts_share_channel/);
  });

  it("keeps a sale switched on, and codes and channels to codes", async () => {
    expect(await expectDbError(serviceSale({ enabled: false }))).toMatch(/discounts_sales_always_on/);
    expect(await expectDbError(serviceSale({ code: "SALE10" }))).toMatch(/discounts_code_matches_kind/);
    expect(await expectDbError(serviceSale({ share_channel: "Instagram" }))).toMatch(/discounts_share_channel/);
  });
});

describe("the guard that keeps a sale's history true", () => {
  const ownerSale = (columns: Record<string, unknown> = {}) =>
    asUser(owner, async (q) => {
      const row = { owner_id: owner.id, kind: "automatic", value_type: "percent", percent_off: 20, ...columns };
      const names = Object.keys(row);
      const { rows } = await q.query(
        `insert into public.discounts (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      );
      return rows[0].id as string;
    });
  const update = (id: string, set: string) =>
    asUser(owner, (q) => q.query(`update public.discounts set ${set} where id = $1`, [id]));

  it("refuses a sale that starts in the past", async () => {
    expect(await expectDbError(ownerSale({ starts_at: "2020-01-01T00:00:00Z" }))).toMatch(/discount_started/);
  });

  it("freezes a started sale's terms and start", async () => {
    const id = await serviceSale({ starts_at: "2026-01-01T00:00:00Z" });
    for (const set of [
      "percent_off = 30",
      "applies_to = 'products', product_ids = array[gen_random_uuid()]",
      "starts_at = now() + interval '1 day'",
    ]) {
      expect(await expectDbError(update(id, set))).toMatch(/discount_started/);
    }
  });

  it("lets a started sale's end move forward, never into the past", async () => {
    const id = await serviceSale({ starts_at: "2026-01-01T00:00:00Z" });
    await update(id, "ends_at = now() + interval '3 days'");
    expect(await expectDbError(update(id, "ends_at = now() - interval '1 day'"))).toMatch(/discount_started/);
  });

  it("keeps an ended sale ended", async () => {
    const id = await serviceSale({ starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" });
    expect(await expectDbError(update(id, "ends_at = now() + interval '3 days'"))).toMatch(/discount_started/);
  });

  it("ends a running sale now when it is archived", async () => {
    const id = await serviceSale({ starts_at: "2026-01-01T00:00:00Z" });
    await update(id, "archived_at = now()");
    const row = await read(id);
    expect(row.ends_at).not.toBeNull();
    expect(Math.abs(new Date(row.ends_at).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("lets a scheduled sale change anything, and a code change freely", async () => {
    const scheduled = await ownerSale({ starts_at: future(48) });
    await update(scheduled, "percent_off = 35, starts_at = now() + interval '3 days'");
    expect((await read(scheduled)).percent_off).toBe(35);
    const code = await insertCode(owner, { starts_at: "2026-01-01T00:00:00Z" });
    await update(code, "percent_off = 15, enabled = false");
    expect((await read(code)).percent_off).toBe(15);
  });
});

describe("product price history", () => {
  const history = (id: string) =>
    asSuper(async (q) =>
      (await q.query(`select price_cents, currency from public.product_price_history where product_id = $1 order by id`, [id]))
        .rows,
    );

  it("records a product's first price, and each real change only", async () => {
    const id = await asUser(owner, async (q) => {
      const { rows } = await q.query(
        `insert into public.products (owner_id, title, price_cents, status) values ($1, 'Bowl', 1500, 'active') returning id`,
        [owner.id],
      );
      return rows[0].id as string;
    });
    await asUser(owner, (q) => q.query(`update public.products set title = 'Big bowl', price_cents = 1500 where id = $1`, [id]));
    await asUser(owner, (q) => q.query(`update public.products set price_cents = 1800 where id = $1`, [id]));
    expect(await history(id)).toEqual([
      { price_cents: 1500, currency: "EUR" },
      { price_cents: 1800, currency: "EUR" },
    ]);
  });

  it("is the server's alone: no client reads or writes it", async () => {
    expect(
      await expectDbError(asUser(owner, (q) => q.query(`select * from public.product_price_history`))),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUser(owner, (q) =>
          q.query(`insert into public.product_price_history (product_id, price_cents, currency) values ($1, 1, 'EUR')`, [productId]),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("orders and what a discount did", () => {
  async function order(columns: Record<string, unknown>): Promise<string> {
    const row = {
      seller_id: owner.id,
      channel: "direct",
      amount_cents: 4320,
      product_title: "Vase",
      product_price_cents: 2400,
      quantity: 2,
      ...columns,
    };
    const names = Object.keys(row);
    return asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.orders (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      );
      return rows[0].id as string;
    });
  }

  it("bounds the discount by the regular price, and the code by its shape", async () => {
    expect(await expectDbError(order({ discount_cents: -1 }))).toMatch(/orders_discount_cents_range/);
    expect(await expectDbError(order({ discount_cents: 4801 }))).toMatch(/orders_discount_cents_range/);
    expect(await expectDbError(order({ discount_code: "lower" }))).toMatch(/orders_discount_code_shape/);
  });

  it("credits each paid order to the code first, else the sale, scoped to the caller's store", async () => {
    const sale = await serviceSale({ starts_at: "2026-01-01T00:00:00Z" });
    const code = await insertCode(owner);
    await order({ discount_id: sale, discount_cents: 480 });
    await order({ discount_id: sale, discount_cents: 480, discount_code_id: code, discount_code: "INSTA10" });
    await order({ discount_id: code, discount_cents: 720, discount_code_id: code, discount_code: "INSTA10" });
    await order({ discount_id: code, discount_cents: 720, discount_code_id: code, discount_code: "INSTA10", status: "refunded" });

    const performance = (user: TestUser) =>
      asUser(user, async (q) => (await q.query(`select * from public.discount_performance($1)`, [owner.id])).rows);
    const rows = await performance(viewer);
    const byId = Object.fromEntries(rows.map((row) => [row.discount_id, row]));
    expect(byId[sale]).toMatchObject({ uses: 1, orders: 1, discount_cents: "480" });
    // An order that was taken back gives its use back (20261008_order_lifecycle):
    // the refunded one counts for nothing, as a use or as a sale.
    expect(byId[code]).toMatchObject({ uses: 2, orders: 2, discount_cents: "1200" });
    // RLS answers nothing for a store the caller is not in, whatever id it names.
    expect(await performance(stranger)).toEqual([]);
  });

  it("subtracts discounts from the pricing calculator's item total", async () => {
    const before = await asService(async (q) =>
      Number((await q.query(`select subtotal_cents from public.billing_sales_summary($1)`, [owner.id])).rows[0].subtotal_cents),
    );
    await order({ amount_cents: 4000, product_price_cents: 2400, quantity: 2, discount_cents: 800, currency: "EUR" });
    const after = await asService(async (q) =>
      Number((await q.query(`select subtotal_cents from public.billing_sales_summary($1)`, [owner.id])).rows[0].subtotal_cents),
    );
    expect(after - before).toBe(4000);
  });
});
